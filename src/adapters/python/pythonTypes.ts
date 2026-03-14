/**
 * pythonTypes.ts — Pure, zero-side-effect type detection for Python variables.
 *
 * Two-layer detection:
 *   Layer 1 (basicTypeDetect)       — fast string match on the DAP `type` field
 *   Layer 2 (detectVisualizableType) — shape + dtype aware classification
 *
 * No VS Code API or debug-session calls in this file.
 * VisualizableKind and VariableInfo are defined in the shared IDebugAdapter
 * interface; this file re-exports them for convenience.
 */

import { VariableInfo, VisualizableKind } from "../IDebugAdapter";

// Re-export so legacy imports via utils/pythonTypes still resolve.
export { VisualizableKind } from "../IDebugAdapter";

// ── Layer 1: fast path ─────────────────────────────────────────────────────

/** Known type-string fragments → coarse kind.
 *
 * Each array contains patterns for BOTH the fully-qualified form
 * ("numpy.ndarray") and the short DAP `type` form ("ndarray") that
 * debugpy returns as `type(obj).__name__`.
 */
const IMAGE_TYPE_PATTERNS = [
    // numpy.ndarray is no longer an image type — it maps to plot/pointcloud/unknown
    /PIL\.(Image|JpegImagePlugin|PngImagePlugin)|\bImageFile\b/i, // full OR short PIL class names
    /torch\.Tensor|\bTensor\b/i,                          // "torch.Tensor" or "Tensor"
    /cv2\.(Mat|UMat|cuda\.GpuMat)|\b(UMat|GpuMat)\b/i,  // cv2 types (UMat/GpuMat distinguish from cv::Mat)
];
const PLOT_TYPE_PATTERNS = [
    /^(builtins\.)?list$/i,
    /^(builtins\.)?tuple$/i,
    /^(builtins\.)?range$/i,
    /array\.array/i,
    /numpy\.ndarray|\bndarray\b/i,  // refined in Layer 2 (1D→plot, Nx2→scatter, else pointcloud/unknown)
    /torch\.Tensor|\bTensor\b/i,
];
const POINTCLOUD_TYPE_PATTERNS = [
    /numpy\.ndarray|\bndarray\b/i,       // Nx3 / Nx6 ndarray — Layer 2 decides
    /open3d.*PointCloud|\bPointCloud\b/i, // open3d.geometry.PointCloud — DAP returns bare "PointCloud" as type.__name__
];

/**
 * Layer-1 basic detection from the DAP `type` string.
 * Returns "unknown" when no pattern matches.
 * ndarray/Tensor may match multiple categories; Layer 2 refines once shape/dtype are available.
 */
export function basicTypeDetect(typeStr: string): VisualizableKind {
    for (const pat of IMAGE_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            return "image"; // Will be refined by Layer 2 for torch
        }
    }
    // Check pointcloud before plot so open3d.PointCloud short-circuits correctly
    for (const pat of POINTCLOUD_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            // numpy also matches PLOT patterns; return "plot" as the TreeView hint
            // (Layer 2 will promote to pointcloud when shape warrants it)
            if (/numpy\.ndarray|\bndarray\b/i.test(typeStr)) { break; }
            return "pointcloud";
        }
    }
    for (const pat of PLOT_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            return "plot";
        }
    }
    return "unknown";
}

// ── Layer 2: shape-aware detection ────────────────────────────────────────

/**
 * Accurate classification using fully-resolved VariableInfo.
 * Call this when you have shape + dtype from a debug evaluate.
 */
export function detectVisualizableType(info: VariableInfo): VisualizableKind {
    const { typeName = "", shape, dtype, length } = info;

    // ── open3d.geometry.PointCloud ───────────────────────────────────────────
    if (/open3d.*PointCloud/i.test(typeName)) {
        return "pointcloud";
    }

    // ── cv2.UMat / cv2.cuda.GpuMat ──────────────────────────────────────────
    if (/cv2\.(UMat|cuda\.GpuMat)/i.test(typeName)) {
        return "image";
    }

    // ── numpy.ndarray ────────────────────────────────────────────────────────
    if (/numpy\.ndarray/i.test(typeName)) {
        return classifyNdarray(shape, dtype);
    }

    // ── torch.Tensor ────────────────────────────────────────────────────────
    if (/torch\.Tensor/i.test(typeName)) {
        return classifyTensor(shape);
    }

    // ── PIL.Image ────────────────────────────────────────────────────────────
    if (/PIL\./i.test(typeName)) {
        return "image";
    }

    // ── list / tuple — use shape inferred by getVariableInfo ─────────────────
    if (/^builtins\.(list|tuple)$/.test(typeName)) {
        if (shape && shape.length === 2) {
            const cols = shape[1];
            if (cols === 2) { return "plot"; }             // list of 2-tuples → 2D scatter
            if (cols === 3 || cols === 6) { return "pointcloud"; } // list of 3-tuples → 3D pointcloud
            return "unknown";                              // unsupported inner dimension
        }
        if (shape && shape.length === 1) { return "plot"; } // flat 1D list
        return "plot"; // fallback
    }

    // ── range / array.array ───────────────────────────────────────────────────
    if (/^builtins\.range$/.test(typeName) || /array\.array/.test(typeName)) {
        return "plot";
    }

    void length;
    return "unknown";
}

// ── ndarray classification ─────────────────────────────────────────────────

export function classifyNdarray(
    shape: number[] | null | undefined,
    dtype: string | null | undefined
): VisualizableKind {
    if (!shape || shape.length === 0) {
        return "unknown";
    }

    const ndim = shape.length;

    // 1-D → plot (1D line/scatter chart)
    if (ndim === 1) {
        return "plot";
    }

    if (ndim === 2) {
        const cols = shape[1];
        // [N, 2]      → 2D scatter plot (xValues + yValues)
        if (cols === 2) { return "plot"; }
        // [N, 3|6]    → 3D point cloud (XYZ or XYZ+RGB)
        if (cols === 3 || cols === 6) { return "pointcloud"; }
        // All other 2D shapes are unsupported
        void dtype;
        return "unknown";
    }

    // 3D: (H, W, C) image — cv2.imread() and similar ndarray images
    if (ndim === 3) {
        const c = shape[2];
        if (c === 1 || c === 3 || c === 4) { return "image"; }
        return "unknown";
    }

    // 4D, etc. — not supported
    void dtype;
    return "unknown";
}

// ── torch.Tensor classification ────────────────────────────────────────────

export function classifyTensor(
    shape: number[] | null | undefined
): VisualizableKind {
    if (!shape || shape.length === 0) {
        return "unknown";
    }
    const ndim = shape.length;

    if (ndim === 1) {
        return "plot";
    }
    if (ndim === 2) {
        return "image";
    }
    if (ndim === 3) {
        const c = shape[0]; // (C, H, W) convention
        if (c === 1 || c === 3 || c === 4) {
            return "image";
        }
        const lastDim = shape[2];
        if (lastDim === 3 || lastDim === 6) {
            return "pointcloud";
        }
    }
    if (ndim === 4) {
        return "image"; // (B, C, H, W)
    }
    return "unknown";
}

// ── Dtype helpers ──────────────────────────────────────────────────────────

const NUMERIC_DTYPES = new Set([
    "uint8",
    "uint16",
    "uint32",
    "uint64",
    "int8",
    "int16",
    "int32",
    "int64",
    "float16",
    "float32",
    "float64",
    "bool",
]);

export function isNumericDtype(dtype: string | null | undefined): boolean {
    if (!dtype) {
        return true; // assume numeric when unknown
    }
    const base = dtype.replace(/[<>=!|]/, "").toLowerCase();
    return NUMERIC_DTYPES.has(base) || /^[uif]\d+$/.test(base);
}

/** Number of bytes per element for a dtype string. Returns null if unknown. */
export function bytesPerElement(dtype: string): number | null {
    const m = dtype.match(/(\d+)$/);
    if (!m) {
        return null;
    }
    return parseInt(m[1], 10) / 8;
}
