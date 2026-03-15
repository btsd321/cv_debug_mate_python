/**
 * torch/imageProvider.ts — ImageData extraction from torch.Tensor.
 *
 * Handles: torch.Tensor shape (H,W) / (C,H,W) / (H,W,C)
 * Detaches from autograd, moves to CPU, converts to float32 numpy array.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import { fetchArrayData } from "../../debugger";
import { resolveHWC, computeMinMax, bufferToBase64 } from "../utils";

export class TorchImageProvider implements ILibImageProvider {
    canHandle(typeName: string): boolean {
        return /torch\.Tensor|torch\.cuda\.|torch\..*[Tt]ensor/i.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const shape = info.shape;
        if (!shape) {
            return null;
        }

        // Normalise CHW → HWC so the webview can read it uniformly
        const normalisedShape = normaliseTensorShape(shape);

        const normaliseExpr =
            `(lambda t: t.permute(1,2,0) if t.ndim == 3 and t.shape[0] in (1,3,4) else t)(` +
            `${varName}.detach().cpu().float())`;

        const syntheticInfo: VariableInfo = {
            ...info,
            typeName: "numpy.ndarray",
            shape: normalisedShape,
            dtype: "float32",
        };

        const raw = await fetchArrayData(
            session,
            `__import__('numpy').array(${normaliseExpr})`,
            syntheticInfo
        );
        if (!raw) {
            return null;
        }

        const [height, width, channels] = resolveHWC(normalisedShape);
        const { dataMin, dataMax } = computeMinMax(raw.buffer, "float32");
        // Torch tensors follow RGB convention by default
        const format: ImageFormat = channels === 1 ? "GRAY" : "RGB";

        return {
            b64Bytes: bufferToBase64(raw.buffer),
            width,
            height,
            channels,
            dtype: "float32",
            isUint8: false,
            dataMin,
            dataMax,
            varName,
            format,
        };
    }
}

function normaliseTensorShape(shape: number[]): number[] {
    // (C, H, W) where C ∈ {1, 3, 4} → (H, W, C)
    if (shape.length === 3 && [1, 3, 4].includes(shape[0])) {
        return [shape[1], shape[2], shape[0]];
    }
    return shape;
}
