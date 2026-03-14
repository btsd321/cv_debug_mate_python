/**
 * pil/imageProvider.ts — ImageData extraction from PIL.Image.
 *
 * Handles: PIL.Image.Image (any mode: L, RGB, RGBA, P, CMYK, …)
 * Converts to numpy bytes via evaluate to avoid extra file I/O.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../ILibProviders";
import { evaluateExpression } from "../../pythonDebugger";

export class PilImageProvider implements ILibImageProvider {
    canHandle(typeName: string): boolean {
        return /PIL\.|pillow/i.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const metaExpr =
            `__import__('json').dumps({` +
            `'mode': ${varName}.mode,` +
            `'width': ${varName}.width,` +
            `'height': ${varName}.height` +
            `})`;

        const metaRaw = await evaluateExpression(session, metaExpr, info.frameId);
        if (!metaRaw) {
            return null;
        }

        const meta = JSON.parse(metaRaw.replace(/^'|'$/g, "")) as {
            mode: string;
            width: number;
            height: number;
        };

        const channels = pilModeToChannels(meta.mode);

        const b64Expr =
            `__import__('base64').b64encode(` +
            `__import__('numpy').array(${varName}).tobytes()` +
            `).decode('ascii')`;

        const b64Raw = await evaluateExpression(session, b64Expr, info.frameId);
        if (!b64Raw) {
            return null;
        }

        return {
            b64Bytes: b64Raw.replace(/^'|'$/g, ""),
            width: meta.width,
            height: meta.height,
            channels,
            dtype: "uint8",
            isUint8: true,
            dataMin: 0,
            dataMax: 255,
            varName,
            format: pilModeToFormat(meta.mode),
        };
    }
}

function pilModeToChannels(mode: string): number {
    if (mode === "L" || mode === "P") { return 1; }
    if (mode === "RGB") { return 3; }
    if (mode === "RGBA" || mode === "CMYK") { return 4; }
    return 3;
}

function pilModeToFormat(mode: string): ImageFormat {
    if (mode === "L" || mode === "P") { return "GRAY"; }
    if (mode === "RGBA") { return "RGBA"; }
    return "RGB";
}
