/**
 * builtins/plotProvider.ts — PlotData extraction from Python built-in sequences.
 *
 * Handles:
 *   list/tuple of numbers          → 1D line/scatter chart (yValues only)
 *   list/tuple of 2-element seqs   → 2D scatter chart   (xValues + yValues)
 *   array.array, range             → 1D chart
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PlotData } from "../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../ILibProviders";
import { fetchListData, evaluateExpression } from "../../pythonDebugger";
import { computeStats } from "../utils";

export class BuiltinsPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        // Accept both short form ("list") and module-qualified form ("builtins.list")
        return /^(builtins\.)?(list|tuple|range)$|^array\.array$/i.test(typeName);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const shape = info.shape;

        // ── list/tuple of 2-element sequences → 2D scatter ───────────────────
        if (shape && shape.length === 2 && shape[1] === 2) {
            const n = shape[0];
            if (n === 0) { return null; }
            const expr =
                `__import__('json').dumps(` +
                `[[float(p[0]), float(p[1])] for p in ${varName}])`;
            const result = await evaluateExpression(session, expr, info.frameId);
            if (!result) { return null; }
            let points: [number, number][];
            try {
                const jsonStr = result.startsWith("'") ? result.slice(1, -1) : result;
                points = JSON.parse(jsonStr) as [number, number][];
            } catch {
                return null;
            }
            if (points.length === 0) { return null; }
            const xValues = points.map(p => p[0]);
            const yValues = points.map(p => p[1]);
            return {
                xValues,
                yValues,
                dtype: "float64",
                length: points.length,
                stats: computeStats(yValues),
                varName,
            };
        }

        // ── flat list/tuple/range/array → 1D chart ────────────────────────────
        const values = await fetchListData(session, varName, info.frameId);
        if (!values || values.length === 0) {
            return null;
        }

        return {
            yValues: values,
            dtype: "float64",
            length: values.length,
            stats: computeStats(values),
            varName,
        };
    }
}
