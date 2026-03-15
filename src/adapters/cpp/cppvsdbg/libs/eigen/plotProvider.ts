/**
 * eigen/plotProvider.ts — PlotData extraction from Eigen matrices (C++ / cppdbg).
 *
 * Supported types:
 *   - Eigen::VectorXd / VectorXf       → 1D column vector → line plot
 *   - Eigen::RowVectorXd / RowVectorXf → 1D row vector    → line plot
 *   - Eigen::MatrixXd rows=N, cols=1   → 1D vector        → line plot
 *   - Eigen::MatrixXd rows=N, cols=2   → N×2 matrix       → 2D scatter (col0=X, col1=Y)
 *   - Eigen::MatrixXd rows=1, cols=N   → row vector       → line plot
 *   - Eigen::Array<T,R,C>              → same rules as Matrix
 *
 * Data-fetch strategy:
 *   1. Evaluate varName.rows() and varName.cols() for dimensions
 *   2. Obtain data pointer via varName.data() (Eigen standard API)
 *   3. Read rows × cols × sizeof(T) bytes via readMemoryChunked
 *   4a. cols==2: split column-major flat buffer → xValues (col0) + yValues (col1)
 *   4b. otherwise: flat array → yValues (line plot)
 *
 * Eigen storage:
 *   - Column-major by default; for N×2:  buffer = [x0,x1,...,xN-1, y0,y1,...,yN-1]
 *   - https://eigen.tuxfamily.org/dox/group__TopicStorageOrders.html
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PlotData } from "../../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../../ILibProviders";
import { readMemoryChunked } from "../../debugger";
import { typedBufferToNumbers, computeStats } from "../utils";
import { eigenDtype, bytesPerEigenDtype, evalEigenDim, getEigenDataPointer } from "./eigenUtils";

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
        // Prefer pre-resolved shape from getVariableInfo (avoids a second
        // round of LLDB evaluate calls that may fail on Windows/LLDB).
        let rows: number;
        let cols: number;
        if (info.shape && info.shape.length >= 2 && info.shape[0] > 0 && info.shape[1] > 0) {
            [rows, cols] = info.shape;
        } else {
            rows = await evalEigenDim(session, varName, "rows", frameId);
            cols = await evalEigenDim(session, varName, "cols", frameId);
        }

        if (rows <= 0 || cols <= 0) {
            return null;
        }

        const size = rows * cols;
        const dtype = eigenDtype(typeStr);
        const bpe = bytesPerEigenDtype(dtype);
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

        // ── Step 4: build PlotData ────────────────────────────────────────────
        const allValues = typedBufferToNumbers(buffer, dtype);

        // N×2 matrix → 2D scatter: Eigen column-major means
        // col0 = allValues[0..rows-1], col1 = allValues[rows..2*rows-1]
        if (cols === 2) {
            const xValues = allValues.slice(0, rows);
            const yValues = allValues.slice(rows, rows * 2);
            return {
                xValues,
                yValues,
                dtype,
                length: rows,
                stats: computeStats(yValues),
                varName,
            };
        }

        // 1D (vector or any other shape) → line plot
        const stats = computeStats(allValues);
        return {
            yValues: allValues,
            dtype,
            length: allValues.length,
            stats,
            varName,
        };
    }
}
