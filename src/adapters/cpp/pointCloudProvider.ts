/**
 * pointCloudProvider.ts — C++ point cloud data coordinator.
 *
 * Iterates LIB_POINTCLOUD_PROVIDERS in order and delegates to the first
 * provider whose canHandle() returns true.  Adding a new library requires:
 *   1. Creating a new ILibPointCloudProvider implementation in libs/<libName>/
 *   2. Appending an instance to LIB_POINTCLOUD_PROVIDERS below.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../IDebugAdapter";
import { PointCloudData } from "../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../ILibProviders";
import { PclPointCloudProvider } from "./libs/pcl/pointCloudProvider";
import { StdPointCloudProvider } from "./libs/std/pointCloudProvider";

// ── Provider registry ─────────────────────────────────────────────────────

const LIB_POINTCLOUD_PROVIDERS: ILibPointCloudProvider[] = [
    new PclPointCloudProvider(),
    new StdPointCloudProvider(),
];

// ── Coordinator ───────────────────────────────────────────────────────────

export async function fetchCppPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<PointCloudData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of LIB_POINTCLOUD_PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPointCloudData(session, varName, info);
        }
    }
    return null;
}
