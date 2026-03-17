/**
 * cppvsdbg/imageProvider.ts — Image data coordinator for vsdbg (session.type = "cppvsdbg").
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

export async function fetchMsvcImageData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<ImageData | null> {
    let resolvedName = varName;
    let typeName = info.typeName ?? info.type;
    let resolvedInfo = info;

    const unwrapped = unwrapSmartPointer(typeName);
    if (unwrapped !== null) {
        // MSVC STL: weak_ptr<T> → _Ptr_base<T>::_Ptr is the raw managed pointer.
        // Avoids chaining methods on the temporary shared_ptr returned by lock().
        resolvedName = unwrapped.kind === "lock_deref" ? `(*${varName}._Ptr)` : `(*${varName})`;
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
