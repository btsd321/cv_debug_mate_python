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
import { eigenDtype, bytesPerEigenDtype, evalEigenDim, getEigenDataPointer, getEigenInfoFromTree, parseEigenCompileTimeDims } from "./eigenUtils";
import { logger } from "../../../../../log/logger";

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
        let treeDataPtr: string | null = null;
        if (info.shape && info.shape.length >= 2 && info.shape[0] > 0 && info.shape[1] > 0) {
            [rows, cols] = info.shape;
        } else {
            rows = await evalEigenDim(session, varName, "rows", frameId);
            cols = await evalEigenDim(session, varName, "cols", frameId);
        }
        logger.debug(`[EigenPlot] ${varName}: rows=${rows} cols=${cols} from eval`);

        // Fallback 1: parse compile-time dims from type template string.
        // Required for e.g. VectorXd (ColsAtCompileTime=1) where m_storage.m_cols
        // does not exist, and also when variablesReference was cleared to 0 after
        // smart-pointer unwrapping in the coordinator.
        if (rows <= 0 || cols <= 0) {
            const ctDims = parseEigenCompileTimeDims(typeStr);
            if (ctDims) {
                if (rows <= 0 && ctDims[0] > 0) { rows = ctDims[0]; }
                if (cols <= 0 && ctDims[1] > 0) { cols = ctDims[1]; }
            }
            logger.debug(`[EigenPlot] ${varName}: after compile-time fallback rows=${rows} cols=${cols}`);
        }

        // Fallback 2: variables tree (LLDB on Windows/MSVC — all evaluations return null)
        if ((rows <= 0 || cols <= 0) && (info.variablesReference ?? 0) > 0) {
            // Derive compile-time cols from type string.
            // Full template:  Eigen::Matrix<T, Rows, Cols, ...>
            // Shorthand:      VectorXd/VectorXf  → cols = 1
            //                 RowVectorXd/RowVectorXf → rows = 1, cols = dynamic
            let compiledCols = -1;
            const tplMatch = typeStr.match(
                /Eigen::Matrix\s*<[^,]+,\s*[^,]+,\s*(-?\d+)/
            );
            if (tplMatch) {
                compiledCols = parseInt(tplMatch[1]);
            } else if (/\bVector(X[df]|\d+[df]?)\b/.test(typeStr)) {
                compiledCols = 1; // VectorXd / VectorXf / Vector4d …
            }
            const treeInfo = await getEigenInfoFromTree(
                session, info.variablesReference!, isNaN(compiledCols) ? -1 : compiledCols
            );
            if (treeInfo.rows > 0) { rows = treeInfo.rows; }
            if (treeInfo.cols > 0) { cols = treeInfo.cols; }
            treeDataPtr = treeInfo.dataPtr;
            logger.debug(`[EigenPlot] ${varName}: rows=${rows} cols=${cols} from tree`);
        }

        if (rows <= 0 || cols <= 0) {
            return null;
        }

        const size = rows * cols;
        const dtype = eigenDtype(typeStr);
        const bpe = bytesPerEigenDtype(dtype);
        const totalBytes = size * bpe;

        // ── Step 2: data pointer ──────────────────────────────────────────────
        const dataPtr = treeDataPtr ?? await getEigenDataPointer(session, varName, frameId);
        logger.debug(`[EigenPlot] ${varName}: dataPtr=${dataPtr}`);
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
