/**
 * cppvsdbg/plotProvider.ts — Plot data coordinator for vsdbg (session.type = "cppvsdbg").
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

export async function fetchMsvcPlotData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PlotData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        // MSVC STL: weak_ptr<T> inherits _Ptr_base<T> which stores the managed
        // raw pointer in member _Ptr.  Using _Ptr avoids calling lock() whose
        // return value is a temporary shared_ptr — cppvsdbg cannot chain method
        // calls (e.g. .size(), .data()) on temporaries returned by functions.
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}._Ptr)` : `(*${varName})`;
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
