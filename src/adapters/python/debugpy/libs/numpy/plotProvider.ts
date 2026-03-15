/**
 * numpy/plotProvider.ts — PlotData extraction from numpy.ndarray.
 *
 * Handles: ndarray shape (N,), (1,N), (N,1) — flattened via .ravel()
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PlotData } from "../../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../../ILibProviders";
import { fetchArrayData } from "../../debugger";
import { typedBufferToNumbers, computeStats } from "../utils";

export class NumpyPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        return /numpy\.|ndarray/i.test(typeName);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const shape = info.shape;
        if (!shape || shape.length === 0) {
            return null;
        }

        // ── [N, 2] → 2D scatter (xValues + yValues) ─────────────────────────
        if (shape.length === 2 && shape[1] === 2) {
            const n = shape[0];
            if (n === 0) { return null; }
            const flatInfo: VariableInfo = { ...info, shape: [n * 2], dtype: "float64" };
            const raw = await fetchArrayData(
                session,
                `${varName}.astype('float64').ravel()`,
                flatInfo
            );
            if (!raw) { return null; }
            const all = typedBufferToNumbers(raw.buffer, "float64");
            const xValues: number[] = [];
            const yValues: number[] = [];
            for (let i = 0; i < n; i++) {
                xValues.push(all[i * 2]);
                yValues.push(all[i * 2 + 1]);
            }
            return {
                xValues,
                yValues,
                dtype: info.dtype ?? "float64",
                length: n,
                stats: computeStats(yValues),
                varName,
            };
        }

        // ── [N] or any other 1D-compatible shape → standard 1D plot ──────────
        if (shape.length !== 1) {
            return null;
        }
        const totalLen = shape[0];
        if (totalLen === 0) {
            return null;
        }

        const flatInfo: VariableInfo = { ...info, shape: [totalLen] };
        const raw = await fetchArrayData(session, `${varName}.ravel()`, flatInfo);
        if (!raw) {
            return null;
        }

        const values = typedBufferToNumbers(raw.buffer, raw.dtype);
        if (values.length === 0) {
            return null;
        }

        return {
            yValues: values,
            dtype: info.dtype ?? "float64",
            length: values.length,
            stats: computeStats(values),
            varName,
        };
    }
}
