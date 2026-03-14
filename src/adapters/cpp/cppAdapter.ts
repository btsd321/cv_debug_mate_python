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
import { getVariablesInScope, getVariableInfo, evaluateExpression, isUsingLLDB } from "./cppDebugger";
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
        session: vscode.DebugSession,
        varName: string,
        frameId?: number
    ): Promise<VariableInfo | null> {
        const info = await getVariableInfo(session, varName, frameId);
        if (!info) {
            return null;
        }

        // For Eigen types, query runtime .rows() / .cols() so Layer-2
        // detectVisualizableType can distinguish line / scatter / image.
        if (/Eigen::(Matrix|Array|Vector|RowVector)/i.test(info.type)) {
            const rows = await this._evalEigenDim(session, varName, "rows", info.frameId);
            const cols = await this._evalEigenDim(session, varName, "cols", info.frameId);
            if (rows > 0 && cols > 0) {
                info.shape = [rows, cols];
            }
        }

        return info;
    }

    /** Evaluate .rows() or .cols() on an Eigen variable; returns 0 on failure. */
    private async _evalEigenDim(
        session: vscode.DebugSession,
        varName: string,
        prop: "rows" | "cols",
        frameId?: number
    ): Promise<number> {
        // m_rows / m_cols are Eigen's internal DenseStorage members — accessible
        // even when LLDB cannot call C++ member functions.
        const internalProp = prop === "rows" ? "m_rows" : "m_cols";
        const exprs = isUsingLLDB(session)
            ? [
                `${varName}.${prop}()`,
                `(long long)${varName}.${prop}()`,
                `${varName}.m_storage.${internalProp}`,
                `(long long)${varName}.m_storage.${internalProp}`,
            ]
            : [
                `(int)${varName}.${prop}()`,
                `${varName}.${prop}()`,
                `(long long)${varName}.${prop}()`,
            ];
        for (const expr of exprs) {
            const res = await evaluateExpression(session, expr, frameId);
            const n = parseInt(res ?? "");
            if (!isNaN(n) && n > 0 && n < 100_000_000) {
                return n;
            }
        }
        return 0;
    }

    // ── Type detection ────────────────────────────────────────────────────

    basicTypeDetect(typeStr: string): VisualizableKind {
        return basicTypeDetect(typeStr);
    }

    detectVisualizableType(info: VariableInfo): VisualizableKind {
        const typeStr = info.typeName ?? info.type;
        const kind = basicTypeDetect(typeStr);

        // Layer-2 refinement for Eigen: use runtime shape to route
        // image → plot when the matrix is 1D or 2-column (scatter).
        if (kind === "image" && /Eigen::(Matrix|Array)/i.test(typeStr) && info.shape) {
            const [rows, cols] = info.shape;
            if (cols === 1 || rows === 1 || cols === 2) {
                return "plot";
            }
        }

        return kind;
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
        info: VariableInfo,
        log?: (level: "DEBUG" | "INFO" | "WARN" | "ERROR", msg: string) => void
    ): Promise<PointCloudData | null> {
        return fetchCppPointCloudData(session, varName, info, log);
    }
}
