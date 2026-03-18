/**
 * codelldb/imageProvider.ts — Image data coordinator for CodeLLDB (session.type = "lldb").
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { ImageData } from "../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../ILibProviders";
import { OpenCvImageProvider } from "./libs/opencv/imageProvider";
import { EigenImageProvider } from "./libs/eigen/imageProvider";
import { StdImageProvider } from "./libs/std/imageProvider";
import { QtImageProvider } from "./libs/qt/imageProvider";
import { unwrapSmartPointer } from "../shared/utils";

const PROVIDERS: ILibImageProvider[] = [
    new OpenCvImageProvider(),
    new EigenImageProvider(),
    new StdImageProvider(),
    new QtImageProvider(),
];

export async function fetchLldbImageData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<ImageData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}.lock())` : `(*${varName})`;
        typeName = unwrapped.innerType;
        // Keep variablesReference: CodeLLDB synthetic formatters expose the
        // pointed-to object's element tree through the smart pointer's reference.
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchImageData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
