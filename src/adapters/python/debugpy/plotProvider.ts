/**
 * plotProvider.ts — 1D data extraction coordinator for the Plot Viewer.
 *
 * Dispatches to the first registered ILibPlotProvider that answers
 * canHandle() for the variable's type name.  To add support for a new
 * library (e.g. pandas.Series, jax.Array), create a new provider under
 * src/adapters/python/libs/<libName>/plotProvider.ts, implement
 * ILibPlotProvider, and append an instance to LIB_PLOT_PROVIDERS.
 *
 * Current registry (checked in order):
 *   1. numpy.ndarray  → libs/numpy/plotProvider
 *   2. torch.Tensor   → libs/torch/plotProvider
 *   3. list/tuple/…   → libs/builtins/plotProvider  (fallback)
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { PlotData } from "../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../ILibProviders";
import { NumpyPlotProvider } from "./libs/numpy/plotProvider";
import { TorchPlotProvider } from "./libs/torch/plotProvider";
import { BuiltinsPlotProvider } from "./libs/builtins/plotProvider";

// ── Registry ───────────────────────────────────────────────────────────────

const LIB_PLOT_PROVIDERS: ILibPlotProvider[] = [
    new NumpyPlotProvider(),
    new TorchPlotProvider(),
    new BuiltinsPlotProvider(),   // must be last — handles list/tuple/range
];

// ── Coordinator ────────────────────────────────────────────────────────────

export class PlotProvider {
    constructor(private readonly session: vscode.DebugSession) { }

    async fetchPlotData(
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const typeName = info.typeName ?? "";
        for (const provider of LIB_PLOT_PROVIDERS) {
            if (provider.canHandle(typeName)) {
                return provider.fetchPlotData(this.session, varName, info);
            }
        }
        return null;
    }
}
