/**
 * cppAdapter.ts — IDebugAdapter stub for C++ debug sessions.
 *
 * Handles sessions of type "cppdbg" (Microsoft C/C++ extension),
 * "lldb" (CodeLLDB), and "cppvsdbg" (Visual C++ on Windows).
 *
 * Current state: all fetch methods return null (not yet implemented).
 * Implement the TODO sections to add support for:
 *   - Eigen::Matrix / Eigen::Array → image, plot, pointcloud
 *   - cv::Mat                      → image
 *   - std::vector<T>               → plot
 *   - pcl::PointCloud              → pointcloud
 *
 * See docs/cpp-adapter.md for the planned implementation strategy.
 */

import * as vscode from "vscode";
import { IDebugAdapter, VariableInfo, VisualizableKind } from "../IDebugAdapter";
import { ImageData, PlotData, PointCloudData } from "../../viewers/viewerTypes";
import { basicTypeDetect } from "./cppTypes";
import { getVariablesInScope } from "./cppDebugger";
import { fetchCppImageData } from "./imageProvider";
import { fetchCppPlotData } from "./plotProvider";
import { fetchCppPointCloudData } from "./pointCloudProvider";

export class CppAdapter implements IDebugAdapter {
    isSupportedSession(session: vscode.DebugSession): boolean {
        return (
            session.type === "cppdbg" ||
            session.type === "lldb" ||
            session.type === "cppvsdbg"
        );
    }

    // ── Variable enumeration ──────────────────────────────────────────────

    async getVariablesInScope(
        session: vscode.DebugSession
    ): Promise<VariableInfo[]> {
        return getVariablesInScope(session);
    }

    async getVariableInfo(
        _session: vscode.DebugSession,
        varName: string,
        frameId?: number
    ): Promise<VariableInfo | null> {
        // Returns a minimal VariableInfo; providers extract shape/dtype internally.
        // Full shape resolution (rows, cols, dtype) is deferred to each lib provider.
        return { name: varName, type: "", frameId };
    }

    // ── Type detection ────────────────────────────────────────────────────

    basicTypeDetect(typeStr: string): VisualizableKind {
        return basicTypeDetect(typeStr);
    }

    detectVisualizableType(info: VariableInfo): VisualizableKind {
        return basicTypeDetect(info.typeName ?? info.type);
    }

    // ── Data fetching ─────────────────────────────────────────────────────

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        return fetchCppImageData(session, varName, info);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        return fetchCppPlotData(session, varName, info);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        return fetchCppPointCloudData(session, varName, info);
    }
}
