/**
 * gdb/plotProvider.ts — Plot data coordinator for GDB (session.type = "cppdbg").
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { PlotData } from "../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../ILibProviders";
import { EigenPlotProvider } from "./libs/eigen/plotProvider";
import { StdPlotProvider } from "./libs/std/plotProvider";
import { QtPlotProvider } from "./libs/qt/plotProvider";

const PROVIDERS: ILibPlotProvider[] = [
    new EigenPlotProvider(),
    new StdPlotProvider(),
    new QtPlotProvider(),
];

export async function fetchGdbPlotData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PlotData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPlotData(session, varName, info);
        }
    }
    return null;
}
