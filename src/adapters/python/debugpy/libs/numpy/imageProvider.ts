/**
 * numpy/imageProvider.ts — ImageData extraction from numpy.ndarray.
 *
 * Handles: ndarray (H,W) / (H,W,1) / (H,W,3) / (H,W,4)
 * Also covers cv2.Mat, which is a numpy ndarray at runtime.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import { fetchArrayData } from "../../debugger";
import { resolveHWC, computeMinMax, bufferToBase64 } from "../utils";

export class NumpyImageProvider implements ILibImageProvider {
    canHandle(typeName: string): boolean {
        // numpy.ndarray, numpy.ma.MaskedArray, cv2.Mat (which is ndarray)
        return /numpy\.|ndarray|cv2\./i.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const shape = info.shape;
        const dtype = info.dtype ?? "uint8";
        if (!shape || shape.length < 2) {
            return null;
        }

        const [height, width, channels] = resolveHWC(shape);
        const format = detectNumpyFormat(info.typeName ?? "", varName, channels);

        const raw = await fetchArrayData(session, varName, { ...info, shape, dtype });
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

/** Infer channel order from the type name and variable name. */
function detectNumpyFormat(typeName: string, varName: string, channels: number): ImageFormat {
    if (channels === 1) { return "GRAY"; }
    // Split on common separators (_  -  .  space) and check for a "bgr" component.
    // Using component split avoids the JS \b trap: \b treats '_' as a word char,
    // so \bbgr\b would NOT match "bgr_u8" — the split approach handles this correctly.
    const hasComponentBGR = varName.toLowerCase().split(/[_\-. ]/).includes("bgr");
    const isBGR = /cv2\./i.test(typeName) || hasComponentBGR;
    if (channels === 4) { return isBGR ? "BGRA" : "RGBA"; }
    return isBGR ? "BGR" : "RGB";
}
