/**
 * pythonAdapter.ts — IDebugAdapter implementation for Python / debugpy.
 *
 * Wraps all Python-specific provider classes and delegates to them.
 * The extension core never instantiates providers directly; it calls
 * methods on this adapter via the IDebugAdapter interface.
 *
 * Supported session types: "python", "debugpy", "jupyter"
 */

import * as vscode from "vscode";
import { IDebugAdapter, VariableInfo, VisualizableKind } from "../IDebugAdapter";
import { ImageData, PlotData, PointCloudData } from "../../viewers/viewerTypes";
import {
    isPythonSession,
    isJupyterSession,
    getVariablesInScope,
    getVariableInfo,
} from "./pythonDebugger";
import { basicTypeDetect, detectVisualizableType } from "./pythonTypes";
import { ImageProvider } from "./imageProvider";
import { PlotProvider } from "./plotProvider";
import { PointCloudProvider } from "./pointCloudProvider";

export class PythonAdapter implements IDebugAdapter {
    isSupportedSession(session: vscode.DebugSession): boolean {
        return isPythonSession(session) || isJupyterSession(session);
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
        return getVariableInfo(session, varName, frameId);
    }

    // ── Type detection ────────────────────────────────────────────────────

    basicTypeDetect(typeStr: string): VisualizableKind {
        return basicTypeDetect(typeStr);
    }

    detectVisualizableType(info: VariableInfo): VisualizableKind {
        return detectVisualizableType(info);
    }

    // ── Data fetching ─────────────────────────────────────────────────────

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        return new ImageProvider(session).fetchImageData(varName, info);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        return new PlotProvider(session).fetchPlotData(varName, info);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        return new PointCloudProvider(session).fetchPointCloudData(varName, info);
    }
}
