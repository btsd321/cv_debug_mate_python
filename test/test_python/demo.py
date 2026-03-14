"""
Matrix Viewer Debug — Python Demo Script
==========================================
Run with F5 (launch config: "CV DebugMate: Run demo.py") to interactively test
every supported variable type.

Set a breakpoint on the ``breakpoint()`` call.  In the "Matrix Viewer" panel in
the Debug sidebar, click any variable below to open its viewer.

Visualisation rules (as of current implementation):
  numpy.ndarray
    shape (N,)      → 1D line/scatter chart
    shape (N, 2)    → 2D scatter chart  (col-0 = X, col-1 = Y)
    shape (N, 3/6)  → 3D point cloud   (XYZ or XYZ+RGB)
    any other shape → ⚠ unsupported data structure

  cv2 explicit types (UMat, cuda.GpuMat) → 2D image viewer
  PIL.Image                               → 2D image viewer

  list / tuple of scalars               → 1D chart
  list / tuple of 2-element sequences   → 2D scatter chart
  list / tuple of 3-element sequences   → 3D point cloud

  open3d.geometry.PointCloud            → 3D point cloud

  cv2.UMat                              → 2D image viewer (BGR; frontend Swap R/B toggle)
  cv2.imread() result (numpy.ndarray)   → not an image viewer; shown as numpy array
"""

import os
import numpy as np
import cv2
from PIL import Image
import open3d as o3d

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEST_IMG_PATH = os.path.join(SCRIPT_DIR, "..", "..", "assets", "test_img.png")

rng = np.random.default_rng(42)

# =============================================================================
# 1-D numpy array  →  1D line/scatter chart
# =============================================================================
N = 512
t = np.linspace(0, 4 * np.pi, N)
signal_1d = (np.sin(t) + 0.5 * np.sin(3 * t)).astype(np.float32)   # clean sine
noise_1d  = rng.standard_normal(N).astype(np.float32)               # white noise
ramp_1d   = np.arange(N, dtype=np.float64)                          # linear ramp

# =============================================================================
# (N, 2) numpy array  →  2D scatter chart  (X col + Y col)
# =============================================================================
angle = np.linspace(0, 2 * np.pi, 300)
scatter_circle = np.column_stack([np.cos(angle), np.sin(angle)]).astype(np.float32)   # (300, 2)

scatter_line = np.column_stack([
    np.linspace(0, 10, 200),
    np.linspace(0, 10, 200) + rng.standard_normal(200) * 0.5,
]).astype(np.float32)   # (200, 2)

# =============================================================================
# (N, 3) numpy array  →  3D point cloud (XYZ)
# =============================================================================
M = 2048
phi   = rng.uniform(0, np.pi, M)
theta = rng.uniform(0, 2 * np.pi, M)
cloud_xyz = np.column_stack([
    np.sin(phi) * np.cos(theta),
    np.sin(phi) * np.sin(theta),
    np.cos(phi),
]).astype(np.float32)   # (2048, 3)

# =============================================================================
# (N, 6) numpy array  →  3D point cloud (XYZ + RGB)
# =============================================================================
z_norm = (cloud_xyz[:, 2] + 1.0) / 2.0   # normalise Z to [0, 1]
cloud_xyzrgb = np.column_stack([
    cloud_xyz,
    z_norm,               # R
    1.0 - z_norm,         # G
    np.full(M, 0.5),      # B
]).astype(np.float32)   # (2048, 6)

# =============================================================================
# PIL.Image  →  2D image viewer
# =============================================================================
_pil_src  = Image.open(TEST_IMG_PATH)
pil_image = _pil_src.copy()       # RGBA (2048 × 2048)
pil_gray  = _pil_src.convert("L") # grayscale (2048 × 2048)

# =============================================================================
# Python built-in list/tuple  →  1D chart or 2D scatter
# =============================================================================
# 1D: list of floats
my_list_1d  = [float(v) for v in signal_1d[:64]]          # 64 numbers → 1D chart
my_tuple_1d = tuple(range(32))                             # 32 integers → 1D chart

# 2D: list of 2-tuples  →  2D scatter chart
my_list_2d = [(float(np.cos(a)), float(np.sin(a)))
              for a in np.linspace(0, 2 * np.pi, 60)]     # 60 × (x, y)

# 3D: list of 3-tuples  →  3D point cloud
my_list_3d = [(float(x), float(y), float(z))
              for x, y, z in cloud_xyz[:50]]               # 50 × (x, y, z)

# =============================================================================
# cv2.UMat  →  2D image viewer (BGR; use frontend "Swap R/B" toggle for RGB)
# =============================================================================
_cv2_bgr  = cv2.imread(TEST_IMG_PATH)                              # numpy.ndarray (H, W, 3) BGR
cv2_umat  = cv2.UMat(_cv2_bgr)                                     # cv2.UMat  → image viewer
cv2_gray  = cv2.UMat(cv2.cvtColor(_cv2_bgr, cv2.COLOR_BGR2GRAY))  # cv2.UMat grayscale

# =============================================================================
# open3d.geometry.PointCloud  →  3D point cloud viewer
# =============================================================================
pcd_xyz = o3d.geometry.PointCloud()
pcd_xyz.points = o3d.utility.Vector3dVector(cloud_xyz.astype(np.float64))   # XYZ only

pcd_color = o3d.geometry.PointCloud()
pcd_color.points = o3d.utility.Vector3dVector(cloud_xyz.astype(np.float64))
pcd_color.colors = o3d.utility.Vector3dVector(
    np.column_stack([z_norm, 1.0 - z_norm, np.full(M, 0.5)]).astype(np.float64)
)  # XYZ + RGB

# =============================================================================
# Edge-case / unsupported examples (should trigger warning)
# =============================================================================
# These shapes are not supported and will show "不支持的数据结构":
#   tiny_img = np.zeros((4, 4, 3), dtype=np.uint8)   # (4,4,3) → unsupported for numpy
#   big_mat  = np.eye(10)                             # (10,10) ndim=2 cols=10 → unsupported

tiny_1d    = np.array([1.0, 2.0, 3.0], dtype=np.float32)              # (3,)  → 1D chart
tiny_2d    = np.array([[1, 2], [2, 3], [3, 4]], dtype=np.float32)     # (3,2) → 2D scatter
tiny_cloud = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=np.float32)  # (3,3) → 3D cloud

# ── BREAKPOINT — open the Matrix Viewer panel and click any variable above ─────
breakpoint()   # <-- set debugger stop here

print("Done.")

