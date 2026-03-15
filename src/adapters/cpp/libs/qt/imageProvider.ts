/**
 * qt/imageProvider.ts — ImageData extraction from QImage (C++ / Qt5 + Qt6).
 *
 * Supported types:
 *   QImage  — any Qt5/Qt6 build
 *
 * Supported formats (others return null):
 *   QImage::Format_Grayscale8  (1 ch uint8)
 *   QImage::Format_Alpha8      (1 ch uint8)
 *   QImage::Format_RGB888      (3 ch uint8, R,G,B)
 *   QImage::Format_BGR888      (3 ch uint8, B,G,R — Qt 5.14+)
 *   QImage::Format_RGB32       (4 ch uint8, 0xffRRGGBB)
 *   QImage::Format_ARGB32      (4 ch uint8, A,R,G,B)
 *   QImage::Format_ARGB32_Premultiplied
 *   QImage::Format_RGBA8888    (4 ch uint8, R,G,B,A)
 *   QImage::Format_RGBA8888_Premultiplied
 *   QImage::Format_RGBX8888    (4 ch uint8)
 *
 * Data-fetch strategy:
 *   1. Evaluate varName.width(), .height(), .format() via DAP
 *   2. Determine total byte count: try sizeInBytes() first (Qt6), then byteCount() (Qt5)
 *   3. Obtain data pointer via varName.bits() → memoryReference or hex result
 *   4. Read totalBytes via readMemoryChunked
 *   5. Return ImageData
 *
 * QImage memory layout:
 *   - QImage::bits() returns uchar* pointing to the raw pixel data.
 *   - Row data may be padded to 4-byte (or 32-byte) boundaries.
 *     sizeInBytes() / byteCount() already accounts for padding; we read
 *     the full padded buffer then let the viewer crop using width/height/bpp.
 *   - For Qt5 the actual scanline stride = bytesPerLine() may exceed
 *     width * bytesPerPixel.  We expose this via the `stride` field of
 *     ImageData if padding is detected; otherwise stride is omitted.
 *
 * References:
 *   - https://doc.qt.io/qt-6/qimage.html
 *   - https://doc.qt.io/qt-5/qimage.html
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../ILibProviders";
import {
    evaluateExpression,
    isUsingLLDB,
    isUsingMSVC,
    readMemoryChunked,
    tryGetDataPointer,
} from "../../cppDebugger";
import { bufferToBase64, computeMinMax } from "../utils";
import { qImageLayout, qImageSizeExprs } from "./qtUtils";

type LogFn = (level: "DEBUG" | "INFO" | "WARN" | "ERROR", msg: string) => void;
const noop: LogFn = () => undefined;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Evaluate a numeric member expression and parse the integer result.
 * Returns null on failure.
 */
async function evalInt(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<number | null> {
    const res = await evaluateExpression(session, expr, frameId);
    if (res === null) { return null; }
    const n = parseInt(res.replace(/[^0-9-]/g, ""), 10);
    return isNaN(n) ? null : n;
}

/**
 * Try to obtain the number of bytes used by the QImage pixel buffer.
 * Qt6 prefers sizeInBytes(), Qt5 uses byteCount().
 * Falls back to width * height * bpp if both evaluations fail.
 */
async function getQImageByteCount(
    session: vscode.DebugSession,
    varName: string,
    fallback: number,
    frameId?: number
): Promise<number> {
    for (const expr of qImageSizeExprs(varName)) {
        const n = await evalInt(session, expr, frameId);
        if (n !== null && n > 0) { return n; }
    }
    return fallback;
}

/**
 * Build expressions to obtain bits() pointer using debugger-specific casts.
 */
function bitsPointerExprs(
    session: vscode.DebugSession,
    varName: string
): string[] {
    if (isUsingLLDB(session)) {
        return [
            `${varName}.bits()`,
            `reinterpret_cast<long long>(${varName}.bits())`,
        ];
    }
    if (isUsingMSVC(session)) {
        return [
            `(long long)${varName}.bits()`,
            `reinterpret_cast<long long>(${varName}.bits())`,
        ];
    }
    // cppdbg / GDB
    return [
        `(long long)${varName}.bits()`,
        `(long long)(${varName}.bits())`,
        `reinterpret_cast<long long>(${varName}.bits())`,
    ];
}

// ── Provider ─────────────────────────────────────────────────────────────

export class QtImageProvider implements ILibImageProvider {
    private readonly log: LogFn;
    constructor(log: LogFn = noop) { this.log = log; }

    canHandle(typeName: string): boolean {
        return /\bQImage\b/.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const frameId = info.frameId;

        // ── Step 1: geometry ─────────────────────────────────────────────
        const width  = await evalInt(session, `${varName}.width()`,  frameId);
        const height = await evalInt(session, `${varName}.height()`, frameId);
        const fmt    = await evalInt(session, `(int)${varName}.format()`, frameId)
                    ?? await evalInt(session, `${varName}.format()`, frameId);

        if (width === null || height === null || fmt === null) {
            this.log("WARN", `QImage: failed to read geometry for ${varName}`);
            return null;
        }
        if (width <= 0 || height <= 0) {
            this.log("WARN", `QImage: invalid size ${width}x${height} for ${varName}`);
            return null;
        }

        // ── Step 2: format layout ────────────────────────────────────────
        const layout = qImageLayout(fmt);
        if (!layout) {
            this.log("WARN", `QImage: unsupported format ${fmt} for ${varName}`);
            return null;
        }
        const { bytesPerPixel, channels, isUint8 } = layout;

        // ── Step 3: byte count ───────────────────────────────────────────
        // QImage rows may be padded; sizeInBytes() is authoritative.
        const minBytes = width * height * bytesPerPixel;
        const totalBytes = await getQImageByteCount(session, varName, minBytes, frameId);

        // ── Step 4: bits() pointer ───────────────────────────────────────
        const dataPtr = await tryGetDataPointer(
            session,
            bitsPointerExprs(session, varName),
            frameId
        );
        if (!dataPtr) {
            this.log("WARN", `QImage: could not resolve bits() pointer for ${varName}`);
            return null;
        }

        // ── Step 5: read memory ──────────────────────────────────────────
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            this.log("WARN", `QImage: readMemory failed for ${varName}`);
            return null;
        }

        const dtype = "uint8";
        const { dataMin, dataMax } = computeMinMax(buffer, dtype);

        // When the buffer is padded (stride > width * bpp), we still pass the
        // full buffer; the image viewer will only display width * height pixels
        // correctly if the stride matches. For simplicity, skip padded images.
        const expectedBytes = width * height * bytesPerPixel;
        if (buffer.length < expectedBytes) {
            this.log("WARN", `QImage: buffer too small (${buffer.length} < ${expectedBytes}) for ${varName}`);
            return null;
        }

        // If padded, crop to the tightly-packed region row-by-row.
        let finalBuffer = buffer;
        if (buffer.length > expectedBytes) {
            const stride = Math.floor(totalBytes / height);
            const rowBytes = width * bytesPerPixel;
            if (stride !== rowBytes) {
                const cropped = new Uint8Array(expectedBytes);
                for (let row = 0; row < height; row++) {
                    cropped.set(
                        buffer.subarray(row * stride, row * stride + rowBytes),
                        row * rowBytes
                    );
                }
                finalBuffer = cropped;
            }
        }

        return {
            b64Bytes: bufferToBase64(finalBuffer),
            width,
            height,
            channels,
            dtype,
            isUint8,
            dataMin,
            dataMax,
            varName,
            format: layout.format as ImageFormat,
        };
    }
}
