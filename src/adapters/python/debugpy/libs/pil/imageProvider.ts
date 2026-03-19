/**
 * pil/imageProvider.ts — ImageData extraction from PIL.Image.
 *
 * Handles: PIL.Image.Image (any mode: L, RGB, RGBA, P, CMYK, …)
 *
 * Transfer strategy:
 *   Compress (remote env / above threshold):
 *     Python-side: save image to BytesIO as PNG, send bytes via TCP socket.
 *     Returns ImageData with encoding:"png" — bypasses the DAP 32K string
 *     limit that previously could silently truncate large PIL images.
 *   No-compress (local env / below threshold):
 *     Existing path: evaluate base64(tobytes()) via DAP.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import { evaluateExpression } from "../../debugger";
import { receiveBytesViaTcp } from "../../../../../utils/tcpTransfer";
import { bufferToBase64 } from "../utils";
import { shouldCompress } from "../../../../../utils/compressionUtils";

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
        const rawByteCount = meta.width * meta.height * channels;

        // ── PNG path (remote / above threshold) ───────────────────────────────
        if (shouldCompress(rawByteCount)) {
            const pngBuffer = await receiveBytesViaTcp(async (port) => {
                // Python: save PIL image as PNG into an in-memory BytesIO buffer,
                // then send the PNG bytes over a localhost socket.
                const sendExpr =
                    `(lambda __port:` +
                    ` (lambda __buf: [` +
                    `${varName}.save(__buf, format='PNG'),` +
                    ` (lambda __s: (` +
                    `__s.connect(('127.0.0.1', __port)),` +
                    ` __s.sendall(__buf.getvalue()),` +
                    ` __s.close()))` +
                    `(__import__('socket').socket())])` +
                    `(__import__('io').BytesIO()))` +
                    `(${port})`;
                return evaluateExpression(session, sendExpr, info.frameId);
            });

            if (pngBuffer) {
                return {
                    b64Bytes: bufferToBase64(pngBuffer),
                    width: meta.width,
                    height: meta.height,
                    channels,
                    dtype: "uint8",
                    isUint8: true,
                    dataMin: 0,
                    dataMax: 255,
                    varName,
                    format: pilModeToFormat(meta.mode),
                    encoding: "png",
                };
            }
            // Fall through to raw path if TCP transfer failed.
        }

        // ── Raw bytes path (local / small image / TCP fallback) ───────────────
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
