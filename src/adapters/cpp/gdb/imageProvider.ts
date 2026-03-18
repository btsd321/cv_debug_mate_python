/**
 * gdb/imageProvider.ts — Image data coordinator for GDB (session.type = "cppdbg").
 *
 * Delegates to the first ILibImageProvider whose canHandle() returns true.
 * Adding a new library requires only creating libs/<libName>/imageProvider.ts
 * and appending an instance to PROVIDERS below.
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

export async function fetchGdbImageData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<ImageData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        // GDB cannot reliably chain method calls on temporaries (e.g. lock().size()).
        // For weak_ptr, access the internal raw pointer field _M_ptr (libstdc++) directly.
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}._M_ptr)` : `(*${varName})`;
        typeName = unwrapped.innerType;
        resolvedInfo = { ...info, typeName: unwrapped.innerType, type: unwrapped.innerType, variablesReference: 0 };
    }

    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchImageData(session, resolvedName, resolvedInfo);
        }
    }
    return null;
}
