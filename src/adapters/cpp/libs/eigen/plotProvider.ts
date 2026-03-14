/**
 * eigen/plotProvider.ts — PlotData extraction from Eigen matrices (C++ / cppdbg).
 *
 * Supported types:
 *   - Eigen::VectorXd / VectorXf       → 1D column vector → PlotData
 *   - Eigen::RowVectorXd / RowVectorXf → 1D row vector    → PlotData
 *   - Eigen::MatrixXd / MatrixXf       → flattened (column-major) → PlotData
 *   - Eigen::Array<T,R,C>              → same as Matrix
 *
 * Data-fetch strategy:
 *   1. Evaluate varName.rows() and varName.cols() for dimensions
 *   2. Obtain data pointer via varName.data() (Eigen standard API)
 *   3. Read rows × cols × sizeof(T) bytes via readMemoryChunked
 *   4. Convert to number[] using typed array (column-major; frontend shows flat)
 *
 * Eigen storage:
 *   - Column-major by default (RowMajor flag rarely used in practice)
 *   - data() always returns pointer to first element regardless of order
 *   - https://eigen.tuxfamily.org/dox/group__TopicStorageOrders.html
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PlotData } from "../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../ILibProviders";
import {
    isUsingLLDB,
    evaluateExpression,
    readMemoryChunked,
    tryGetDataPointer,
} from "../../cppDebugger";
import { cppTypeToDtype, typedBufferToNumbers, computeStats } from "../utils";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Determine dtype (float32 or float64) from an Eigen type string.
 *
 * Debugger examples:
 *   "Eigen::Matrix<double, -1, -1, 0, -1, -1>"  → float64
 *   "Eigen::Matrix<float, -1, 1, 0, -1, 1>"     → float32
 *   "Eigen::Array<double, 3, 1>"                 → float64
 */
function eigenDtype(typeStr: string): string {
    // Prefer explicit template parameter
    const tplMatch = typeStr.match(
        /Eigen::(?:Matrix|Array|Vector|RowVector)\s*<\s*([^,>]+)/
    );
    if (tplMatch) {
        const firstParam = tplMatch[1].trim();
        if (firstParam === "double") {
            return "float64";
        }
        if (firstParam === "float") {
            return "float32";
        }
        return cppTypeToDtype(firstParam);
    }
    // Shorthand aliases: VectorXd / MatrixXd → double; VectorXf / MatrixXf → float
    if (/X[df]$/.test(typeStr)) {
        return typeStr.endsWith("d") ? "float64" : "float32";
    }
    return "float32"; // safe default
}

function bytesPerDtype(dtype: string): number {
    if (dtype === "float64") { return 8; }
    if (dtype === "float32") { return 4; }
    return 4;
}

/**
 * Obtain the Eigen data pointer using different evaluation strategies.
 *
 * Eigen::DenseBase::data() is the standard accessor and works for both
 * MatrixX (dynamic) and fixed-size matrices.
 */
async function getEigenDataPointer(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<string | null> {
    const exprs = isUsingLLDB(session)
        ? [
            `${varName}.data()`,
            `&${varName}(0)`,
            `&${varName}(0,0)`,
            `&${varName}[0]`,
        ]
        : [
            `(long long)${varName}.data()`,
            `reinterpret_cast<long long>(${varName}.data())`,
            `(long long)&${varName}(0)`,
            `(long long)&${varName}(0,0)`,
            `(long long)&${varName}[0]`,
        ];
    return tryGetDataPointer(session, exprs, frameId);
}

/**
 * Evaluate an integer property of the Eigen object (.rows() / .cols()).
 * Returns 0 on failure.
 */
async function evalEigenDim(
    session: vscode.DebugSession,
    varName: string,
    prop: "rows" | "cols",
    frameId?: number
): Promise<number> {
    const exprs = isUsingLLDB(session)
        ? [`${varName}.${prop}()`, `(long long)${varName}.${prop}()`]
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

// ── Provider ──────────────────────────────────────────────────────────────

export class EigenPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        return /Eigen::(Matrix|Array|Vector|RowVector)/i.test(typeName);
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const frameId = info.frameId;
        const typeStr = info.typeName ?? info.type;

        // ── Step 1: dimensions ────────────────────────────────────────────────
        const rows = await evalEigenDim(session, varName, "rows", frameId);
        const cols = await evalEigenDim(session, varName, "cols", frameId);

        if (rows <= 0 || cols <= 0) {
            return null;
        }

        const size = rows * cols;
        const dtype = eigenDtype(typeStr);
        const bpe = bytesPerDtype(dtype);
        const totalBytes = size * bpe;

        // ── Step 2: data pointer ──────────────────────────────────────────────
        const dataPtr = await getEigenDataPointer(session, varName, frameId);
        if (!dataPtr) {
            return null;
        }

        // ── Step 3: read memory ───────────────────────────────────────────────
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            return null;
        }

        // ── Step 4: convert to numbers ────────────────────────────────────────
        // Eigen is column-major by default; the flat array is valid for a 1D plot
        const yValues = typedBufferToNumbers(buffer, dtype);
        const stats = computeStats(yValues);

        return {
            yValues,
            dtype,
            length: size,
            stats,
            varName,
        };
    }
}
