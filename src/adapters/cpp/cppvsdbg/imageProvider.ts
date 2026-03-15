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
    const typeName = info.typeName ?? info.type;
    for (const provider of PROVIDERS) {
        if (provider.canHandle(typeName)) {
            return provider.fetchImageData(session, varName, info);
        }
    }
    return null;
}
