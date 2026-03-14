/**
 * ILibProviders.ts — Per-library data provider interfaces.
 *
 * Language-agnostic interfaces that each third-party library adapter
 * (numpy, PIL, torch, opencv, eigen, pcl, open3d, …) must implement.
 * The coordinator providers (imageProvider.ts, plotProvider.ts,
 * pointCloudProvider.ts) iterate a registered list of ILibXxx instances
 * and delegate to the first one whose canHandle() returns true.
 *
 * Adding support for a new library:
 *   1. Create  src/adapters/<lang>/libs/<libName>/<imageProvider|plotProvider|…>.ts
 *   2. Implement the relevant interface(s) below.
 *   3. Register the new instance in the coordinator's LIB_PROVIDERS array.
 */

import * as vscode from "vscode";
import { VariableInfo } from "./IDebugAdapter";
import { ImageData, PlotData, PointCloudData } from "../viewers/viewerTypes";

// ── Image ──────────────────────────────────────────────────────────────────

export interface ILibImageProvider {
    /**
     * Return true if this provider can produce ImageData from a variable
     * whose type string is `typeName`.
     */
    canHandle(typeName: string): boolean;

    fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null>;
}

// ── Plot ───────────────────────────────────────────────────────────────────

export interface ILibPlotProvider {
    canHandle(typeName: string): boolean;

    fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null>;
}

// ── Point Cloud ────────────────────────────────────────────────────────────

export interface ILibPointCloudProvider {
    canHandle(typeName: string): boolean;

    fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null>;
}
