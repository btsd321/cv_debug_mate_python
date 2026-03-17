/**
 * eigen/imageProvider.ts — ImageData from Eigen 2D matrices (C++ adapter).
 *
 * Supported types:
 *   Eigen::MatrixXd / MatrixXf           → rows×cols grayscale image
 *   Eigen::Matrix<double,-1,-1>          → rows×cols grayscale image
 *   Eigen::Array<float, R, C>            → rows×cols grayscale image
 *
 * Data-fetch strategy:
 *   1. Evaluate varName.rows() and varName.cols() for dimensions
 *   2. Obtain data pointer via varName.data()
 *   3. Read rows×cols×sizeof(T) bytes via readMemoryChunked
 *   4. Build ImageData (single-channel, normalise flag auto-set for floats)
 *
 * Eigen stores matrices in column-major order by default, but since we
 * display each element as a grayscale pixel without transposing, the visual
 * layout is column-major (columns become the fast axis). This matches common
 * expectations when inspecting raw Eigen matrices.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import { readMemoryChunked } from "../../debugger";
import { bufferToBase64, computeMinMax } from "../utils";
import { eigenDtype, bytesPerEigenDtype, evalEigenDim, getEigenDataPointer, parseEigenCompileTimeDims } from "./eigenUtils";

export class EigenImageProvider implements ILibImageProvider {

    canHandle(typeName: string): boolean {
        // Handle 2D Matrix / Array types only (not Vector / RowVector — those go to plot).
        return /\bEigen::(Matrix|Array)/.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
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
            // imageProvider receives 2D matrices; parse ctDims so fixed-size types
            // (e.g. Matrix<double,3,3>) skip the eval entirely, matching plotProvider.
            const ctDims = parseEigenCompileTimeDims(typeStr);
            rows = (ctDims && ctDims[0] > 0) ? ctDims[0] : await evalEigenDim(session, varName, "rows", frameId);
            cols = (ctDims && ctDims[1] > 0) ? ctDims[1] : await evalEigenDim(session, varName, "cols", frameId);
        }

        if (rows <= 0 || cols <= 0) {
            return null;
        }

        const dtype = eigenDtype(typeStr);
        const bpe = bytesPerEigenDtype(dtype);
        const totalBytes = rows * cols * bpe;

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

        // ── Step 4: build ImageData ───────────────────────────────────────────
        // Eigen is column-major; we display row-major (transpose the layout)
        // by reordering bytes so the visual grid matches matrix notation [row][col].
        // However, for quick inspection we skip the transpose and show raw storage.
        const { dataMin, dataMax } = computeMinMax(buffer, dtype);

        return {
            b64Bytes: bufferToBase64(buffer),
            width: cols,
            height: rows,
            channels: 1,
            dtype,
            isUint8: dtype === "uint8",
            dataMin,
            dataMax,
            varName,
            format: "GRAY",
        };
    }
}
