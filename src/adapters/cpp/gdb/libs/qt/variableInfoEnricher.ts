/**
 * qt/variableInfoEnricher.ts (GDB)
 *
 * Enriches bare Qt container types ("QVector" / "QList" without template
 * argument) by inferring the element type and reconstructing the full
 * templated type string.
 *
 * GDB with Qt pretty-printers sometimes strips the template argument from
 * the DAP `type` field, reporting "QVector" instead of "QVector<QVector2D>".
 * Without the element type, isQVectorOf2D / isQVectorNumericScalar and all
 * downstream type-detection functions produce incorrect results.
 *
 * Four inference strategies are tried in order:
 *
 *   Strategy 1 – Named "[0]" / "0" child:
 *     Request the variable's children via DAP; look for a child named "[0]"
 *     (GDB Qt pretty-printer style) or "0" with a non-empty `type` field.
 *
 *   Strategy 2 – Any indexed child:
 *     Accept the first child whose name is any non-negative integer index
 *     ("[N]" or "N") and that carries a non-empty `type` field.  Handles
 *     pretty-printers that label the first element differently.
 *
 *   Strategy 3 – Qt internal child types:
 *     Qt6 QList exposes two DAP children that encode the element type T:
 *       • base class child   type = "QListSpecialMethods<T>"
 *       • data pointer child type = "QList<T>::DataPointer"
 *     Parse T from these type strings using QT_INTERNAL_ELEM_TYPE_RE.
 *     This handles QVector<QVector2D>, QVector<double>, etc. even when no
 *     indexed children are visible (e.g. pretty-printer hides [0]).
 *
 *   Strategy 4 – sizeof fallback:
 *     Evaluate `sizeof(varName[0])` via the GDB "repl" context.  The sizeof
 *     operator is purely compile-time in C++, so it works even on empty
 *     vectors.  Only unambiguous byte-to-type mappings are used:
 *       12 bytes → QVector3D  (3 × float32)
 *       16 bytes → QPointF    (2 × double/qreal)
 *     Sizes 4 / 8 are skipped because multiple Qt types share them.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { IVariableInfoEnricher } from "../../../IVariableInfoEnricher";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";

/** Returns the Qt element type for unambiguous sizeof values, null otherwise. */
function elemBytesToQtType(bytes: number): string | null {
    switch (bytes) {
        case 12: return "QVector3D"; // 3 × float32 = 12 bytes
        case 16: return "QPointF";   // 2 × double  = 16 bytes
        default: return null;
    }
}

// Matches "[0]", "[12]", "0", "12", etc. — DAP child names for indexed elements.
const INDEXED_CHILD_RE = /^\[?\d+\]?$/;

// Extracts the element type T from Qt6 internal type strings that appear as
// DAP children of a bare QVector / QList:
//   "QListSpecialMethods<T>"   (Qt6 QList base class)
//   "QList<T>::DataPointer"
//   "QVector<T>::DataPointer"
// Uses [^<>]+ (no nested angle-brackets) which is sufficient for all Qt element
// types (QVector2D, QPointF, double, float, int, …).
const QT_INTERNAL_ELEM_TYPE_RE = /Q(?:ListSpecialMethods|List|Vector)\s*<\s*([^<>]+?)\s*>(?:$|::)/;

export class QtBareTypeEnricher implements IVariableInfoEnricher {
    canEnrich(typeStr: string): boolean {
        return /^Q(?:Vector|List)$/.test(typeStr);
    }

    async enrich(
        session: vscode.DebugSession,
        info: VariableInfo
    ): Promise<void> {
        if (!info.variablesReference || info.variablesReference <= 0) {
            logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" skipped — no variablesReference`);
            return;
        }
        const typeStr = info.typeName ?? info.type;
        try {
            const resp = await session.customRequest("variables", {
                variablesReference: info.variablesReference,
            });
            const children: Array<{ name: string; type?: string }> =
                resp?.variables ?? [];
            logger.debug(
                `QtBareTypeEnricher(gdb): "${info.name}" children=[${children.map(v => `"${v.name}":"${v.type ?? ""}"`).join(", ")}]`
            );

            // ── Strategy 1: exact name "[0]" or "0" ──────────────────────
            const s1 = children.find((v) => v.name === "[0]") ??
                       children.find((v) => v.name === "0");
            if (s1?.type) {
                const reconstructed = `${typeStr}<${s1.type.trim()}>`;
                info.typeName = reconstructed;
                info.type = reconstructed;
                logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" "${typeStr}" → "${reconstructed}" (strategy 1)`);
                return;
            }

            // ── Strategy 2: any indexed child ([N] / N) with a type ───────
            const s2 = children.find((v) => INDEXED_CHILD_RE.test(v.name) && !!v.type);
            if (s2?.type) {
                const reconstructed = `${typeStr}<${s2.type.trim()}>`;
                info.typeName = reconstructed;
                info.type = reconstructed;
                logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" "${typeStr}" → "${reconstructed}" (strategy 2, child "${s2.name}")`);
                return;
            }

            // ── Strategy 3: Qt internal child types ───────────────────────
            // Qt6 QList always exposes children whose `type` field encodes the
            // element type, e.g. "QListSpecialMethods<QVector2D>" (base class)
            // or "QList<QVector2D>::DataPointer" (d-ptr).  Extract T from the
            // first matching child.
            for (const child of children) {
                const m = (child.type ?? "").match(QT_INTERNAL_ELEM_TYPE_RE);
                if (m) {
                    const elemType = m[1].trim();
                    const reconstructed = `${typeStr}<${elemType}>`;
                    info.typeName = reconstructed;
                    info.type = reconstructed;
                    logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" "${typeStr}" → "${reconstructed}" (strategy 3, child "${child.name}" type="${child.type}")`);
                    return;
                }
            }

            // ── Strategy 4: sizeof fallback ───────────────────────────────
            logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" no Qt internal child type found — trying sizeof`);
            if (info.name) {
                const sizeStr = await evaluateExpression(
                    session,
                    `(int)sizeof(${info.name}[0])`,
                    info.frameId
                );
                logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" sizeof(${info.name}[0]) = ${sizeStr ?? "null"}`);
                const elemBytes = sizeStr !== null ? parseInt(sizeStr, 10) : NaN;
                const elemType = isNaN(elemBytes) ? null : elemBytesToQtType(elemBytes);
                if (elemType !== null) {
                    const prefix = /^QList/.test(typeStr) ? "QList" : "QVector";
                    const reconstructed = `${prefix}<${elemType}>`;
                    info.typeName = reconstructed;
                    info.type = reconstructed;
                    logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" "${typeStr}" → "${reconstructed}" (strategy 4, sizeof=${elemBytes})`);
                    return;
                }
                logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" sizeof=${elemBytes} — no unambiguous mapping, enrichment skipped`);
            }
        } catch (e) {
            logger.debug(`QtBareTypeEnricher(gdb): "${info.name}" error: ${e}`);
        }
    }
}
