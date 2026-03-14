/**
 * opencv/imageProvider.ts — ImageData extraction for OpenCV Python types.
 *
 * Handles:
 *   cv2.UMat              — CPU transparent API matrix; convert via .get()
 *   cv2.cuda.GpuMat       — GPU matrix; convert via .download()
 *   cv2.Mat               — legacy alias (already numpy.ndarray at runtime,
 *                           but retained here for explicit canHandle coverage)
 *
 * Note: regular cv2.imread() / cv2.VideoCapture.read() results are plain
 * numpy.ndarray and are handled by NumpyImageProvider.  This provider covers
 * the cases where the debugger reports a non-ndarray cv2 type string.
 *
 * Channel order: cv2 uses BGR.  The frontend image-viewer exposes a
 * "Swap R/B" toggle so the user can flip to RGB without any server-side cost.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../ILibProviders";
import { evaluateExpression, fetchArrayData } from "../../pythonDebugger";
import { resolveHWC, computeMinMax, bufferToBase64 } from "../utils";

// ── canHandle patterns ─────────────────────────────────────────────────────

const CV2_IMAGE_RE = /cv2\.(UMat|cuda\.GpuMat|Mat\b)/i;

export class OpenCvImageProvider implements ILibImageProvider {
    canHandle(typeName: string): boolean {
        return CV2_IMAGE_RE.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const typeName = info.typeName ?? "";

        // ── Normalise to ndarray in the debug session ─────────────────────────
        // For UMat / GpuMat we create a temporary expression that yields an ndarray.
        let ndarrayExpr: string;
        if (/cuda\.GpuMat/i.test(typeName)) {
            ndarrayExpr = `(${varName}).download()`;
        } else if (/UMat/i.test(typeName)) {
            ndarrayExpr = `(${varName}).get()`;
        } else {
            // cv2.Mat at runtime is already ndarray
            ndarrayExpr = varName;
        }

        // ── Fetch shape / dtype of the normalised array ───────────────────────
        let shape: number[];
        let dtype: string;

        if (ndarrayExpr === varName && info.shape && info.dtype) {
            // Already have metadata from Layer-2 detection
            shape = info.shape;
            dtype = info.dtype;
        } else {
            // UMat/GpuMat: evaluate the conversion expression to get metadata
            const metaJson = await evaluateExpression(
                session,
                `__import__('json').dumps({'shape': list((${ndarrayExpr}).shape), 'dtype': str((${ndarrayExpr}).dtype)})`,
                info.frameId
            );
            if (!metaJson) {
                return null;
            }
            try {
                const jsonStr = metaJson.startsWith("'") ? metaJson.slice(1, -1) : metaJson;
                const meta = JSON.parse(jsonStr) as { shape: number[]; dtype: string };
                shape = meta.shape;
                dtype = meta.dtype;
            } catch {
                return null;
            }
        }

        if (!shape || shape.length < 2) {
            return null;
        }

        const [height, width, channels] = resolveHWC(shape);
        // cv2 always stores in BGR order
        const format: ImageFormat = channels === 1 ? "GRAY" : channels === 4 ? "BGRA" : "BGR";

        // ── Fetch raw bytes via fetchArrayData (small→JSON, large→TCP) ────────
        // Pass ndarrayExpr as varName so fetchArrayData's buildToBytesExpr wraps
        // the conversion expression (e.g. `(v).get()`) with ascontiguousarray().
        const infoForFetch: VariableInfo = {
            ...info,
            shape,
            dtype,
            typeName: "numpy.ndarray", // treat as plain ndarray for the fetch path
        };
        const raw = await fetchArrayData(session, ndarrayExpr, infoForFetch);
        if (!raw) {
            return null;
        }

        const { dataMin, dataMax } = computeMinMax(raw.buffer, dtype);

        return {
            b64Bytes: bufferToBase64(raw.buffer),
            width,
            height,
            channels,
            dtype,
            isUint8: dtype === "uint8",
            dataMin,
            dataMax,
            varName,
            format,
        };
    }
}

