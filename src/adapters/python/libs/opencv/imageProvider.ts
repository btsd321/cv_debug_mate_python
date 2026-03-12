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

    if (info.shape && info.dtype) {
      shape = info.shape;
      dtype = info.dtype;
    } else {
      // Need to query via evaluate
      const metaJson = await evaluateExpression(
        session,
        `__import__('json').dumps({'shape': list((${ndarrayExpr}).shape), 'dtype': str((${ndarrayExpr}).dtype)})`,
        info.frameId
      );
      if (!metaJson) {
        return null;
      }
      try {
        const meta = JSON.parse(metaJson.replace(/^'|'$/g, "").replace(/"/g, '"')) as {
          shape: number[];
          dtype: string;
        };
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

    // ── Fetch raw bytes ───────────────────────────────────────────────────
    // If ndarrayExpr is just varName, reuse fetchArrayData directly.
    // Otherwise we evaluate the conversion expression inline.
    let rawBuffer: Uint8Array | null = null;

    if (ndarrayExpr === varName) {
      const raw = await fetchArrayData(session, varName, { ...info, shape, dtype });
      rawBuffer = raw?.buffer ?? null;
    } else {
      // Use the converted expression
      const totalBytes = shape.reduce((a, b) => a * b, 1);
      const bytesPerEl = bytesPerElementForDtype(dtype);
      const byteSize = totalBytes * bytesPerEl;
      const LARGE = 1024 * 1024; // 1 MB

      if (byteSize < LARGE) {
        const listJson = await evaluateExpression(
          session,
          `(${ndarrayExpr}).tolist()`,
          info.frameId
        );
        if (!listJson) {
          return null;
        }
        try {
          const flat = (JSON.parse(listJson) as number[][][]).flat(Infinity) as number[];
          rawBuffer = new Uint8Array(flat);
        } catch {
          return null;
        }
      } else {
        const b64 = await evaluateExpression(
          session,
          `__import__('base64').b64encode((${ndarrayExpr}).tobytes()).decode()`,
          info.frameId
        );
        if (!b64) {
          return null;
        }
        const clean = b64.replace(/^['"]|['"]$/g, "");
        const binary = atob(clean);
        rawBuffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          rawBuffer[i] = binary.charCodeAt(i);
        }
      }
    }

    if (!rawBuffer) {
      return null;
    }

    const { dataMin, dataMax } = computeMinMax(rawBuffer, dtype);

    return {
      b64Bytes: bufferToBase64(rawBuffer),
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

// ── helpers ────────────────────────────────────────────────────────────────

function bytesPerElementForDtype(dtype: string): number {
  switch (dtype) {
    case "uint8":
    case "int8":
    case "bool":
      return 1;
    case "uint16":
    case "int16":
    case "float16":
      return 2;
    case "uint32":
    case "int32":
    case "float32":
      return 4;
    case "uint64":
    case "int64":
    case "float64":
      return 8;
    default:
      return 4;
  }
}
