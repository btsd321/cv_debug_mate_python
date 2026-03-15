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
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import {
    evaluateExpression,
    getCurrentFrameId,
    readMemoryChunked,
    tryGetDataPointer,
} from "../../debugger";
import { bufferToBase64, computeMinMax } from "../utils";
import { qImageLayout, qImageSizeExprs, getQImageInfoFromVariables } from "./qtUtils";
import { logger } from "../../../../../log/logger";

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
 * Like evalInt but logs the raw GDB response string AND caught exceptions,
 * so we can see exactly what the debugger returned when normal eval fails.
 */
async function evalIntDiag(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<number | null> {
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));
    let rawResult: string | null = null;
    try {
        const r = await session.customRequest("evaluate", {
            expression: expr,
            frameId: resolvedFrame,
            context: "repl",
        });
        rawResult = r?.result ?? null;
    } catch (e) {
        logger.debug(`eval("${expr}") threw: ${String(e).slice(0, 200)}`);
        return null;
    }
    if (rawResult === null) {
        logger.debug(`eval("${expr}") → null`);
        return null;
    }
    logger.debug(`eval("${expr}") raw="${rawResult}"`);
    const parenMatch = rawResult.match(/\((-?\d+)\)\s*$/);
    if (parenMatch) {
        const n = parseInt(parenMatch[1], 10);
        return isNaN(n) ? null : n;
    }
    const n = parseInt(rawResult.trim(), 10);
    return isNaN(n) ? null : n;
}

// ── Qt5 QImageData memory-layout constants (64-bit Linux/macOS) ───────────
// Verified against Qt5.15.3 sources (src/gui/image/qimage_p.h) and
// confirmed at runtime via offsetof() on this platform.
//
// Qt5 QImageData layout (gcc/clang, 64-bit LP64):
//  +0  QAtomicInt ref           4 bytes
//  +4  int width                4 bytes  ← QIMGD_OFFSET_WIDTH
//  +8  int height               4 bytes  ← QIMGD_OFFSET_HEIGHT
//  +12 int depth                4 bytes
//  +16 qsizetype nbytes         8 bytes  (aligned to 8)
//  +24 qreal devicePixelRatio   8 bytes
//  +32 QVector<QRgb> colortable 8 bytes  (single d-ptr)
//  +40 uchar *data              8 bytes  ← QIMGD_OFFSET_DATA
//  +48 QImage::Format format    4 bytes  ← QIMGD_OFFSET_FORMAT  (int)
//  +52 int bytes_per_line       4 bytes  ← QIMGD_OFFSET_BPL    (int, NOT qsizetype)
// sizeof(QImageData) ≥ 56
//
// QImage object layout (64-bit LP64, Qt5.15):
//  +0  vptr (QPaintDevice virtual table) 8 bytes
//  +8  ushort painters                  2 bytes (+ 6 pad)
//  +16 QPaintDevicePrivate *reserved    8 bytes
//  +24 QImageData *d                    8 bytes  ← QIMAGE_OFFSET_D
// sizeof(QImage) = 32
const QIMGD_OFFSET_WIDTH  =  4;
const QIMGD_OFFSET_HEIGHT =  8;
const QIMGD_OFFSET_DATA   = 40;
const QIMGD_OFFSET_FORMAT = 48;
const QIMGD_OFFSET_BPL    = 52;   // int (4 bytes) — NOT qsizetype
const QIMGD_READ_SIZE     = 60;   // bytes to read from QImageData start
/** Byte offset of QImageData* d within a QImage object on 64-bit Linux. */
const QIMAGE_OFFSET_D     = 24;

/**
 * Fallback 3: resolve the QImageData* via tryGetDataPointer then read its
 * fields directly from process memory at known Qt5 64-bit struct offsets.
 * Returns partial/null fields that the caller can selectively use.
 */
async function getQImageInfoFromDPtrMem(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<{ width: number | null; height: number | null; fmt: number | null;
             dataPtr: string | null; totalBytes: number } | null> {

    // ── Step a: resolve QImageData* d address ───────────────────────────
    // Strategy A: direct member access (requires Qt DWARF or the member is
    // visible in the user's compilation unit debug info).
    let dPtr = await tryGetDataPointer(
        session,
        [
            `${varName}.d`,
            `(long long)${varName}.d`,
        ],
        frameId
    );

    // Strategy B: GDB knows the QImage object address but not its members
    // (Qt stripped of debug info). Read the object memory at offset +24
    // where QImageData* d lives in Qt5.15 64-bit layout.
    if (!dPtr) {
        logger.debug(`QImage fallback3: varName.d failed, trying object-address scan`);
        const qimgAddr = await tryGetDataPointer(session, [`&${varName}`], frameId);
        logger.debug(`QImage fallback3: qimgAddr="${qimgAddr}"`);
        if (qimgAddr) {
            // Read sizeof(QImage) = 32 bytes; d ptr is at offset +24
            const qimgBuf = await readMemoryChunked(session, qimgAddr, 32);
            if (qimgBuf && qimgBuf.length >= QIMAGE_OFFSET_D + 8) {
                const qv = new DataView(qimgBuf.buffer, qimgBuf.byteOffset, qimgBuf.byteLength);
                const lo = qv.getUint32(QIMAGE_OFFSET_D,     true);
                const hi = qv.getUint32(QIMAGE_OFFSET_D + 4, true);
                const addr = (BigInt(hi) << 32n) | BigInt(lo);
                if (addr > 0x1000n) {
                    dPtr = `0x${addr.toString(16)}`;
                    logger.debug(`QImage fallback3: d ptr from object scan="${dPtr}"`);
                } else {
                    logger.debug(`QImage fallback3: candidate d ptr 0x${addr.toString(16)} looks invalid`);
                }
            } else {
                logger.debug(`QImage fallback3: readMemory(qimgObj) failed (${qimgBuf?.length ?? 0} bytes)`);
            }
        }
    } else {
        logger.debug(`QImage fallback3: d ptr from member access="${dPtr}"`);
    }

    if (!dPtr) { return null; }

    // ── Step b: read raw QImageData bytes ────────────────────────────────
    const chunk = await readMemoryChunked(session, dPtr, QIMGD_READ_SIZE);
    if (!chunk || chunk.length < QIMGD_OFFSET_FORMAT + 4) {
        logger.debug(`QImage fallback3: readMemory(QImageData) failed or too short (${chunk?.length ?? 0} bytes)`);
        return null;
    }
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    const w   = view.getInt32(QIMGD_OFFSET_WIDTH,  true);
    const h   = view.getInt32(QIMGD_OFFSET_HEIGHT, true);
    const fmt = view.getInt32(QIMGD_OFFSET_FORMAT, true);
    logger.debug(`QImage fallback3 QImageData: ${w}x${h} fmt=${fmt}`);

    // ── Step c: extract data pointer at offset +40 (8-byte ptr) ─────────
    let dataPtr: string | null = null;
    if (chunk.length >= QIMGD_OFFSET_DATA + 8) {
        const lo  = view.getUint32(QIMGD_OFFSET_DATA,     true);
        const hi  = view.getUint32(QIMGD_OFFSET_DATA + 4, true);
        const addr = (BigInt(hi) << 32n) | BigInt(lo);
        if (addr > 0n) {
            dataPtr = `0x${addr.toString(16)}`;
            logger.debug(`QImage fallback3 pixel dataPtr="${dataPtr}"`);
        }
    }

    // ── Step d: extract bytes_per_line at offset +52 (int, 4 bytes) ──────
    let totalBytes = 0;
    if (chunk.length >= QIMGD_OFFSET_BPL + 4 && h > 0) {
        const bpl = view.getInt32(QIMGD_OFFSET_BPL, true);
        if (bpl > 0) {
            totalBytes = bpl * h;
            logger.debug(`QImage fallback3 bpl=${bpl} totalBytes=${totalBytes}`);
        }
    }

    return {
        width:  w > 0 ? w : null,
        height: h > 0 ? h : null,
        fmt:    (fmt >= 0 && fmt < 100) ? fmt : null,
        dataPtr,
        totalBytes,
    };
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
 * Build expressions to obtain bits() pointer using GDB (cppdbg) cast syntax.
 */
function bitsPointerExprs(
    _session: vscode.DebugSession,
    varName: string
): string[] {
    return [
        `(long long)${varName}.bits()`,
        `(long long)(${varName}.bits())`,
        `reinterpret_cast<long long>(${varName}.bits())`,
        // Member-access fallbacks when Qt debug symbols ARE available:
        `(long long)${varName}.d->data`,
        `(long long)(${varName}.d->data)`,
        // Note: when Qt lacks debug symbols the above will fail too.
        // The pixel data pointer is then extracted directly by getQImageInfoFromDPtrMem
        // (reads QImageData.data at QIMGD_OFFSET_DATA = +40 via readMemoryChunked).
    ];
}

// ── Provider ─────────────────────────────────────────────────────────────

/** Avoid flooding the user with the same warning on every step. */
let _qtNoSymsWarned = false;

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
        } else {
            logger.debug(`QImage: variablesReference=${info.variablesReference ?? 0}, skipping tree path (Qt pretty-printers may be active)`);
        }

        // ── Fallback 1: member-function expression eval ──────────────────
        // May fail when Qt inline functions (width/height/format) are not
        // callable in GDB's "repl" evaluate context.
        if (width === null || height === null || fmt === null) {
            width  = await evalIntDiag(session, `${varName}.width()`,  frameId);
            height = await evalIntDiag(session, `${varName}.height()`, frameId);
            fmt    = await evalIntDiag(session, `(int)${varName}.format()`, frameId)
                  ?? await evalIntDiag(session, `${varName}.format()`, frameId);
            logger.debug(`QImage expr-eval (member fns): ${width}x${height} fmt=${fmt}`);
        }

        // ── Fallback 2: d-pointer struct field access ────────────────────
        // When Qt pretty-printers collapse variablesReference=0 AND inline
        // member functions are not callable by GDB, access QImageData fields
        // directly through the d-pointer (plain struct field access, not a
        // function call — GDB handles this even with pretty-printers active).
        if (width === null || height === null || fmt === null) {
            width  = await evalIntDiag(session, `(int)${varName}.d->width`,  frameId);
            height = await evalIntDiag(session, `(int)${varName}.d->height`, frameId);
            fmt    = await evalIntDiag(session, `(int)${varName}.d->format`, frameId)
                  ?? await evalIntDiag(session, `${varName}.d->format`, frameId);
            logger.debug(`QImage d-ptr field-eval: ${width}x${height} fmt=${fmt}`);

            // If both Fallback 1 and Fallback 2 returned nothing, Qt was
            // compiled without DWARF debug symbols.  Warn the user once.
            if ((width === null || height === null || fmt === null) && !_qtNoSymsWarned) {
                _qtNoSymsWarned = true;
                const msg =
                    "QImage: Qt debug symbols not found. " +
                    "GDB cannot call member functions or access struct fields. " +
                    "Install libqt5gui5-dbgsym (Ubuntu) or compile Qt with debug symbols " +
                    "for more reliable visualization. " +
                    "Falling back to raw memory read.";
                logger.warn(msg);
                vscode.window.showWarningMessage(msg);
            }
        }

        // ── Fallback 3: d-pointer address + readMemory at fixed Qt5 offsets ──
        // Used when QImageData is an incomplete type (Qt compiled without debug
        // symbols), so GDB knows the d pointer value but cannot dereference it.
        // tryGetDataPointer extracts the hex address; readMemoryChunked reads
        // the raw QImageData bytes at known 64-bit struct offsets.
        if (width === null || height === null || fmt === null || !dataPtr || totalBytes <= 0) {
            const memInfo = await getQImageInfoFromDPtrMem(session, varName, frameId);
            if (memInfo) {
                if (width  === null) { width  = memInfo.width; }
                if (height === null) { height = memInfo.height; }
                if (fmt    === null) { fmt    = memInfo.fmt; }
                if (!dataPtr && memInfo.dataPtr)     { dataPtr    = memInfo.dataPtr; }
                if (totalBytes <= 0 && memInfo.totalBytes > 0) { totalBytes = memInfo.totalBytes; }
            }
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
            // sizeInBytes() / byteCount() are also inline; fall back to d-pointer fields.
            if (totalBytes <= 0 || totalBytes < minBytes) {
                const nbytes = await evalInt(session, `(int)${varName}.d->nbytes`, frameId);
                if (nbytes !== null && nbytes > 0) {
                    logger.debug(`QImage d->nbytes fallback: ${nbytes}`);
                    totalBytes = nbytes;
                } else {
                    const bpl = await evalInt(session, `(int)${varName}.d->bytes_per_line`, frameId);
                    if (bpl !== null && bpl > 0) {
                        logger.debug(`QImage d->bytes_per_line fallback: ${bpl} * ${height} = ${bpl * height}`);
                        totalBytes = bpl * height;
                    }
                }
            }
            if (totalBytes <= 0) { totalBytes = minBytes; }
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
