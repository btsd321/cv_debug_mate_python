/**
 * cppAdapter.ts — IDebugAdapter for C++ debug sessions.
 *
 * Routes to per-debugger implementations:
 *   "cppdbg"   → gdb/      (GDB via Microsoft C/C++ extension)
 *   "lldb"     → codelldb/ (CodeLLDB)
 *   "cppvsdbg" → cppvsdbg/ (Visual C++ / vsdbg on Windows)
 */

import * as vscode from "vscode";
import { IDebugAdapter, VariableInfo, VisualizableKind } from "../IDebugAdapter";
import { ImageData, PlotData, PointCloudData } from "../../viewers/viewerTypes";
import { basicTypeDetect } from "./cppTypes";
import { logger } from "../../log/logger";

// ── Per-debugger variable scope / evaluate ────────────────────────────────
import {
    getVariablesInScope as getVarsScopeGdb,
    evaluateExpression as evaluateGdb,
    getVariableInfo,
} from "./gdb/debugger";
import {
    getVariablesInScope as getVarsScopeLldb,
    evaluateExpression as evaluateLldb,
} from "./codelldb/debugger";
import {
    getVariablesInScope as getVarsScopeMsvc,
    evaluateExpression as evaluateMsvc,
} from "./cppvsdbg/debugger";

// ── Per-debugger data coordinators ────────────────────────────────────────
import { fetchGdbImageData } from "./gdb/imageProvider";
import { fetchGdbPlotData } from "./gdb/plotProvider";
import { fetchGdbPointCloudData } from "./gdb/pointCloudProvider";
import { enrichGdbVariableInfo } from "./gdb/variableInfoEnrichers";
import { fetchLldbImageData } from "./codelldb/imageProvider";
import { fetchLldbPlotData } from "./codelldb/plotProvider";
import { fetchLldbPointCloudData } from "./codelldb/pointCloudProvider";
import { enrichLldbVariableInfo } from "./codelldb/variableInfoEnrichers";
import { fetchMsvcImageData } from "./cppvsdbg/imageProvider";
import { fetchMsvcPlotData } from "./cppvsdbg/plotProvider";
import { fetchMsvcPointCloudData } from "./cppvsdbg/pointCloudProvider";
import { enrichMsvcVariableInfo } from "./cppvsdbg/variableInfoEnrichers";
import { unwrapSmartPointer } from "./shared/utils";

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
        if (session.type === "lldb") { return getVarsScopeLldb(session); }
        if (session.type === "cppvsdbg") { return getVarsScopeMsvc(session); }
        return getVarsScopeGdb(session);
    }

    async getVariableInfo(
        session: vscode.DebugSession,
        varName: string,
        frameId?: number
    ): Promise<VariableInfo | null> {
        // getVariableInfo is identical across debuggers (re-exported from shared)
        const info = await getVariableInfo(session, varName, frameId);
        if (!info) {
            return null;
        }

        // Run per-debugger variable-info enrichers (e.g. reconstruct bare Qt
        // container types that GDB reports without template arguments).
        if (session.type === "lldb") { await enrichLldbVariableInfo(session, info); }
        else if (session.type === "cppvsdbg") { await enrichMsvcVariableInfo(session, info); }
        else { await enrichGdbVariableInfo(session, info); }
        logger.debug(`getVariableInfo post-enrich: "${varName}" typeName="${info.typeName ?? info.type}"`);

        // For Eigen types, query runtime .rows() / .cols() so Layer-2
        // detectVisualizableType can distinguish line / scatter / image.
        if (/Eigen::(Matrix|Array|Vector|RowVector)/i.test(info.typeName ?? info.type)) {
            // If the Eigen object is wrapped in a smart pointer, evaluate dimensions
            // via the dereference expression so member access works correctly.
            const ptrUnwrapped = unwrapSmartPointer(info.typeName ?? info.type);
            const eigenVarName = ptrUnwrapped !== null
                ? (ptrUnwrapped.kind === "lock_deref" ? `(*${varName}.lock())` : `(*${varName})`)
                : varName;
            // Skip _evalEigenDim for dimensions known at compile time (e.g. VectorXd
            // has ColsAtCompileTime=1; m_storage.m_cols does not exist at runtime).
            const ctDims = this._parseEigenCompileTimeDims(info.typeName ?? info.type);
            const rows = (ctDims && ctDims[0] > 0)
                ? ctDims[0]
                : await this._evalEigenDim(session, eigenVarName, "rows", info.frameId);
            const cols = (ctDims && ctDims[1] > 0)
                ? ctDims[1]
                : await this._evalEigenDim(session, eigenVarName, "cols", info.frameId);
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
        const exprs = session.type === "lldb"
            ? [
                // On Windows/PDB, LLDB cannot JIT-compile function calls (.rows()),
                // but can access struct fields via memory read (m_storage.m_rows).
                // Try field access first; fall back to function call for Linux/macOS.
                `${varName}.m_storage.${internalProp}`,
                `${varName}.${prop}()`,
                `(long long)${varName}.${prop}()`,
            ]
            : [
                `(int)${varName}.${prop}()`,
                `${varName}.${prop}()`,
                `(long long)${varName}.${prop}()`,
            ];
        for (const expr of exprs) {
            const res = await this._evaluateExpression(session, expr, frameId);
            const n = parseInt(res ?? "");
            if (!isNaN(n) && n > 0 && n < 100_000_000) {
                return n;
            }
        }
        return 0;
    }

    /** Parse Eigen compile-time [rows, cols] from a type string; -1 = dynamic. */
    private _parseEigenCompileTimeDims(typeStr: string): [number, number] | null {
        const m = typeStr.match(/Eigen::(?:Matrix|Array)\s*<[^,]+,\s*(-?\d+),\s*(-?\d+)/);
        if (m) { return [parseInt(m[1]), parseInt(m[2])]; }
        if (/Eigen::RowVector/.test(typeStr)) { return [1, -1]; }
        if (/Eigen::Vector/.test(typeStr))    { return [-1, 1]; }
        return null;
    }

    /** Route evaluateExpression to the correct per-debugger implementation. */
    private _evaluateExpression(
        session: vscode.DebugSession,
        expr: string,
        frameId?: number
    ): Promise<string | null> {
        if (session.type === "lldb") { return evaluateLldb(session, expr, frameId); }
        if (session.type === "cppvsdbg") { return evaluateMsvc(session, expr, frameId); }
        return evaluateGdb(session, expr, frameId);
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
        if (session.type === "lldb") { return fetchLldbImageData(session, varName, info); }
        if (session.type === "cppvsdbg") { return fetchMsvcImageData(session, varName, info); }
        return fetchGdbImageData(session, varName, info);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        if (session.type === "lldb") { return fetchLldbPlotData(session, varName, info); }
        if (session.type === "cppvsdbg") { return fetchMsvcPlotData(session, varName, info); }
        return fetchGdbPlotData(session, varName, info);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        if (session.type === "lldb") { return fetchLldbPointCloudData(session, varName, info); }
        if (session.type === "cppvsdbg") { return fetchMsvcPointCloudData(session, varName, info); }
        return fetchGdbPointCloudData(session, varName, info);
    }
}
