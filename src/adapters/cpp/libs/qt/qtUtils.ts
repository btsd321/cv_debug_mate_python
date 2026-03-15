/**
 * qt/qtUtils.ts — Qt-specific helpers shared by all Qt lib providers.
 *
 * Pure functions only; no VS Code API, no async.
 *
 * Covers:
 *   - QImage::Format enum values (Qt5 = Qt6, layout unchanged)
 *   - Selecting the correct byte-size expression (Qt5: byteCount, Qt6: sizeInBytes)
 *   - Extracting the element type from QVector<T> / QList<T> type strings
 *   - Deciding whether a type string is a Qt numeric 1D container vs. a
 *     2D scatter container vs. a 3D point-cloud container
 */

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
