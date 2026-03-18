/**
 * qt/variableInfoEnricher.ts (cppvsdbg)
 *
 * Enriches bare Qt container types ("QVector" / "QList" without template
 * argument) by inspecting the first indexed DAP child ([0]) to infer the
 * element type and reconstruct the full templated type string.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { IVariableInfoEnricher } from "../../../IVariableInfoEnricher";
import { logger } from "../../../../../log/logger";

export class QtBareTypeEnricher implements IVariableInfoEnricher {
    canEnrich(typeStr: string): boolean {
        return /^Q(?:Vector|List)$/.test(typeStr);
    }

    async enrich(
        session: vscode.DebugSession,
        info: VariableInfo
    ): Promise<void> {
        if (!info.variablesReference || info.variablesReference <= 0) { return; }
        const typeStr = info.typeName ?? info.type;
        try {
            const resp = await session.customRequest("variables", {
                variablesReference: info.variablesReference,
            });
            const children: Array<{ name: string; type?: string }> =
                resp?.variables ?? [];
            const first = children.find((v) => v.name === "[0]");
            if (first?.type) {
                const reconstructed = `${typeStr}<${first.type.trim()}>`;
                info.typeName = reconstructed;
                info.type = reconstructed;
                logger.debug(
                    `QtBareTypeEnricher(cppvsdbg): "${info.name}" "${typeStr}" → "${reconstructed}"`
                );
            }
        } catch {
            // best-effort; never throws
        }
    }
}
