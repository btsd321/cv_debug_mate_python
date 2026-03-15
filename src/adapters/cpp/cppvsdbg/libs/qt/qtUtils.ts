/**
 * qt/qtUtils.ts — Qt-specific helpers shared by all Qt lib providers.
 *
 * Covers:
 *   - QImage::Format enum values (Qt5 = Qt6, layout unchanged)
 *   - Selecting the correct byte-size expression (Qt5: byteCount, Qt6: sizeInBytes)
 *   - Extracting the element type from QVector<T> / QList<T> type strings
 *   - Deciding whether a type string is a Qt numeric 1D container vs. a
 *     2D scatter container vs. a 3D point-cloud container
 *   - Walking the DAP variable tree to extract QImage metadata (async)
 */

import * as vscode from "vscode";
import { isValidMemoryReference } from "../../debugger";
import { logger } from "../../../../../log/logger";

// ── QImage Format constants ──────────────────────────────────────────────
// Values match QImage::Format enum defined in qimage.h (stable across Qt5/Qt6).

export const enum QImageFormat {
    Invalid       = 0,
    Mono          = 1,
    MonoLSB       = 2,
    Indexed8      = 3,
    RGB32         = 4,   // 0xffRRGGBB  – 4 bytes/pixel, alpha always FF
    ARGB32        = 5,   // AARRGGBB   – 4 bytes/pixel
    ARGB32_Premultiplied = 6,
    RGB16         = 7,
    ARGB8565_Premultiplied = 8,
    RGB666        = 9,
    ARGB6666_Premultiplied = 10,
    RGB555        = 11,
    ARGB8555_Premultiplied = 12,
    RGB888        = 13,  // 3 bytes/pixel R,G,B
    RGB444        = 14,
    ARGB4444_Premultiplied = 15,
    RGBX8888      = 16,
    RGBA8888      = 17,
    RGBA8888_Premultiplied = 18,
    BGR30         = 19,
    A2BGR30_Premultiplied = 20,
    RGB30         = 21,
    A2RGB30_Premultiplied = 22,
    Alpha8        = 23,
    Grayscale8    = 24,
    RGBX64        = 25,
    RGBA64        = 26,
    RGBA64_Premultiplied = 27,
    Grayscale16   = 28,
    BGR888        = 29,  // Qt 5.14+ / Qt6 — 3 bytes/pixel B,G,R
}

// ── Format → viewer parameters ───────────────────────────────────────────

export type QtImageLayout = {
    /** Bytes per pixel in host memory. */
    bytesPerPixel: number;
    /** Number of logical image channels exposed to the viewer. */
    channels: 1 | 3 | 4;
    /** Channel order string understood by the Image Viewer front-end. */
    format: "GRAY" | "RGB" | "BGR" | "RGBA" | "BGRA";
    /** True when every channel is uint8 (no normalisation needed by default). */
    isUint8: boolean;
};

/**
 * Return per-pixel layout for a supported QImage::Format, or null for formats
 * we cannot visualise (packed sub-byte, 16-bit float, etc.).
 */
export function qImageLayout(fmt: number): QtImageLayout | null {
    switch (fmt) {
        case QImageFormat.Grayscale8:
        case QImageFormat.Alpha8:
            return { bytesPerPixel: 1, channels: 1, format: "GRAY", isUint8: true };

        case QImageFormat.RGB888:
            return { bytesPerPixel: 3, channels: 3, format: "RGB", isUint8: true };

        case QImageFormat.BGR888:
            return { bytesPerPixel: 3, channels: 3, format: "BGR", isUint8: true };

        case QImageFormat.RGB32:
        case QImageFormat.RGBX8888:
            // 4 bytes but alpha is always 0xFF / unused — expose as RGBA for simplicity
            return { bytesPerPixel: 4, channels: 4, format: "RGBA", isUint8: true };

        case QImageFormat.ARGB32:
        case QImageFormat.ARGB32_Premultiplied:
        case QImageFormat.RGBA8888:
        case QImageFormat.RGBA8888_Premultiplied:
            return { bytesPerPixel: 4, channels: 4, format: "RGBA", isUint8: true };

        default:
            return null;
    }
}

// ── QImage byte-size expression helpers ──────────────────────────────────

/**
 * Build evaluate expressions that return the total byte size of a QImage.
 *
 * Qt5: `byteCount()` (deprecated in Qt6)
 * Qt6: `sizeInBytes()` (added in Qt5.10, preferred)
 *
 * We try `sizeInBytes()` first; callers should fall back to `byteCount()`.
 */
export function qImageSizeExprs(varName: string): string[] {
    return [
        `${varName}.sizeInBytes()`,  // Qt5.10+ / Qt6
        `${varName}.byteCount()`,    // Qt5 legacy
    ];
}

// ── QVector / QList element-type extraction ───────────────────────────────

/**
 * Extract the template argument from `QVector<T>` or `QList<T>`.
 * Returns the raw string T (e.g. "float", "QVector2D", "QVector3D").
 * Returns null if the type string doesn't match.
 *
 * Qt6 merges QVector into QList; both spellings are handled here.
 */
export function qVectorElementType(typeStr: string): string | null {
    const m = typeStr.match(/Q(?:Vector|List)\s*<\s*(.+?)\s*>/);
    return m ? m[1] : null;
}

/** True when T is a plain numeric scalar (float, double, int, …). */
export function isQVectorNumericScalar(typeStr: string): boolean {
    const t = qVectorElementType(typeStr);
    if (!t) { return false; }
    return /^(?:float|double|int|unsigned int|long|long long|short|unsigned short|uint|qreal|qint\d+|quint\d+)$/.test(t.trim());
}

/** True when this is QVector<QVector2D> or QList<QVector2D>. */
export function isQVectorOf2D(typeStr: string): boolean {
    const t = qVectorElementType(typeStr);
    return t !== null && t.trim() === "QVector2D";
}

/** True when this is QVector<QVector3D> or QList<QVector3D>. */
export function isQVectorOf3D(typeStr: string): boolean {
    const t = qVectorElementType(typeStr);
    return t !== null && t.trim() === "QVector3D";
}

/** True when the type string is QPolygonF (= QList<QPointF> typedef). */
export function isQPolygonF(typeStr: string): boolean {
    return /\bQPolygonF\b/.test(typeStr);
}

// ── dtype from scalar element type ───────────────────────────────────────

/**
 * Map a Qt element type string to a dtype understood by the viewer.
 * Falls back to "float32" for unknown Qt-specific aliases (qreal = double on
 * most platforms, but we conservatively use float32).
 */
export function qtScalarToDtype(scalar: string): string {
    const t = scalar.trim().toLowerCase();
    if (t === "double" || t === "qreal") { return "float64"; }
    if (t === "float") { return "float32"; }
    if (t === "int" || t === "qint32" || t === "long") { return "int32"; }
    if (t === "unsigned int" || t === "uint" || t === "quint32") { return "uint32"; }
    if (t === "short" || t === "qint16") { return "int16"; }
    if (t === "unsigned short" || t === "quint16") { return "uint16"; }
    if (t === "long long" || t === "qint64") { return "int32"; } // clamp to int32 for viewer
    return "float32";
}

// ── Qt container size via variable tree ──────────────────────────────────

/**
 * Determine the element count of a QVector<T> / QList<T> by walking the DAP
 * variable tree.  Used as a fallback when expression-based `.size()` fails
 * (e.g. cppvsdbg cannot call member functions in `evaluate`).
 *
 * Two strategies are attempted in order:
 *
 * 1. **d-ptr fields** — Qt5 QListData::Data stores `begin` and `end` integers;
 *    size = end − begin.  Qt5 QVector stores `d->size` directly.
 *
 * 2. **Indexed children** — cppvsdbg (with natvis) exposes elements as `[0]`,
 *    `[1]`, …; count the highest index + 1.  Works for small containers only,
 *    because the debugger may cap the number of displayed children.
 *
 * Returns 0 when neither strategy succeeds.
 */
export async function getQContainerSize(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<number> {
    if (variablesReference <= 0) { return 0; }

    let children: DapVar[] = [];
    try {
        const resp = await session.customRequest("variables", { variablesReference });
        children = resp?.variables ?? [];
    } catch { return 0; }

    logger.debug(`getQContainerSize: top children=[${children.map(v => v.name).join(", ")}]`);

    // ── Strategy 1a: QVector<T> style — d->size ──────────────────────────
    // Qt5 QVector: d (QVectorData*) → { ref, size, alloc, … }
    // cppvsdbg may show d → [QArrayData] → { size, … } (one extra level)
    const dVar = children.find(v => v.name === "d" && (v.variablesReference ?? 0) > 0);
    if (dVar?.variablesReference) {
        try {
            const dResp = await session.customRequest("variables", {
                variablesReference: dVar.variablesReference,
            });
            let dVars: DapVar[] = dResp?.variables ?? [];
            logger.debug(`getQContainerSize: d-ptr children=[${dVars.map(v => v.name).join(", ")}]`);

            // cppvsdbg may wrap QArrayData fields inside a QArrayData or [QArrayData] base node
            if (dVars.length === 1 && /QArrayData/.test(dVars[0].name) &&
                (dVars[0].variablesReference ?? 0) > 0) {
                const adResp = await session.customRequest("variables", {
                    variablesReference: dVars[0].variablesReference!,
                });
                dVars = adResp?.variables ?? [];
                logger.debug(`getQContainerSize: QArrayData children=[${dVars.map(v => v.name).join(", ")}]`);
            }

            // Qt5 QVector: d->size
            const sizeVar = dVars.find(v => v.name === "size");
            if (sizeVar) {
                const n = parseInt(sizeVar.value ?? "", 10);
                if (!isNaN(n) && n >= 0) {
                    logger.debug(`getQContainerSize: d->size=${n}`);
                    return n;
                }
            }

            // Qt5 QList: d->begin, d->end  →  size = end - begin
            const beginVar = dVars.find(v => v.name === "begin");
            const endVar   = dVars.find(v => v.name === "end");
            if (beginVar && endVar) {
                const b = parseInt(beginVar.value ?? "", 10);
                const e = parseInt(endVar.value   ?? "", 10);
                if (!isNaN(b) && !isNaN(e) && e >= b) {
                    logger.debug(`getQContainerSize: d->end(${e}) - d->begin(${b}) = ${e - b}`);
                    return e - b;
                }
            }
        } catch { /* fall through */ }
    }

    // ── Strategy 1b: cppvsdbg may surface d with varRef=0; try [QList]  ──
    // Also handles debuggers wrapping QList<T> in a single anonymous child
    // (name="", value="{d:0x...}") — expand it to find the real d-ptr.
    if (!dVar) {
        const qlistBase = children.find(
            v => (/^\[?Q(?:Vector|List)/.test(v.name) || v.name === "") && (v.variablesReference ?? 0) > 0
        );
        if (qlistBase?.variablesReference) {
            logger.debug(`getQContainerSize: trying [QList/QVector] base varRef=${qlistBase.variablesReference}`);
            try {
                const baseResp = await session.customRequest("variables", {
                    variablesReference: qlistBase.variablesReference,
                });
                const baseVars: DapVar[] = baseResp?.variables ?? [];
                const dInBase = baseVars.find(v => v.name === "d" && (v.variablesReference ?? 0) > 0);
                if (dInBase?.variablesReference) {
                    const dResp = await session.customRequest("variables", {
                        variablesReference: dInBase.variablesReference,
                    });
                    let dVars: DapVar[] = dResp?.variables ?? [];
                    // unwrap QArrayData intermediate level (QVector)
                    if (dVars.length === 1 && /QArrayData/.test(dVars[0].name) &&
                        (dVars[0].variablesReference ?? 0) > 0) {
                        const adResp = await session.customRequest("variables", {
                            variablesReference: dVars[0].variablesReference!,
                        });
                        dVars = adResp?.variables ?? [];
                    }
                    const sizeVar = dVars.find(v => v.name === "size");
                    if (sizeVar) {
                        const n = parseInt(sizeVar.value ?? "", 10);
                        if (!isNaN(n) && n >= 0) {
                            logger.debug(`getQContainerSize: base d->size=${n}`);
                            return n;
                        }
                    }
                    const beginVar = dVars.find(v => v.name === "begin");
                    const endVar   = dVars.find(v => v.name === "end");
                    if (beginVar && endVar) {
                        const b = parseInt(beginVar.value ?? "", 10);
                        const e = parseInt(endVar.value   ?? "", 10);
                        if (!isNaN(b) && !isNaN(e) && e >= b) {
                            logger.debug(`getQContainerSize: base d->end-begin = ${e - b}`);
                            return e - b;
                        }
                    }
                }
            } catch { /* fall through */ }
        }
    }

    // ── Strategy 2: count [N] indexed children ────────────────────────────
    // Works when natvis expands elements directly + display limit >= size.
    const indexed = children.filter(v => /^\[\d+\]$/.test(v.name));
    if (indexed.length > 0) {
        const maxIdx = Math.max(...indexed.map(v => parseInt(v.name.slice(1, -1), 10)));
        const n = maxIdx + 1;
        logger.debug(`getQContainerSize: indexed children count=${n} (may be capped)`);
        return n;
    }

    logger.warn(`getQContainerSize: all strategies failed, children=[${children.map(v => v.name).join(", ")}]`);
    return 0;
}

// ── Qt container data pointer via variable tree ───────────────────────────

/**
 * Result of getQVectorDataPointer.
 *
 * slotStride:
 *   0 → QVector contiguous T[] storage — caller uses sizeof(T) naturally.
 *   8 → QList inline storage on 64-bit — each slot is 8 bytes, T data in
 *        the low sizeof(T) bytes of each slot.  Caller must read count×8
 *        bytes and extract sizeof(T) bytes at offset 0 per slot.
 */
export interface QtDataPtr {
    ptr: string;
    slotStride: 0 | 8;
}

/**
 * Return true when `ref` looks like a valid 64-bit Windows user-space address.
 * Valid addresses have the top two bytes as 0x0000 (< 128 TB).
 * Used to distinguish real heap pointers from raw T bits embedded in void* slots
 * (e.g. float 1.0f = 0x3F800000 stored inline → high bytes = 0xCDCDCDCD in MSVC
 * debug builds, which is clearly outside user space).
 */
function isUserSpaceAddr(ref: string): boolean {
    if (!ref || !ref.startsWith("0x")) { return false; }
    // Pad to 16 hex digits and check top 4 digits (= top 16 bits)
    const padded = ref.slice(2).padStart(16, "0");
    return padded.slice(0, 4) === "0000";
}

/**
 * Resolve the first-element address of a Qt5 QVector<T> or QList<T>
 * without calling any member functions (works on cppvsdbg).
 *
 * QVector<T> (QTypedArrayData / QArrayData layout):
 *   d → [QArrayData] → { ref, size, alloc, capacityReserved, offset }
 *   Elements at: (uint8_t*)d + offset   (T[] contiguous)
 *   → returns { ptr: d_addr+offset, slotStride: 0 }
 *
 * QList<T> where sizeof(T) <= sizeof(void*) (inline storage):
 *   d → { ref, alloc, begin, end, void* array[] }
 *   The T value is in the low sizeof(T) bytes of each 8-byte void* slot.
 *   → returns { ptr: &array[begin], slotStride: 8 }
 *
 * QList<T> where sizeof(T) > sizeof(void*) (pointer storage):
 *   Each array slot holds a T* to a separately heap-allocated T — not
 *   contiguous.  Returns null.  Use QVector<T> instead.
 */
export async function getQVectorDataPointer(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<QtDataPtr | null> {
    if (variablesReference <= 0) { return null; }

    let children: DapVar[] = [];
    try {
        const resp = await session.customRequest("variables", { variablesReference });
        children = resp?.variables ?? [];
    } catch { return null; }

    // ── Locate d variable (keep full DapVar for memoryReference) ─────────
    let dVar: DapVar | undefined = children.find(v => v.name === "d");
    let dVarRef: number = dVar?.variablesReference ?? 0;

    // Strategy: look inside [QList]/[QVector] base child when d.varRef=0
    // Also handles anonymous wrapper nodes (name="") used by some debuggers.
    if (dVarRef === 0) {
        const baseNode = children.find(
            v => (/^\[?Q(?:Vector|List)/.test(v.name) || v.name === "") && (v.variablesReference ?? 0) > 0
        );
        if (baseNode?.variablesReference) {
            try {
                const baseResp = await session.customRequest("variables", {
                    variablesReference: baseNode.variablesReference,
                });
                const dInBase = (baseResp?.variables ?? [] as DapVar[]).find(
                    (v: DapVar) => v.name === "d"
                );
                if (dInBase) {
                    dVar = dInBase;
                    dVarRef = dInBase.variablesReference ?? 0;
                }
            } catch { /* ignore */ }
        }
    }

    if (dVarRef === 0) { return null; }

    let dVars: DapVar[] = [];
    try {
        const dResp = await session.customRequest("variables", { variablesReference: dVarRef });
        dVars = dResp?.variables ?? [];
    } catch { return null; }

    logger.debug(`getQVectorDataPointer: d children=[${dVars.map(v => v.name).join(", ")}]`);

    // ── Case A: QVector (QArrayData layout) ──────────────────────────────
    // cppvsdbg shows: d → { [QArrayData]: { ref, size, alloc, capacityReserved, offset } }
    // Element data starts at: (uint8_t*)d + offset
    if (dVars.length === 1 && /QArrayData/.test(dVars[0].name) &&
        (dVars[0].variablesReference ?? 0) > 0) {
        try {
            const adResp = await session.customRequest("variables", {
                variablesReference: dVars[0].variablesReference!,
            });
            const adVars: DapVar[] = adResp?.variables ?? [];
            logger.debug(`getQVectorDataPointer: QArrayData children=[${adVars.map(v => v.name).join(", ")}]`);

            const offsetVar = adVars.find(v => v.name === "offset");
            // d.memoryReference is the pointer VALUE = address of the QArrayData struct
            const dAddr = dVar?.memoryReference
                ?? dVar?.value?.match(/^(0x[0-9a-fA-F]+)/)?.[1];
            if (offsetVar && dAddr && isValidMemoryReference(dAddr)) {
                const offsetVal = parseInt(offsetVar.value ?? "", 10);
                if (!isNaN(offsetVal) && offsetVal > 0) {
                    const ptr = "0x" + (BigInt(dAddr) + BigInt(offsetVal)).toString(16).toUpperCase();
                    logger.debug(`getQVectorDataPointer: QVector d_addr=${dAddr} offset=${offsetVal} → data=${ptr}`);
                    return { ptr, slotStride: 0 };
                }
            }
        } catch { /* fall through */ }
        logger.debug(`getQVectorDataPointer: QVector path — no offset found`);
        return null;
    }

    // ── Case B: QList (QListData::Data layout) ────────────────────────────
    // d → { ref, alloc, begin, end, void* array[] }
    const arrayVar = dVars.find(v => v.name === "array" && (v.variablesReference ?? 0) > 0);
    if (arrayVar?.variablesReference) {
        const beginVar  = dVars.find(v => v.name === "begin");
        const beginIdx  = Math.max(0, parseInt(beginVar?.value ?? "0", 10) || 0);
        try {
            const arrayResp = await session.customRequest("variables", {
                variablesReference: arrayVar.variablesReference,
            });
            const arrayChildren: DapVar[] = arrayResp?.variables ?? [];
            logger.debug(`getQVectorDataPointer: QList array children=[${arrayChildren.map(v => v.name).join(", ")}]`);

            const firstSlot = arrayChildren.find(
                v => v.name === `[${beginIdx}]` || (beginIdx === 0 && v.name === "[0]")
            );
            if (firstSlot) {
                const slotRef = firstSlot.memoryReference ?? "";
                // Distinguish inline vs pointer storage:
                //   inline  — void* slot holds raw T bits (float 1.0 → 0xCDCDCDCD3F800000):
                //             top bytes contain MSVC debug fill → NOT a valid user-space addr
                //   pointer — void* slot holds a real heap T* (0x000001EB...):
                //             top bytes are 0x0000 → valid Windows user-space addr
                if (slotRef && isUserSpaceAddr(slotRef)) {
                    // Pointer storage: each element is separately heap-allocated (sizeof(T) > 8).
                    // Cannot read contiguous data. User should use QVector<T> instead.
                    logger.warn(`getQVectorDataPointer: QList<large T> — pointer storage (slot=${slotRef}); use QVector<T> for visualization`);
                    return null;
                }
                // Inline storage: arrayVar.memoryReference = address of array[0] slot.
                // Stride = sizeof(void*) = 8 bytes on 64-bit.
                const aBase = arrayVar.memoryReference;
                if (aBase && isValidMemoryReference(aBase)) {
                    const ptr = beginIdx === 0
                        ? aBase
                        : "0x" + (BigInt(aBase) + BigInt(beginIdx * 8)).toString(16).toUpperCase();
                    logger.debug(`getQVectorDataPointer: QList inline base=${aBase} begin=${beginIdx} → ${ptr} (slotStride=8)`);
                    return { ptr, slotStride: 8 };
                }
            }
        } catch { /* fall through */ }
    }

    // ── Case C: Qt6 QArrayDataPointer<T> layout ──────────────────────────
    // Qt6 QList<T>: top-level d is QArrayDataPointer<T> with children:
    //   { d (QArrayData*), ptr (T*), size (int) }
    // ptr.memoryReference is directly the address of the first element.
    const ptrVar6 = dVars.find(v => v.name === "ptr");
    if (ptrVar6) {
        const dataAddr = ptrVar6.memoryReference
            ?? ptrVar6.value?.match(/^(0x[0-9a-fA-F]+)/)?.[1];
        if (dataAddr && isValidMemoryReference(dataAddr)) {
            logger.debug(`getQVectorDataPointer: Qt6 QArrayDataPointer ptr=${dataAddr}`);
            return { ptr: dataAddr, slotStride: 0 };
        }
    }

    logger.debug(`getQVectorDataPointer: could not resolve via tree`);
    return null;
}


// ── QImage variable-tree extraction ──────────────────────────────────────

export interface QImageInfo {
    width: number;
    height: number;
    /** QImage::Format enum integer value */
    format: number;
    /** Bytes per scan line (may include row padding) */
    bytesPerLine: number;
    /** Total pixel buffer size in bytes */
    totalBytes: number;
    /** Hex memory reference for the pixel data buffer */
    dataPtr: string;
}

type DapVar = {
    name: string;
    value: string;
    memoryReference?: string;
    variablesReference?: number;
};

/** QImage::Format enum name → integer value (stable across Qt5 / Qt6). */
const QIMAGE_FORMAT_NAME_MAP: Record<string, number> = {
    Format_Invalid:                  0,
    Format_Mono:                     1,
    Format_MonoLSB:                  2,
    Format_Indexed8:                 3,
    Format_RGB32:                    4,
    Format_ARGB32:                   5,
    Format_ARGB32_Premultiplied:     6,
    Format_RGB16:                    7,
    Format_ARGB8565_Premultiplied:   8,
    Format_RGB666:                   9,
    Format_ARGB6666_Premultiplied:  10,
    Format_RGB555:                  11,
    Format_ARGB8555_Premultiplied:  12,
    Format_RGB888:                  13,
    Format_RGB444:                  14,
    Format_ARGB4444_Premultiplied:  15,
    Format_RGBX8888:                16,
    Format_RGBA8888:                17,
    Format_RGBA8888_Premultiplied:  18,
    Format_BGR30:                   19,
    Format_A2BGR30_Premultiplied:   20,
    Format_RGB30:                   21,
    Format_A2RGB30_Premultiplied:   22,
    Format_Alpha8:                  23,
    Format_Grayscale8:              24,
    Format_RGBX64:                  25,
    Format_RGBA64:                  26,
    Format_RGBA64_Premultiplied:    27,
    Format_Grayscale16:             28,
    Format_BGR888:                  29,
};

/**
 * Parse a QImage::Format integer from varied debugger representations:
 *   - Plain integer:                   "24"
 *   - Enum label with value in parens: "QImage::Format_Grayscale8 (24)"
 *   - Hex:                             "0x18"
 *   - Bare enum name (GDB + Qt6):      "QImage::Format_RGB888"
 */
export function parseQImageFormat(valueStr: string): number | null {
    if (!valueStr) { return null; }
    // "SomeName (24)" — parenthesized numeric value at end (cppvsdbg enum display)
    const parenMatch = valueStr.match(/\((-?\d+)\)\s*$/);
    if (parenMatch) {
        const n = parseInt(parenMatch[1], 10);
        return isNaN(n) ? null : n;
    }
    // Plain decimal integer
    const n = parseInt(valueStr.trim(), 10);
    if (!isNaN(n)) { return n; }
    // Hex
    if (/^0x[0-9a-fA-F]+$/i.test(valueStr.trim())) {
        return parseInt(valueStr.trim(), 16);
    }
    // Bare enum name: "QImage::Format_RGB888" or "Format_RGB888" (GDB + Qt6)
    const nameMatch = valueStr.match(/Format_\w+/);
    if (nameMatch) {
        const val = QIMAGE_FORMAT_NAME_MAP[nameMatch[0]];
        if (val !== undefined) { return val; }
    }
    return null;
}

/**
 * Extract all QImageInfo fields from a flat list of DAP variables
 * (the children of QImageData).
 */
function extractFromDVars(vars: DapVar[]): QImageInfo | null {
    let width = 0, height = 0, format = -1, bytesPerLine = 0, totalBytes = 0;
    let dataPtr = "";

    for (const v of vars) {
        if (v.name === "width") {
            width = parseInt(v.value) || 0;
        } else if (v.name === "height") {
            height = parseInt(v.value) || 0;
        } else if (v.name === "format") {
            const fmt = parseQImageFormat(v.value);
            if (fmt !== null) { format = fmt; }
        } else if (v.name === "bytes_per_line") {
            bytesPerLine = parseInt(v.value) || 0;
        } else if (v.name === "nbytes") {
            totalBytes = parseInt(v.value) || 0;
        } else if (v.name === "data") {
            // Prefer DAP memoryReference; fall back to hex in value string
            if (v.memoryReference && isValidMemoryReference(v.memoryReference)) {
                dataPtr = v.memoryReference;
            } else {
                const ptrMatch = v.value?.match(/0x[0-9a-fA-F]+/);
                if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
                    dataPtr = ptrMatch[0];
                }
            }
        }
    }

    if (width <= 0 || height <= 0 || format < 0 || !dataPtr) { return null; }

    const layout = qImageLayout(format);
    if (!layout) { return null; }

    if (bytesPerLine <= 0) { bytesPerLine = width * layout.bytesPerPixel; }
    if (totalBytes <= 0)   { totalBytes   = bytesPerLine * height; }

    return { width, height, format, bytesPerLine, totalBytes, dataPtr };
}

/**
 * Walk the DAP variable tree for a QImage to extract its metadata without
 * calling any member functions (which cppvsdbg often cannot evaluate).
 *
 * Qt5 QImage uses the pimpl pattern: QImage → d (QImageData*) which holds:
 *   data           uchar*
 *   width / height int
 *   format         QImage::Format  (int enum)
 *   bytes_per_line int
 *   nbytes         qsizetype / int
 *
 * Falls back to reading fields at the top level in case natvis expands them
 * there directly.
 */
export async function getQImageInfoFromVariables(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<QImageInfo | null> {
    try {
        const resp = await session.customRequest("variables", { variablesReference });
        const topVars: DapVar[] = resp?.variables ?? [];

        // ── Try Qt5 pimpl: QImage → d → QImageData children ─────────────
        const dVar = topVars.find(v => v.name === "d");
        let dVarRef = dVar?.variablesReference ?? 0;

        // cppvsdbg often shows `d` at top level with variablesReference=0 (the
        // pointer value is displayed but the struct is not expandable from here).
        // However the hidden `[QImage]` base-class child (cppvsdbg raw expansion)
        // usually has a `d` with a proper variablesReference.  Resolve it first.
        if (dVarRef === 0) {
            const qimageBase = topVars.find(v => v.name === "[QImage]" && (v.variablesReference ?? 0) > 0);
            if (qimageBase?.variablesReference) {
                logger.debug(`getQImageInfoFromVariables: d varRef=0, trying [QImage] base varRef=${qimageBase.variablesReference}`);
                try {
                    const baseResp = await session.customRequest("variables", {
                        variablesReference: qimageBase.variablesReference,
                    });
                    const baseVars: DapVar[] = baseResp?.variables ?? [];
                    logger.debug(`getQImageInfoFromVariables: [QImage] base children: [${baseVars.map(v => v.name).join(", ")}]`);
                    const dInBase = baseVars.find(v => v.name === "d" && (v.variablesReference ?? 0) > 0);
                    if (dInBase?.variablesReference) {
                        dVarRef = dInBase.variablesReference;
                        logger.debug(`getQImageInfoFromVariables: resolved d via [QImage] varRef=${dVarRef}`);
                    }
                } catch { /* fall through */ }
            }
        }

        if (dVarRef > 0) {
            logger.debug(`getQImageInfoFromVariables: found d-ptr varRef=${dVarRef}`);
            try {
                const dResp = await session.customRequest("variables", {
                    variablesReference: dVarRef,
                });
                const dVars: DapVar[] = dResp?.variables ?? [];
                logger.debug(`getQImageInfoFromVariables: d-ptr has ${dVars.length} children: [${dVars.map(v => v.name).join(", ")}]`);

                // If data pointer is missing via value string, try expanding the
                // `data` node — cppvsdbg may place the memoryReference there.
                const dataVar = dVars.find(v => v.name === "data");
                if (dataVar && !dataVar.memoryReference && !(dataVar.value?.match(/0x[0-9a-fA-F]+/)) &&
                    dataVar.variablesReference && dataVar.variablesReference > 0) {
                    try {
                        const dataChildren = await session.customRequest("variables", {
                            variablesReference: dataVar.variablesReference,
                        });
                        for (const dc of dataChildren?.variables ?? []) {
                            if (dc.memoryReference && isValidMemoryReference(dc.memoryReference)) {
                                // Inject memoryReference back so extractFromDVars picks it up
                                dataVar.memoryReference = dc.memoryReference;
                                logger.debug(`getQImageInfoFromVariables: data ptr via child memRef=${dc.memoryReference}`);
                                break;
                            }
                            const p = dc.value?.match(/0x[0-9a-fA-F]+/);
                            if (p && isValidMemoryReference(p[0])) {
                                dataVar.value = dc.value;
                                logger.debug(`getQImageInfoFromVariables: data ptr via child value=${dc.value}`);
                                break;
                            }
                        }
                    } catch { /* ignore */ }
                }

                const info = extractFromDVars(dVars);
                if (info) {
                    logger.debug(`getQImageInfoFromVariables: pimpl OK ${info.width}x${info.height} fmt=${info.format} bytes=${info.totalBytes} ptr=${info.dataPtr}`);
                    return info;
                }
                logger.warn(`getQImageInfoFromVariables: extractFromDVars failed on d-ptr children`);
            } catch { /* fall through */ }
        } else {
            logger.debug(`getQImageInfoFromVariables: no expandable d-ptr found, topVars=[${topVars.map(v => v.name).join(", ")}]`);
        }

        // ── Fallback: natvis may expose QImageData fields at top level ───
        logger.debug(`getQImageInfoFromVariables: trying top-level natvis fallback`);
        const topInfo = extractFromDVars(topVars);
        if (!topInfo) { logger.warn(`getQImageInfoFromVariables: could not extract QImageInfo from variable tree`); }
        return topInfo;
    } catch {
        return null;
    }
}
