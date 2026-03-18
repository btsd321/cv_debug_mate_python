/**
 * cppvsdbg/variableInfoEnrichers.ts — Variable-info enrichment coordinator
 * for vsdbg (session.type = "cppvsdbg").
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { IVariableInfoEnricher } from "../IVariableInfoEnricher";
import { QtBareTypeEnricher } from "./libs/qt/variableInfoEnricher";

const ENRICHERS: IVariableInfoEnricher[] = [
    new QtBareTypeEnricher(),
];

export async function enrichMsvcVariableInfo(
    session: vscode.DebugSession,
    info: VariableInfo
): Promise<void> {
    const typeStr = info.typeName ?? info.type;
    for (const enricher of ENRICHERS) {
        if (enricher.canEnrich(typeStr)) {
            await enricher.enrich(session, info);
            break;
        }
    }
}
