/**
 * cppvsdbg/pointCloudProvider.ts — Point cloud data coordinator for vsdbg (session.type = "cppvsdbg").
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

export async function fetchMsvcPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PointCloudData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        // MSVC STL: weak_ptr<T> → _Ptr_base<T>::_Ptr is the raw managed pointer.
        // Avoids chaining methods on the temporary shared_ptr returned by lock().
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}._Ptr)` : `(*${varName})`;
        typeName = unwrapped.innerType;
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType, variablesReference: 0 };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPointCloudData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
