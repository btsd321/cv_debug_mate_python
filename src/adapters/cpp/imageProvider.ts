/**
 * imageProvider.ts — C++ image data coordinator.
 *
 * Iterates LIB_IMAGE_PROVIDERS in order and delegates to the first provider
 * whose canHandle() returns true.  Adding a new library requires only:
 *   1. Creating a new ILibImageProvider implementation in libs/<libName>/
 *   2. Appending an instance to LIB_IMAGE_PROVIDERS below.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../IDebugAdapter";
import { ImageData } from "../../viewers/viewerTypes";
import { ILibImageProvider } from "../ILibProviders";
import { OpenCvImageProvider } from "./libs/opencv/imageProvider";
import { StdImageProvider } from "./libs/std/imageProvider";

// ── Provider registry ─────────────────────────────────────────────────────

const LIB_IMAGE_PROVIDERS: ILibImageProvider[] = [
    new OpenCvImageProvider(),
    new StdImageProvider(),
];

// ── Coordinator ───────────────────────────────────────────────────────────

export async function fetchCppImageData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<ImageData | null> {
    const typeName = info.typeName ?? info.type;
    for (const provider of LIB_IMAGE_PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchImageData(session, varName, info);
        }
    }
    return null;
}
