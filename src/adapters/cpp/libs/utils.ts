/**
 * utils.ts — Shared buffer/type helpers for C++ lib providers.
 *
 * Pure TypeScript functions with no VS Code or debug-session dependencies.
 * Mirrors the role of src/adapters/python/libs/utils.ts for the C++ side.
 */

// ── C++ type helpers ─────────────────────────────────────────────────────

/**
 * Map a C++ element type string to a dtype string compatible with
 * `viewerTypes.ts` and the front-end renderers.
 * Used by Eigen, STL, and other non-OpenCV providers.
 */
export function cppTypeToDtype(cppType: string): string {
    const t = cppType.toLowerCase().trim();
    if (t === "double" || t.includes("double")) {
        return "float64";
    }
    if (t === "float" || t.includes("float")) {
        return "float32";
    }
    if (t === "int" || t === "int32_t" || t.includes("int32")) {
        return "int32";
    }
    if (t === "short" || t === "int16_t" || t.includes("int16")) {
        return "int16";
    }
    // Check uint16 BEFORE int16 handling above, and uint8 BEFORE int8
    if (t === "unsigned short" || t === "uint16_t" || t.includes("uint16")) {
        return "uint16";
    }
    if (
        t === "unsigned char" ||
        t === "uchar" ||
        t === "uint8_t" ||
        t.includes("uint8")
    ) {
        return "uint8";
    }
    if (
        t === "char" ||
        t === "signed char" ||
        t === "int8_t" ||
        t.includes("int8")
    ) {
        return "int8";
    }
    return "uint8"; // default
}

// ── Buffer helpers ─────────────────────────────────────────────────────────

/** Build a typed ArrayBufferView over a raw Uint8Array given a dtype string. */
export function typedViewOf(
    buffer: Uint8Array,
    dtype: string
): ArrayLike<number> {
    const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
    switch (dtype) {
        case "uint8":
            return new Uint8Array(ab);
        case "int8":
            return new Int8Array(ab);
        case "uint16":
            return new Uint16Array(ab);
        case "int16":
            return new Int16Array(ab);
        case "uint32":
            return new Uint32Array(ab);
        case "int32":
            return new Int32Array(ab);
        case "float32":
            return new Float32Array(ab);
        case "float64":
            return new Float64Array(ab);
        default:
            return new Float32Array(ab);
    }
}

/** Convert a Uint8Array to a flat number[] using the given dtype name. */
export function typedBufferToNumbers(
    buffer: Uint8Array,
    dtype: string
): number[] {
    return Array.from(typedViewOf(buffer, dtype) as ArrayLike<number>);
}

/** Compute min/max over a raw Uint8Array given its dtype. */
export function computeMinMax(
    buffer: Uint8Array,
    dtype: string
): { dataMin: number; dataMax: number } {
    const view = typedViewOf(buffer, dtype);
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (let i = 0; i < view.length; i++) {
        const v = (view as ArrayLike<number>)[i];
        if (v < dataMin) {
            dataMin = v;
        }
        if (v > dataMax) {
            dataMax = v;
        }
    }
    return {
        dataMin: isFinite(dataMin) ? dataMin : 0,
        dataMax: isFinite(dataMax) ? dataMax : 1,
    };
}

/** Encode a Uint8Array to a Base64 string (chunked to avoid stack overflow). */
export function bufferToBase64(buffer: Uint8Array): string {
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < buffer.length; i += chunk) {
        binary += String.fromCharCode(
            ...buffer.subarray(i, Math.min(i + chunk, buffer.length))
        );
    }
    return btoa(binary);
}

// ── Stats helpers ─────────────────────────────────────────────────────────

export interface DataStats {
    min: number;
    max: number;
    mean: number;
    std: number;
}

export function computeStats(values: number[]): DataStats {
    const n = values.length;
    if (n === 0) {
        return { min: 0, max: 0, mean: 0, std: 0 };
    }
    let min = values[0];
    let max = values[0];
    let sum = 0;
    for (const v of values) {
        if (v < min) {
            min = v;
        }
        if (v > max) {
            max = v;
        }
        sum += v;
    }
    const mean = sum / n;
    const std = Math.sqrt(
        values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
    );
    return { min, max, mean, std };
}

// ── Point cloud helpers ───────────────────────────────────────────────────

export interface XYZBounds {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
}

export function computeBounds(xyz: number[]): XYZBounds {
    let xMin = Infinity,
        xMax = -Infinity;
    let yMin = Infinity,
        yMax = -Infinity;
    let zMin = Infinity,
        zMax = -Infinity;
    for (let i = 0; i < xyz.length; i += 3) {
        if (xyz[i] < xMin) {
            xMin = xyz[i];
        }
        if (xyz[i] > xMax) {
            xMax = xyz[i];
        }
        if (xyz[i + 1] < yMin) {
            yMin = xyz[i + 1];
        }
        if (xyz[i + 1] > yMax) {
            yMax = xyz[i + 1];
        }
        if (xyz[i + 2] < zMin) {
            zMin = xyz[i + 2];
        }
        if (xyz[i + 2] > zMax) {
            zMax = xyz[i + 2];
        }
    }
    return {
        xMin: isFinite(xMin) ? xMin : 0,
        xMax: isFinite(xMax) ? xMax : 0,
        yMin: isFinite(yMin) ? yMin : 0,
        yMax: isFinite(yMax) ? yMax : 0,
        zMin: isFinite(zMin) ? zMin : 0,
        zMax: isFinite(zMax) ? zMax : 0,
    };
}
