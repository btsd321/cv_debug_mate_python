/**
 * codelldb/pointCloudProvider.ts — Point cloud coordinator for CodeLLDB (session.type = "lldb").
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { PointCloudData } from "../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../ILibProviders";
import { PclPointCloudProvider } from "./libs/pcl/pointCloudProvider";
import { StdPointCloudProvider } from "./libs/std/pointCloudProvider";
import { QtPointCloudProvider } from "./libs/qt/pointCloudProvider";
import { unwrapSmartPointer } from "../shared/utils";

const PROVIDERS: ILibPointCloudProvider[] = [
    new PclPointCloudProvider(),
    new StdPointCloudProvider(),
    new QtPointCloudProvider(),
];

export async function fetchLldbPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PointCloudData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}.lock())` : `(*${varName})`;
        typeName = unwrapped.innerType;
        // Keep variablesReference: CodeLLDB synthetic formatters expose the
        // pointed-to object's element tree through the smart pointer's reference.
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPointCloudData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
