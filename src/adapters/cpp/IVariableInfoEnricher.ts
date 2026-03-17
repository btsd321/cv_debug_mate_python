/**
 * IVariableInfoEnricher.ts — Compatibility layer for variable-info enrichment.
 *
 * Some debuggers (e.g. GDB with Qt pretty-printers) report incomplete type
 * strings for certain containers (bare "QVector" instead of "QVector<float>").
 * Library-specific enrichers implement this interface to reconstruct the full
 * type metadata so all downstream type-detection functions receive accurate
 * information.
 *
 * Placement rules  (mirrors ILibProviders.ts):
 *   - This file defines the interface only — no logic.
 *   - Implementations live in  adapters/cpp/<debugger>/libs/<libName>/variableInfoEnricher.ts
 *   - Per-debugger coordinators register instances in
 *     adapters/cpp/<debugger>/variableInfoEnrichers.ts
 */

import * as vscode from "vscode";
import { VariableInfo } from "../IDebugAdapter";

export interface IVariableInfoEnricher {
    /**
     * Return true when this enricher can refine the metadata of a variable
     * whose current type string is `typeStr` (possibly bare / incomplete).
     */
    canEnrich(typeStr: string): boolean;

    /**
     * Mutate `info` in-place to fill in missing or incomplete metadata
     * (e.g. reconstruct a bare template type from the DAP variable tree).
     *
     * Contract:
     *   - Must never throw; catch all errors internally and degrade silently.
     *   - Only modify `info.type` / `info.typeName` (and `info.shape` /
     *     `info.dtype` when genuinely enriched).
     *   - Must be idempotent — called at most once per getVariableInfo invocation.
     */
    enrich(
        session: vscode.DebugSession,
        info: VariableInfo
    ): Promise<void>;
}
