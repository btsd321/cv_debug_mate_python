/**
 * gdb/libs/eigen/eigenUtils.ts — Eigen helpers for GDB (cppdbg) sessions.
 *
 * Uses (long long) casts to evaluate integer dimensions and obtains the
 * data pointer via standard C++ expressions.  No debugger-type branching.
 */

import * as vscode from "vscode";
import {
    evaluateExpression,
    tryGetDataPointer,
} from "../../debugger";
import { cppTypeToDtype } from "../utils";

// ── Dtype resolution ──────────────────────────────────────────────────────

/**
 * Determine dtype (float32 or float64) from an Eigen type string.
 *
 * Debugger examples:
 *   "Eigen::Matrix<double, -1, -1, 0, -1, -1>"  → float64
 *   "Eigen::Matrix<float, -1, 1, 0, -1, 1>"     → float32
 *   "Eigen::Array<double, 3, 1>"                 → float64
 */
export function eigenDtype(typeStr: string): string {
    const tplMatch = typeStr.match(
        /Eigen::(?:Matrix|Array|Vector|RowVector)\s*<\s*([^,>]+)/
    );
    if (tplMatch) {
        const firstParam = tplMatch[1].trim();
        if (firstParam === "double") { return "float64"; }
        if (firstParam === "float")  { return "float32"; }
        return cppTypeToDtype(firstParam);
    }
    // Shorthand aliases: VectorXd / MatrixXd → double; VectorXf / MatrixXf → float
    if (/X[df]$/.test(typeStr)) {
        return typeStr.endsWith("d") ? "float64" : "float32";
    }
    return "float32"; // safe default
}

export function bytesPerEigenDtype(dtype: string): number {
    if (dtype === "float64") { return 8; }
    if (dtype === "float32") { return 4; }
    return 4;
}

// ── Dimension helpers ─────────────────────────────────────────────────────

/**
 * Evaluate an integer property (.rows() / .cols()) of an Eigen object.
 * Returns 0 on failure.
 */
export async function evalEigenDim(
    session: vscode.DebugSession,
    varName: string,
    prop: "rows" | "cols",
    frameId?: number
): Promise<number> {
    // m_rows / m_cols are Eigen's internal DenseStorage members — accessible
    // even when LLDB cannot call C++ member functions.
    const exprs = [
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

// ── Compile-time dimension parser ────────────────────────────────────────

/**
 * Parse compile-time [Rows, Cols] from an Eigen type template string.
 * Returns [rows, cols] where a value > 0 means fixed at compile time.
 * Dynamic (-1) and unresolvable dimensions return -1.
 * Returns null when the type string is not a recognised Eigen template.
 */
export function parseEigenCompileTimeDims(typeStr: string): [number, number] | null {
    const m = typeStr.match(/Eigen::(?:Matrix|Array)\s*<[^,]+,\s*(-?\d+),\s*(-?\d+)/);
    if (m) { return [parseInt(m[1]), parseInt(m[2])]; }
    if (/Eigen::RowVector/.test(typeStr)) { return [1, -1]; }
    if (/Eigen::Vector/.test(typeStr))    { return [-1, 1]; }
    return null;
}

// ── Data pointer ──────────────────────────────────────────────────────────

/**
 * Obtain the Eigen data pointer using different evaluation strategies.
 *
 * Eigen::DenseBase::data() is the standard accessor and works for both
 * dynamic (MatrixX) and fixed-size matrices.
 */
export async function getEigenDataPointer(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<string | null> {
    const exprs = [
        `(long long)${varName}.data()`,
        `reinterpret_cast<long long>(${varName}.data())`,
        `(long long)&${varName}(0)`,
        `(long long)&${varName}(0,0)`,
        `(long long)&${varName}[0]`,
    ];
    return tryGetDataPointer(session, exprs, frameId);
}
