"""
CV DebugMate Python — Demo Script
==================================
Run this script with F5 (launch config: "CV DebugMate: Run demo.py") to
interactively test every supported variable type.

Set a breakpoint on the `breakpoint()` call (or anywhere in the BREAKPOINT
section).  In the "CV DebugMate" panel in the Debug sidebar, click a variable
to open its viewer.

Supported types exercised here:
  Image (2D)   : grayscale_u8, grayscale_f32, bgr_u8, rgba_u8, pil_image,
                 small_float_img
  Plot (1D)    : signal_1d, noise_1d, my_list, my_tuple
  Point Cloud  : cloud_xyz, cloud_xyzrgb
"""

import os
import numpy as np
from PIL import Image

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_IMG_PATH = os.path.join(SCRIPT_DIR, "..", "assets", "test_img.png")

# ── 2D Image: numpy ndarray ────────────────────────────────────────────────────

# Load the test image (2048 × 2048 RGBA) and derive several variants
_pil_src = Image.open(TEST_IMG_PATH)
_np_rgba = np.array(_pil_src, dtype=np.uint8)              # (2048, 2048, 4)

# Grayscale uint8  (H, W)
grayscale_u8 = _np_rgba[:, :, 0].copy()

# Grayscale float32  (H, W)  values in [0, 1]
grayscale_f32 = _np_rgba[:, :, 0].astype(np.float32) / 255.0

# BGR uint8  (H, W, 3)  — OpenCV convention
bgr_u8 = _np_rgba[:, :, 2::-1].copy()   # flip R↔B, drop alpha

# RGBA uint8  (H, W, 4)
rgba_u8 = _np_rgba.copy()

# Small float image  (64, 64)  range outside [0, 255]  → needs Auto-Normalize
rng = np.random.default_rng(42)
small_float_img = rng.standard_normal((64, 64)).astype(np.float32) * 100

# ── 2D Image: PIL.Image ────────────────────────────────────────────────────────

pil_image = _pil_src.copy()              # PIL RGBA image (2048 × 2048)
pil_gray  = _pil_src.convert("L")       # PIL grayscale  (2048 × 2048)

# ── 2D Image: single-channel ndarray (H, W, 1) ────────────────────────────────
single_ch = _np_rgba[:, :, :1].copy()   # (2048, 2048, 1)

# ── 1D Plot: numpy ndarray ─────────────────────────────────────────────────────
N = 512
t = np.linspace(0, 4 * np.pi, N)
signal_1d  = (np.sin(t) + 0.5 * np.sin(3 * t)).astype(np.float32)   # clean sine
noise_1d   = rng.standard_normal(N).astype(np.float32)               # white noise
ramp_1d    = np.arange(N, dtype=np.float64)                          # linear ramp

# ── 1D Plot: Python builtins ───────────────────────────────────────────────────
my_list  = [float(v) for v in signal_1d[:64]]
my_tuple = tuple(range(32))

# ── 3D Point Cloud ─────────────────────────────────────────────────────────────

# XYZ only — random sphere surface
M = 4096
phi   = rng.uniform(0, np.pi, M)
theta = rng.uniform(0, 2 * np.pi, M)
cloud_xyz = np.column_stack([
    np.sin(phi) * np.cos(theta),
    np.sin(phi) * np.sin(theta),
    np.cos(phi),
]).astype(np.float32)   # (4096, 3)

# XYZ + RGB — colour by elevation (Z)
z_norm = (cloud_xyz[:, 2] + 1.0) / 2.0          # normalise to [0, 1]
cloud_xyzrgb = np.column_stack([
    cloud_xyz,
    z_norm,               # R
    1.0 - z_norm,         # G
    np.full(M, 0.5),      # B
]).astype(np.float32)   # (4096, 6)

# ── Intentionally small arrays for edge-case testing ──────────────────────────
tiny_img  = np.zeros((4, 4, 3), dtype=np.uint8)    # 4×4 BGR — minimal image
tiny_1d   = np.array([1.0, 2.0, 3.0], dtype=np.float32)
tiny_cloud = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32)

# ── BREAKPOINT — open "CV DebugMate" panel and click any variable above ────────
breakpoint()   # <-- set debugger stop here

print("Done.")
