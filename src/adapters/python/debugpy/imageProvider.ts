/**
 * imageProvider.ts — Image data extraction coordinator for the 2D Image Viewer.
 *
 * Dispatches to the first registered ILibImageProvider that answers
 * canHandle() for the variable's type name.  To add support for a new
 * library (e.g. open3d, SimpleITK), create a new provider under
 * src/adapters/python/libs/<libName>/imageProvider.ts, implement
 * ILibImageProvider, and append an instance to LIB_IMAGE_PROVIDERS.
 *
 * Current registry (checked in order):
 *   1. PIL.Image         → libs/pil/imageProvider
 *   2. torch.Tensor      → libs/torch/imageProvider
 *   3. cv2.UMat/GpuMat/Mat → libs/opencv/imageProvider
 *   4. numpy.ndarray (H,W,C) → libs/numpy/imageProvider
 *
 * Note: plain numpy.ndarray is intentionally NOT registered here.
 * numpy arrays are visualized as 1D plots, 2D scatter, or 3D point clouds
 * based on their shape.  Use PIL or cv2 types for image visualization.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { ImageData } from "../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../ILibProviders";
import { PilImageProvider } from "./libs/pil/imageProvider";
import { TorchImageProvider } from "./libs/torch/imageProvider";
import { OpenCvImageProvider } from "./libs/opencv/imageProvider";
import { NumpyImageProvider } from "./libs/numpy/imageProvider";

// ── Registry ────────────────────────────────────────────────────────────
// Checked in order; the first provider whose canHandle() returns true is used.

const LIB_IMAGE_PROVIDERS: ILibImageProvider[] = [
    new PilImageProvider(),
    new TorchImageProvider(),
    new OpenCvImageProvider(),  // cv2.UMat / cv2.cuda.GpuMat / cv2.Mat
    new NumpyImageProvider(),   // numpy.ndarray (H,W,C) — e.g. cv2.imread() results
];

// ── Coordinator ────────────────────────────────────────────────────────────

export class ImageProvider {
    constructor(private readonly session: vscode.DebugSession) { }

    async fetchImageData(
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const typeName = info.typeName ?? "";
        for (const provider of LIB_IMAGE_PROVIDERS) {
            if (provider.canHandle(typeName)) {
                return provider.fetchImageData(this.session, varName, info);
            }
        }
        return null;
    }
}
