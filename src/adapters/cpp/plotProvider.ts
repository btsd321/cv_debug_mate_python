/**
 * plotProvider.ts — C++ plot data coordinator.
 *
 * Iterates LIB_PLOT_PROVIDERS in order and delegates to the first provider
 * whose canHandle() returns true.  Adding a new library requires only:
 *   1. Creating a new ILibPlotProvider implementation in libs/<libName>/
 *   2. Appending an instance to LIB_PLOT_PROVIDERS below.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../IDebugAdapter";
import { PlotData } from "../../viewers/viewerTypes";
import { ILibPlotProvider } from "../ILibProviders";
import { EigenPlotProvider } from "./libs/eigen/plotProvider";
import { StdPlotProvider } from "./libs/std/plotProvider";
import { QtPlotProvider } from "./libs/qt/plotProvider";

// ── Provider registry ───────────────────────────────────────────

const LIB_PLOT_PROVIDERS: ILibPlotProvider[] = [
    new EigenPlotProvider(),
    new StdPlotProvider(),
    new QtPlotProvider(),
];

// ── Coordinator ───────────────────────────────────────────────────────────

export async function fetchCppPlotData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PlotData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of LIB_PLOT_PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPlotData(session, varName, info);
        }
    }
    return null;
}
