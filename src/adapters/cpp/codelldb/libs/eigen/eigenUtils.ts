/**
 * codelldb/libs/eigen/eigenUtils.ts — Eigen helpers for CodeLLDB (lldb) sessions.
 *
 * Uses bare pointer expressions and accesses Eigen's internal m_storage fields
 * when member-function calls are unavailable under LLDB.  No debugger branching.
 */

import * as vscode from "vscode";
import {
    evaluateExpression,
    tryGetDataPointer,
} from "../../debugger";
import { cppTypeToDtype } from "../utils";
import { logger } from "../../../../../log/logger";

// ── Dtype resolution ──────────────────────────────────────────────────────

/**
 * Determine dtype (float32 or float64) from an Eigen type string.
 *
 * Debugger examples:
 *   "Eigen::Matrix<double, -1, -1, 0, -1, -1>"  → float64
 *   "Eigen::Matrix<float, -1, 1, 0, -1, 1>"     → float32
 *   "Eigen::Array<double, 3, 1>"                 → float64
 */
export function eigenDtype(typeStr: string): string {
    const tplMatch = typeStr.match(
        /Eigen::(?:Matrix|Array|Vector|RowVector)\s*<\s*([^,>]+)/
    );
    if (tplMatch) {
        const firstParam = tplMatch[1].trim();
        if (firstParam === "double") { return "float64"; }
        if (firstParam === "float")  { return "float32"; }
        return cppTypeToDtype(firstParam);
    }
    // Shorthand aliases: VectorXd / MatrixXd → double; VectorXf / MatrixXf → float
    if (/X[df]$/.test(typeStr)) {
        return typeStr.endsWith("d") ? "float64" : "float32";
    }
    return "float32"; // safe default
}

export function bytesPerEigenDtype(dtype: string): number {
    if (dtype === "float64") { return 8; }
    if (dtype === "float32") { return 4; }
    return 4;
}

// ── Dimension helpers ─────────────────────────────────────────────────────

/**
 * Evaluate an integer property (.rows() / .cols()) of an Eigen object.
 * Returns 0 on failure.
 */
export async function evalEigenDim(
    session: vscode.DebugSession,
    varName: string,
    prop: "rows" | "cols",
    frameId?: number
): Promise<number> {
    // m_rows / m_cols are Eigen's internal DenseStorage members — accessible
    // even when LLDB cannot call C++ member functions.
    const internalProp = prop === "rows" ? "m_rows" : "m_cols";
    const exprs = [
        `${varName}.${prop}()`,
        `(long long)${varName}.${prop}()`,
        `${varName}.m_storage.${internalProp}`,
        `(long long)${varName}.m_storage.${internalProp}`,
    ];
    for (const expr of exprs) {
        const res = await evaluateExpression(session, expr, frameId);
        logger.debug(`[evalEigenDim] ${varName}.${prop} expr=${expr} -> ${JSON.stringify(res)}`);
        // LLDB may return "(type) $N = value"
        const direct = parseInt((res ?? "").trim());
        const n = !isNaN(direct) ? direct : (() => {
            const m = (res ?? "").match(/=\s*(-?\d+)/);
            return m ? parseInt(m[1]) : NaN;
        })();
        if (!isNaN(n) && n > 0 && n < 100_000_000) {
            return n;
        }
    }
    return 0;
}

// ── Compile-time dimension parser ────────────────────────────────────────

/**
 * Parse compile-time [Rows, Cols] from an Eigen type template string.
 * Returns [rows, cols] where a value > 0 means fixed at compile time.
 * Dynamic (-1) and unresolvable dimensions return -1.
 * Returns null when the type string is not a recognised Eigen template.
 *
 * Examples:
 *   "Eigen::Matrix<double, -1, 1, 0, -1, 1>"  → [-1, 1]  (VectorXd)
 *   "Eigen::Matrix<double, -1, -1, 0, -1, -1>" → [-1, -1] (MatrixXd)
 *   "Eigen::Matrix<float, 4, 1, 0, 4, 1>"      → [4, 1]   (Vector4f)
 */
export function parseEigenCompileTimeDims(typeStr: string): [number, number] | null {
    const m = typeStr.match(/Eigen::(?:Matrix|Array)\s*<[^,]+,\s*(-?\d+),\s*(-?\d+)/);
    if (m) { return [parseInt(m[1]), parseInt(m[2])]; }
    if (/Eigen::RowVector/.test(typeStr)) { return [1, -1]; }
    if (/Eigen::Vector/.test(typeStr))    { return [-1, 1]; }
    return null;
}

// ── Data pointer ──────────────────────────────────────────────────────────

/**
 * Obtain the Eigen data pointer using different evaluation strategies.
 *
 * Eigen::DenseBase::data() is the standard accessor and works for both
 * dynamic (MatrixX) and fixed-size matrices.
 */
export async function getEigenDataPointer(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<string | null> {
    const exprs = [
        `${varName}.data()`,
        `&${varName}(0)`,
        `&${varName}(0,0)`,
        `&${varName}[0]`,
        // Eigen internal DenseStorage members — accessible without function calls
        `${varName}.m_storage.m_data.array`,
        `${varName}.m_storage.m_data`,
    ];
    const ptr = await tryGetDataPointer(session, exprs, frameId);
    logger.debug(`[getEigenDataPointer] ${varName} evaluate -> ${ptr}`);
    return ptr;
}

// ── Variables-tree fallback for LLDB/MSVC where evaluation fails ────────────

type EigenInfo = { rows: number; cols: number; dataPtr: string | null };

/**
 * Navigate the DAP variables tree to extract Eigen rows, cols, and data pointer.
 *
 * Eigen::Matrix DenseStorage layout (accessed via variables tree):
 *   - Dynamic: m_storage → { m_rows, m_cols, m_data → { array } }
 *   - Fixed-rows dynamic-cols (e.g. VectorXd): m_storage → { m_rows, m_data → { array } }
 *     cols is compile-time 1 (not stored in m_storage)
 *
 * @param compiledCols  Cols dimension from the type string (-1 = dynamic, else fixed)
 */
export async function getEigenInfoFromTree(
    session: vscode.DebugSession,
    variablesReference: number,
    compiledCols: number
): Promise<EigenInfo> {
    const expand = async (ref: number) => {
        const r = await session.customRequest("variables", { variablesReference: ref });
        return (r?.variables ?? []) as {
            name: string;
            value?: string;
            variablesReference?: number;
            memoryReference?: string;
        }[];
    };

    try {
        let top = await expand(variablesReference);
        logger.debug(
            `[getEigenInfoFromTree] top children: ` +
            top.map(v => `${v.name}=${v.value ?? "?"}`).join(", ")
        );

        // CodeLLDB smart pointer formatter (shared_ptr / unique_ptr / weak_ptr):
        //   synthetic children are "pointer" + "[raw]".
        //   Expanding "pointer" gives either:
        //   (a) the inner object's struct fields (e.g. Eigen base class children)
        //   (b) formatted container elements [0],[1],...
        //   Strategy: use pointer's children as the new "top" (case a),
        //   examining [0] as fallback only for container-wrapped objects (case b).
        if (
            !top.find((v) => v.name === "m_storage") &&
            !top.find((v) => /^Eigen::/.test(v.name))
        ) {
            const ptrChild = top.find(
                (v) => v.name === "pointer" && (v.variablesReference ?? 0) > 0
            );
            if (ptrChild) {
                const ptrChildren = await expand(ptrChild.variablesReference!);
                // Case (a): ptrChildren are the Eigen object's fields / base class
                const hasMStorage = ptrChildren.find((v) => v.name === "m_storage");
                const hasEigenBase = ptrChildren.find((v) => /^Eigen::/.test(v.name));
                if (hasMStorage || hasEigenBase) {
                    top = ptrChildren;
                    logger.debug(
                        `[getEigenInfoFromTree] smart-ptr unwrap via pointer (direct fields); new top: ` +
                        top.map(v => v.name).join(", ")
                    );
                } else {
                    // Case (b): look for [0] (container-wrapped Eigen object)
                    const elem0 = ptrChildren.find(
                        (v) => v.name === "[0]" && (v.variablesReference ?? 0) > 0
                    );
                    if (elem0) {
                        top = await expand(elem0.variablesReference!);
                        logger.debug(
                            `[getEigenInfoFromTree] smart-ptr unwrap via pointer->[0]; new top: ` +
                            top.map(v => v.name).join(", ")
                        );
                    }
                }
            }
        }

        // CodeLLDB may expose the Eigen base class as a single synthetic child:
        // "Eigen::PlainObjectBase<Eigen::Matrix<double, -1, 1, 0, -1, 1>>"
        // m_storage lives inside it — expand one more level.
        if (!top.find((v) => v.name === "m_storage")) {
            const baseChild = top.find(
                (v) => /^Eigen::/.test(v.name) && (v.variablesReference ?? 0) > 0
            );
            if (baseChild?.variablesReference) {
                // Extract compile-time cols from the full template inside the name:
                // "Eigen::PlainObjectBase<Eigen::Matrix<T, Rows, Cols, ...)>"
                if (compiledCols <= 0) {
                    const m = baseChild.name.match(
                        /Eigen::Matrix\s*<[^,]+,\s*[^,]+,\s*(-?\d+)/
                    );
                    if (m) { compiledCols = parseInt(m[1]); }
                }
                const baseChildren = await expand(baseChild.variablesReference);
                logger.debug(
                    `[getEigenInfoFromTree] base children: ` +
                    baseChildren.map(v => `${v.name}=${v.value ?? "?"}`).join(", ")
                );
                top = baseChildren;
            }
        }

        const storageChild = top.find((v) => v.name === "m_storage");
        if (!storageChild?.variablesReference) {
            return { rows: 0, cols: 0, dataPtr: null };
        }

        const storage = await expand(storageChild.variablesReference);
        logger.debug(
            `[getEigenInfoFromTree] m_storage children: ` +
            storage.map(v => `${v.name}=${v.value ?? "?"}`).join(", ")
        );

        // Read m_rows (Dynamic rows)
        const mRowsChild = storage.find((v) => v.name === "m_rows");
        const rows = parseTreeInt(mRowsChild?.value);

        // Read m_cols (Dynamic cols) — only present when cols is dynamic (-1)
        let cols = compiledCols > 0 ? compiledCols : 0;
        if (cols <= 0) {
            const mColsChild = storage.find((v) => v.name === "m_cols");
            cols = parseTreeInt(mColsChild?.value);
        }

        // Navigate m_data → array for data pointer
        const mDataChild = storage.find((v) => v.name === "m_data");
        let dataPtr: string | null = null;
        if (mDataChild?.variablesReference) {
            const mData = await expand(mDataChild.variablesReference);
            logger.debug(
                `[getEigenInfoFromTree] m_data children: ` +
                mData.map(v => `${v.name}=${v.value ?? "?"}(mr=${v.memoryReference ?? "none"})`).join(", ")
            );
            const arrayChild = mData.find((v) => v.name === "array");
            if (arrayChild?.memoryReference) {
                dataPtr = arrayChild.memoryReference;
            } else if (arrayChild?.value) {
                const m = arrayChild.value.match(/0x[0-9a-fA-F]+/);
                dataPtr = m?.[0] ?? null;
            }
        } else if (mDataChild?.value) {
            // m_data may be a pointer value directly
            const m = mDataChild.value.match(/0x[0-9a-fA-F]+/);
            dataPtr = m?.[0] ?? null;
        }

        logger.debug(`[getEigenInfoFromTree] rows=${rows} cols=${cols} dataPtr=${dataPtr}`);
        return { rows, cols, dataPtr };
    } catch {
        return { rows: 0, cols: 0, dataPtr: null };
    }
}

function parseTreeInt(value: string | undefined): number {
    if (!value) { return 0; }
    const m = value.match(/(-?\d+)/);
    return m ? parseInt(m[1]) : 0;
}
