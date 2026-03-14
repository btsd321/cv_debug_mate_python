/**
 * utils.ts — Shared low-level buffer and stats helpers for Python lib providers.
 *
 * These are pure TypeScript functions with no VS Code or debug-session
 * dependencies, so they can be imported by any lib-specific provider.
 */

// ── Buffer helpers ─────────────────────────────────────────────────────────

/** Build a typed ArrayBufferView from a raw Uint8Array and a numpy dtype string. */
export function typedViewOf(buffer: Uint8Array, dtype: string): ArrayLike<number> {
    const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    );
    switch (dtype) {
        case "uint8": return new Uint8Array(ab);
        case "int8": return new Int8Array(ab);
        case "uint16": return new Uint16Array(ab);
        case "int16": return new Int16Array(ab);
        case "uint32": return new Uint32Array(ab);
        case "int32": return new Int32Array(ab);
        case "float32": return new Float32Array(ab);
        case "float64": return new Float64Array(ab);
        default: return new Float32Array(ab);
    }
}

/** Convert a Uint8Array → flat number[] using the given numpy dtype. */
export function typedBufferToNumbers(buffer: Uint8Array, dtype: string): number[] {
    return Array.from(typedViewOf(buffer, dtype) as unknown as number[]);
}

/** Compute min/max over a raw byte buffer given its numpy dtype. */
export function computeMinMax(
    buffer: Uint8Array,
    dtype: string
): { dataMin: number; dataMax: number } {
    const view = typedViewOf(buffer, dtype);
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (let i = 0; i < view.length; i++) {
        const v = view[i] as number;
        if (v < dataMin) { dataMin = v; }
        if (v > dataMax) { dataMax = v; }
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

// ── Shape helpers ──────────────────────────────────────────────────────────

/** Resolve (H,W) or (H,W,C) shape to a [height, width, channels] triple. */
export function resolveHWC(shape: number[]): [number, number, number] {
    if (shape.length === 2) {
        return [shape[0], shape[1], 1];
    }
    return [shape[0], shape[1], shape[2]];
}

// ── Stats helpers ──────────────────────────────────────────────────────────

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
        if (v < min) { min = v; }
        if (v > max) { max = v; }
        sum += v;
    }
    const mean = sum / n;
    const std = Math.sqrt(
        values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n
    );
    return { min, max, mean, std };
}

// ── Point cloud helpers ────────────────────────────────────────────────────

export interface XYZBounds {
    xMin: number; xMax: number;
    yMin: number; yMax: number;
    zMin: number; zMax: number;
}

export function computeBounds(xyz: number[]): XYZBounds {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < xyz.length; i += 3) {
        if (xyz[i] < xMin) { xMin = xyz[i]; }
        if (xyz[i] > xMax) { xMax = xyz[i]; }
        if (xyz[i + 1] < yMin) { yMin = xyz[i + 1]; }
        if (xyz[i + 1] > yMax) { yMax = xyz[i + 1]; }
        if (xyz[i + 2] < zMin) { zMin = xyz[i + 2]; }
        if (xyz[i + 2] > zMax) { zMax = xyz[i + 2]; }
    }
    return {
        xMin: isFinite(xMin) ? xMin : 0, xMax: isFinite(xMax) ? xMax : 0,
        yMin: isFinite(yMin) ? yMin : 0, yMax: isFinite(yMax) ? yMax : 0,
        zMin: isFinite(zMin) ? zMin : 0, zMax: isFinite(zMax) ? zMax : 0,
    };
}
