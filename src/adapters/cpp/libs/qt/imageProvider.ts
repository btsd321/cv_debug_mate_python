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
import { qImageLayout, qImageSizeExprs, getQImageInfoFromVariables } from "./qtUtils";
import { logger } from "../../../../log/logger";

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
    // cppvsdbg returns enum values like "QImage::Format_Grayscale8 (24)";
    // extract the numeric value from the trailing parentheses if present.
    const parenMatch = res.match(/\((-?\d+)\)\s*$/);
    if (parenMatch) {
        const n = parseInt(parenMatch[1], 10);
        return isNaN(n) ? null : n;
    }
    // Pure numeric string (GDB / LLDB / cppvsdbg with int cast)
    const n = parseInt(res.trim(), 10);
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
        // cppvsdbg: expression returning a pointer naturally gives "0x..." in
        // result / memoryReference.  (long long) cast would return a decimal
        // integer that tryGetDataPointer cannot parse.
        return [
            `${varName}.bits()`,        // uchar* → hex address in cppvsdbg
            `${varName}.d->data`,       // direct d-pointer; no function call needed
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
    canHandle(typeName: string): boolean {
        return /\bQImage\b/.test(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const frameId = info.frameId;

        // ── Step 1: QImage metadata ──────────────────────────────────────
        // Prefer walking the DAP variable tree (reliable in cppvsdbg where
        // member-function calls in `evaluate` often fail).
        let width: number | null = null;
        let height: number | null = null;
        let fmt: number | null = null;
        let totalBytes = 0;
        let dataPtr: string | null = null;

        if (info.variablesReference && info.variablesReference > 0) {
            // ── Diagnostic: dump raw variable tree ───────────────────────
            try {
                const topResp = await session.customRequest("variables", {
                    variablesReference: info.variablesReference,
                });
                const topVars: { name: string; value: string; memoryReference?: string; variablesReference?: number }[] =
                    topResp?.variables ?? [];
                logger.debug(`QImage top-level children (${topVars.length}):`);
                for (const v of topVars) {
                    logger.debug(`  [${v.name}] value="${v.value}" memRef="${v.memoryReference ?? ""}" varRef=${v.variablesReference ?? 0}`);
                }
                const dVar = topVars.find(v => v.name === "d");
                if (dVar?.variablesReference && dVar.variablesReference > 0) {
                    const dResp = await session.customRequest("variables", {
                        variablesReference: dVar.variablesReference,
                    });
                    const dVars: { name: string; value: string; memoryReference?: string; variablesReference?: number }[] =
                        dResp?.variables ?? [];
                    logger.debug(`QImage d-ptr children (${dVars.length}):`);
                    for (const v of dVars) {
                        logger.debug(`  [${v.name}] value="${v.value}" memRef="${v.memoryReference ?? ""}" varRef=${v.variablesReference ?? 0}`);
                    }
                    // Also expand "data" child if present
                    const dataVar = dVars.find(v => v.name === "data");
                    if (dataVar?.variablesReference && dataVar.variablesReference > 0) {
                        const dataResp = await session.customRequest("variables", {
                            variablesReference: dataVar.variablesReference,
                        });
                        const dataVars: { name: string; value: string; memoryReference?: string }[] =
                            dataResp?.variables ?? [];
                        logger.debug(`QImage d->data children (${dataVars.length}):`);
                        for (const v of dataVars) {
                            logger.debug(`  [${v.name}] value="${v.value}" memRef="${v.memoryReference ?? ""}"`);
                        }
                    }
                }
            } catch (e) {
                logger.debug(`QImage variable tree dump failed: ${e}`);
            }
            // ── End diagnostic ───────────────────────────────────────────

            const qi = await getQImageInfoFromVariables(session, info.variablesReference);
            if (qi) {
                width      = qi.width;
                height     = qi.height;
                fmt        = qi.format;
                totalBytes = qi.totalBytes;
                dataPtr    = qi.dataPtr;
                logger.debug(`QImage variables-tree: ${width}x${height} fmt=${fmt} bytes=${totalBytes} ptr=${dataPtr}`);
            }
        }

        // ── Fallback: expression-based evaluation ────────────────────────
        if (width === null || height === null || fmt === null) {
            width  = await evalInt(session, `${varName}.width()`,  frameId);
            height = await evalInt(session, `${varName}.height()`, frameId);
            fmt    = await evalInt(session, `(int)${varName}.format()`, frameId)
                  ?? await evalInt(session, `${varName}.format()`, frameId);
            logger.debug(`QImage expr-eval: ${width}x${height} fmt=${fmt}`);
        }

        if (width === null || height === null || fmt === null) {
            logger.warn(`QImage: failed to read geometry for ${varName}`);
            return null;
        }
        if (width <= 0 || height <= 0) {
            logger.warn(`QImage: invalid size ${width}x${height} for ${varName}`);
            return null;
        }

        // ── Step 2: format layout ────────────────────────────────────────
        const layout = qImageLayout(fmt);
        if (!layout) {
            logger.warn(`QImage: unsupported format ${fmt} for ${varName}`);
            return null;
        }
        const { bytesPerPixel, channels, isUint8 } = layout;

        // ── Step 3: total byte count ─────────────────────────────────────
        if (totalBytes <= 0) {
            const minBytes = width * height * bytesPerPixel;
            totalBytes = await getQImageByteCount(session, varName, minBytes, frameId);
        }

        // ── Step 4: bits() pointer ───────────────────────────────────────
        if (!dataPtr) {
            dataPtr = await tryGetDataPointer(
                session,
                bitsPointerExprs(session, varName),
                frameId
            );
        }
        if (!dataPtr) {
            logger.warn(`QImage: could not resolve data pointer for ${varName}`);
            return null;
        }

        // ── Step 5: read memory ──────────────────────────────────────────
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            logger.warn(`QImage: readMemory failed for ${varName}`);
            return null;
        }

        const dtype = "uint8";
        const { dataMin, dataMax } = computeMinMax(buffer, dtype);

        const expectedBytes = width * height * bytesPerPixel;
        if (buffer.length < expectedBytes) {
            logger.warn(`QImage: buffer too small (${buffer.length} < ${expectedBytes}) for ${varName}`);
            return null;
        }

        // Crop padded rows to a tight buffer the viewer can render directly.
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
