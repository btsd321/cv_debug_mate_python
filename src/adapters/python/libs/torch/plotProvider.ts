/**
 * torch/plotProvider.ts — PlotData extraction from torch.Tensor.
 *
 * Handles: torch.Tensor shape (N,) or any 1D-compatible tensor.
 * Detaches from autograd and serialises via JSON (avoids Base64 overhead
 * for typical 1D signal sizes).
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PlotData } from "../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../ILibProviders";
import { evaluateExpression } from "../../pythonDebugger";
import { computeStats } from "../utils";

export class TorchPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        return /torch\.Tensor|torch\.cuda\.|torch\..*[Tt]ensor/i.test(typeName);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const expr =
            `__import__('json').dumps(` +
            `${varName}.detach().cpu().flatten().tolist())`;

        const result = await evaluateExpression(session, expr, info.frameId);
        if (!result) {
            return null;
        }

        let values: number[];
        try {
            values = JSON.parse(result.replace(/^'|'$/g, "")) as number[];
        } catch {
            return null;
        }

        if (values.length === 0) {
            return null;
        }

        return {
            yValues: values,
            dtype: info.dtype ?? "float32",
            length: values.length,
            stats: computeStats(values),
            varName,
        };
    }
}
