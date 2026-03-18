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
import { unwrapSmartPointer } from "../shared/utils";

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
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        // GDB cannot reliably chain method calls on temporaries (e.g. lock().size()).
        // For weak_ptr, access the internal raw pointer field _M_ptr (libstdc++) directly.
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}._M_ptr)` : `(*${varName})`;
        typeName = unwrapped.innerType;
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType, variablesReference: 0 };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPlotData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
