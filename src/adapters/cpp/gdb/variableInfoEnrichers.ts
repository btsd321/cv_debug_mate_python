/**
 * gdb/variableInfoEnrichers.ts — Variable-info enrichment coordinator for GDB.
 *
 * Iterates all registered IVariableInfoEnricher instances and delegates to
 * the first whose canEnrich() returns true, following the same coordinator
 * pattern used by imageProvider / plotProvider / pointCloudProvider.
 *
 * To add enrichment for a new library:
 *   1. Create  libs/<libName>/variableInfoEnricher.ts  implementing
 *      IVariableInfoEnricher.
 *   2. Append a new instance to the ENRICHERS array below — no other files
 *      need changing.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { IVariableInfoEnricher } from "../IVariableInfoEnricher";
import { QtBareTypeEnricher } from "./libs/qt/variableInfoEnricher";

const ENRICHERS: IVariableInfoEnricher[] = [
    new QtBareTypeEnricher(),
];

/**
 * Run all registered variable-info enrichers for the GDB debugger.
 * Mutates `info` in-place; best-effort (never throws).
 */
export async function enrichGdbVariableInfo(
    session: vscode.DebugSession,
    info: VariableInfo
): Promise<void> {
    const typeStr = info.typeName ?? info.type;
    for (const enricher of ENRICHERS) {
        if (enricher.canEnrich(typeStr)) {
            await enricher.enrich(session, info);
            // Re-read typeStr after enrichment; a later enricher may need the
            // updated type.  Break early unless multiple enrichers are expected
            // to chain (currently each variable matches at most one enricher).
            break;
        }
    }
}
