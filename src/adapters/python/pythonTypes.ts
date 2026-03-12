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
  /numpy\.ndarray|\bndarray\b/i,                        // "numpy.ndarray" or "ndarray"
  /PIL\.(Image|JpegImagePlugin|PngImagePlugin)|\bImageFile\b/i, // full OR short PIL class names
  /torch\.Tensor|\bTensor\b/i,                          // "torch.Tensor" or "Tensor"
  /cv2\.(Mat|UMat|cuda\.GpuMat)|\b(UMat|GpuMat)\b/i,  // cv2 types (UMat/GpuMat distinguish from cv::Mat)
];
const PLOT_TYPE_PATTERNS = [
  /^(builtins\.)?list$/i,
  /^(builtins\.)?tuple$/i,
  /^(builtins\.)?range$/i,
  /array\.array/i,
  /numpy\.ndarray|\bndarray\b/i,  // Could be 1D — will be refined in Layer 2
  /torch\.Tensor|\bTensor\b/i,
];
const POINTCLOUD_TYPE_PATTERNS = [/numpy\.ndarray|\bndarray\b/i]; // Nx3 / Nx6 ndarray

/**
 * Layer-1 basic detection from the DAP `type` string.
 * Returns "unknown" when no pattern matches.
 * ndarray/Tensor may match multiple categories; caller should use Layer 2
 * to refine once shape/dtype are available.
 */
export function basicTypeDetect(typeStr: string): VisualizableKind {
  for (const pat of IMAGE_TYPE_PATTERNS) {
    if (pat.test(typeStr)) {
      return "image"; // Will be refined by Layer 2
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

  // ── list / tuple / array.array / range ───────────────────────────────────
  if (
    /^builtins\.(list|tuple|range)$/.test(typeName) ||
    /array\.array/.test(typeName)
  ) {
    return "plot";
  }

  void length; // used for future list-length checks
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
  const lastDim = shape[ndim - 1];

  // 1-D  → plot
  if (ndim === 1) {
    return "plot";
  }

  // 2-D  → grayscale image (any numeric dtype)
  if (ndim === 2) {
    return isNumericDtype(dtype) ? "image" : "unknown";
  }

  // 3-D  (H, W, C) where C = 1/3/4  → image
  //       (N, 3)                     → point cloud
  //       (N, 6)                     → point cloud with color
  if (ndim === 3) {
    if (lastDim === 1 || lastDim === 3 || lastDim === 4) {
      return "image";
    }
    if ((lastDim === 3 || lastDim === 6) && shape[0] > 1) {
      return "pointcloud";
    }
  }

  // 4-D  (1, C, H, W) or (B, C, H, W) — treat as image (first slice)
  if (ndim === 4 && (lastDim === 1 || shape[1] <= 4)) {
    return "image";
  }

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
