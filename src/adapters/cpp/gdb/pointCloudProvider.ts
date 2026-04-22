/**
 * gdb/pointCloudProvider.ts — Point cloud coordinator for GDB (session.type = "cppdbg").
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { PointCloudData } from "../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../ILibProviders";
import { PclPointCloudProvider } from "./libs/pcl/pointCloudProvider";
import { StdPointCloudProvider } from "./libs/std/pointCloudProvider";
import { QtPointCloudProvider } from "./libs/qt/pointCloudProvider";
import { Ros2PointCloudProvider } from "./libs/ros2/pointCloudProvider";
import { unwrapSmartPointer } from "../shared/utils";

const PROVIDERS: ILibPointCloudProvider[] = [
    new PclPointCloudProvider(),
    new StdPointCloudProvider(),
    new QtPointCloudProvider(),
    new Ros2PointCloudProvider(),
];

export async function fetchGdbPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PointCloudData | null> {
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
            return provider.fetchPointCloudData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
