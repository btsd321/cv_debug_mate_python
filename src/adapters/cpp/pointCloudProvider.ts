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

type LogFn = (level: "DEBUG" | "INFO" | "WARN" | "ERROR", msg: string) => void;

// ── Provider registry ─────────────────────────────────────────────────────

function buildProviders(log: LogFn): ILibPointCloudProvider[] {
    return [
        new PclPointCloudProvider(log),
        new StdPointCloudProvider(),
    ];
}

// ── Coordinator ───────────────────────────────────────────────────────────

export async function fetchCppPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo,
    log: LogFn = () => undefined
): Promise<PointCloudData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of buildProviders(log)) {
        if (provider.canHandle(typeName)) {
            return provider.fetchPointCloudData(session, varName, info);
        }
    }
    return null;
}
