/**
 * codelldb/plotProvider.ts — Plot data coordinator for CodeLLDB (session.type = "lldb").
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

export async function fetchLldbPlotData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PlotData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}.lock())` : `(*${varName})`;
        typeName = unwrapped.innerType;
        // For CodeLLDB, LLDB's synthetic formatters expose smart-pointer children
        // as the pointed-to object's elements ([0], [1], ...).  Keep the original
        // variablesReference so tree-based fallbacks (getVectorSizeFromChildren,
        // getVectorDataPointer) can navigate the element tree when expression
        // evaluation fails (e.g. weak_ptr where .lock() cannot be called).
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPlotData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
