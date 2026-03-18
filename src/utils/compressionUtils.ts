/**
 * compressionUtils.ts — Image compression helpers for remote-transfer acceleration.
 *
 * Exposes:
 *   isRemote()          — true when VS Code is running in a remote environment
 *                         (Remote SSH, WSL, Dev Container, etc.)
 *   shouldCompress()    — reads user config (mode + thresholdMB) and returns
 *                         whether the given number of raw bytes should be compressed
 *   IImageCompressor    — interface for a pluggable compression codec
 *   compressImageData() — compress an ImageData using the algorithm chosen by
 *                         matrixViewer.image.compression.algorithm config
 *
 * Only image data is compressed.  Plot and PointCloud data are never touched.
 */

import * as zlib from "zlib";
import * as vscode from "vscode";
import { ImageData } from "../viewers/viewerTypes";

// ── Environment detection ──────────────────────────────────────────────────

/**
 * Returns true when the extension host is running inside a remote environment
 * (Remote SSH, WSL, Dev Container, GitHub Codespaces, …).
 *
 * Uses `vscode.env.remoteName` which is `undefined` for local sessions and
 * set to e.g. "ssh-remote", "wsl", "dev-container" for remote ones.
 */
export function isRemote(): boolean {
    return vscode.env.remoteName !== undefined;
}

// ── Compression policy ────────────────────────────────────────────────────

/**
 * Decide whether to compress an image whose raw pixel data is `rawByteCount` bytes.
 *
 * Reads two settings:
 *   matrixViewer.image.compression.mode        — "auto" | "always" | "never"
 *   matrixViewer.image.compression.thresholdMB — number (default 1)
 */
export function shouldCompress(rawByteCount: number): boolean {
    const cfg = vscode.workspace.getConfiguration("matrixViewer");
    const mode = cfg.get<string>("image.compression.mode", "auto");
    const thresholdMB = cfg.get<number>("image.compression.thresholdMB", 1);

    if (mode === "never") { return false; }
    if (mode === "always") { return rawByteCount >= thresholdMB * 1024 * 1024; }
    // "auto": compress only in remote environments
    return isRemote() && rawByteCount >= thresholdMB * 1024 * 1024;
}

// ── Compressor interface & built-in implementations ───────────────────────

/**
 * Contract for a single compression codec.
 *
 * Built-in implementations:
 *   DeflateCompressor    — zlib deflate  → encoding "deflate"
 *   GzipCompressor       — gzip          → encoding "gzip"
 *   DeflateRawCompressor — raw deflate   → encoding "deflate-raw"
 *
 * All three are decompressible in the browser via
 * `new DecompressionStream(encoding)` without any third-party library.
 *
 * When algorithm is "auto", getCompressor() selects between:
 *   AUTO_FAST_COMPRESSOR (deflate-raw level 1) — for data below the high threshold
 *   AUTO_BEST_COMPRESSOR (deflate level 9)     — for data at or above the high threshold
 * The high threshold is: thresholdMB × autoHighThresholdFactor.
 */
export interface IImageCompressor {
    /** The value written to ImageData.encoding after compression. */
    readonly encoding: "deflate" | "gzip" | "deflate-raw";
    /** Synchronously compress a raw pixel Buffer. */
    compress(raw: Buffer): Buffer;
}

class DeflateCompressor implements IImageCompressor {
    readonly encoding = "deflate" as const;
    constructor(private readonly level: number = 6) {}
    compress(raw: Buffer): Buffer { return zlib.deflateSync(raw, { level: this.level }); }
}

class GzipCompressor implements IImageCompressor {
    readonly encoding = "gzip" as const;
    constructor(private readonly level: number = 6) {}
    compress(raw: Buffer): Buffer { return zlib.gzipSync(raw, { level: this.level }); }
}

class DeflateRawCompressor implements IImageCompressor {
    readonly encoding = "deflate-raw" as const;
    constructor(private readonly level: number = 6) {}
    compress(raw: Buffer): Buffer { return zlib.deflateRawSync(raw, { level: this.level }); }
}

/** Named compressors for the explicit algorithm setting (level 6 default). */
const COMPRESSORS: Readonly<Record<string, IImageCompressor>> = {
    "deflate":     new DeflateCompressor(),
    "gzip":        new GzipCompressor(),
    "deflate-raw": new DeflateRawCompressor(),
};

/**
 * Pre-configured compressors used by the "auto" strategy.
 *   AUTO_FAST — deflate-raw level 1: minimum latency, still halves typical RGBA data.
 *   AUTO_BEST — deflate    level 9: maximum compression ratio for very large images.
 */
const AUTO_FAST_COMPRESSOR: IImageCompressor = new DeflateRawCompressor(1);
const AUTO_BEST_COMPRESSOR: IImageCompressor = new DeflateCompressor(9);

/**
 * Multiplier applied to thresholdMB in "auto" mode.
 * When rawBytes ≥ thresholdMB × AUTO_HIGH_FACTOR the best-compression codec is used;
 * below that the fast codec is used instead.
 */
const AUTO_HIGH_FACTOR = 4;

/**
 * Returns the compressor to use for the given raw byte count.
 *
 * When algorithm is "auto":
 *   rawByteCount < thresholdMB × AUTO_HIGH_FACTOR  →  AUTO_FAST_COMPRESSOR
 *   rawByteCount ≥ thresholdMB × AUTO_HIGH_FACTOR  →  AUTO_BEST_COMPRESSOR
 *
 * Falls back to DeflateCompressor for unknown algorithm values.
 */
function getCompressor(rawByteCount: number): IImageCompressor {
    const cfg = vscode.workspace.getConfiguration("matrixViewer");
    const algo = cfg.get<string>("image.compression.algorithm", "auto");

    if (algo === "auto") {
        const thresholdMB = cfg.get<number>("image.compression.thresholdMB", 1);
        return rawByteCount >= thresholdMB * AUTO_HIGH_FACTOR * 1024 * 1024
            ? AUTO_BEST_COMPRESSOR
            : AUTO_FAST_COMPRESSOR;
    }
    return COMPRESSORS[algo] ?? COMPRESSORS["deflate"];
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Attempt to compress the pixel bytes in an ImageData using the algorithm
 * configured via `matrixViewer.image.compression.algorithm`.
 *
 * Returns a new ImageData with encoding set to the selected algorithm's tag.
 *
 * No-ops (returns the original object unchanged) when:
 *   - data.encoding is already "png"        (Layer 1 already compressed)
 *   - data.encoding is a compressed type    (already compressed)
 *   - shouldCompress() returns false        (local env or below threshold)
 *
 * The raw byte count is estimated from b64Bytes.length * 0.75 so no
 * decoding is needed just to decide whether to compress.
 */
export function compressImageData(data: ImageData): ImageData {
    // Already compressed by an earlier layer — nothing to do.
    if (data.encoding === "png"
        || data.encoding === "deflate"
        || data.encoding === "gzip"
        || data.encoding === "deflate-raw") {
        return data;
    }

    // Estimate raw pixel size from the base64 string (3 bytes per 4 chars).
    const estimatedRawBytes = Math.floor(data.b64Bytes.length * 0.75);
    if (!shouldCompress(estimatedRawBytes)) {
        return data;
    }

    const compressor = getCompressor(estimatedRawBytes);
    try {
        const rawBuf = Buffer.from(data.b64Bytes, "base64");
        const compressed = compressor.compress(rawBuf);
        return { ...data, b64Bytes: compressed.toString("base64"), encoding: compressor.encoding };
    } catch {
        // Compression failed (unexpected) — fall back to uncompressed data.
        return data;
    }
}
