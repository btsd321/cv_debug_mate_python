/**
 * IDebugAdapter.ts — Language-agnostic debug adapter contract.
 *
 * Defines the interface that every language-specific debug adapter must
 * implement. The extension core (extension.ts, panelManager.ts, etc.) only
 * depends on this interface — never on Python- or C++-specific code.
 *
 * Language adapters live in:
 *   src/adapters/python/   — Python / debugpy / Jupyter
 *   src/adapters/cpp/      — C++ / cppdbg / lldb
 *
 * To add a new language, implement IDebugAdapter and register the class
 * in src/adapters/adapterRegistry.ts.
 */

import * as vscode from "vscode";
import { ImageData, PlotData, PointCloudData } from "../viewers/viewerTypes";

// ── Shared data types ─────────────────────────────────────────────────────

/** Coarse classification of a variable's visualizable kind. */
export type VisualizableKind = "image" | "plot" | "pointcloud" | "unknown";

/**
 * Language-agnostic variable metadata.
 * All adapters produce instances of this for the TreeView and panel refresh.
 *
 * Fields map naturally to concepts present in all target languages:
 *   - `typeName`  →  "numpy.ndarray", "cv::Mat", "Eigen::MatrixXf", …
 *   - `shape`     →  [H, W, C] / [rows, cols] / [N]
 *   - `dtype`     →  "float32", "uint8", …
 */
export interface VariableInfo {
    name: string;
    /** Raw DAP `type` string from the variables response */
    type: string;
    /** Fully-qualified type name, e.g. "numpy.ndarray", "cv::Mat" */
    typeName?: string;
    shape?: number[] | null;
    dtype?: string | null;
    length?: number | null;
    /** DAP frame ID used for evaluate requests */
    frameId?: number;
    /** DAP variablesReference (for tree expansion) */
    variablesReference?: number;
}

// ── Adapter interface ─────────────────────────────────────────────────────

export interface IDebugAdapter {
    /**
     * Returns true if this adapter handles the given debug session type.
     * The registry calls this to find the right adapter for a session.
     */
    isSupportedSession(session: vscode.DebugSession): boolean;

    // ── Variable enumeration ──────────────────────────────────────────────

    /** List all variables visible in the current frame's local scope. */
    getVariablesInScope(session: vscode.DebugSession): Promise<VariableInfo[]>;

    /**
     * Enrich a variable with shape, dtype, and typeName metadata.
     * Called before opening a viewer panel or refreshing it.
     */
    getVariableInfo(
        session: vscode.DebugSession,
        varName: string,
        frameId?: number
    ): Promise<VariableInfo | null>;

    // ── Type detection ────────────────────────────────────────────────────

    /**
     * Layer-1 quick detection from the raw DAP type string only.
     * Used in the TreeView to avoid slow evaluate calls for every variable.
     * May return a coarse match; Layer-2 (detectVisualizableType) refines it.
     */
    basicTypeDetect(typeStr: string): VisualizableKind;

    /**
     * Layer-2 accurate detection using fully-resolved VariableInfo
     * (shape + dtype available). Called before opening a viewer.
     */
    detectVisualizableType(info: VariableInfo): VisualizableKind;

    // ── Data fetching ─────────────────────────────────────────────────────

    /** Fetch pixel data as an ImageData suitable for the Image Viewer. */
    fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null>;

    /** Fetch 1D series data as a PlotData suitable for the Plot Viewer. */
    fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null>;

    /** Fetch 3D point data as a PointCloudData for the Point Cloud Viewer. */
    fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null>;
}
