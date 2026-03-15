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

const PROVIDERS: ILibPointCloudProvider[] = [
    new PclPointCloudProvider(),
    new StdPointCloudProvider(),
    new QtPointCloudProvider(),
];

export async function fetchGdbPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PointCloudData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPointCloudData(session, varName, info);
        }
    }
    return null;
}
