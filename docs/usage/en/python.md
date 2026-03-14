# Python Usage Guide — Matrix Viewer Debug

[English](python.md) | [中文](../../zh/python.md)

> **Back to main README**: [README.md](../../../README.md)

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Starting a Debug Session](#starting-a-debug-session)
- [Opening the Variables Panel](#opening-the-variables-panel)
- [Visualizing a Variable](#visualizing-a-variable)
- [Viewer Controls](#viewer-controls)
  - [Image Viewer](#image-viewer)
  - [Plot Viewer](#plot-viewer)
  - [Point Cloud Viewer](#point-cloud-viewer)
- [View Sync](#view-sync)
- [Supported Python Types](#supported-python-types)
- [Quick-Start Example](#quick-start-example)

---

## Requirements

| Requirement | Details |
|-------------|---------|
| VS Code | 1.93.0+ |
| Python extension | [`ms-python.python`](https://marketplace.visualstudio.com/items?itemName=ms-python.python) |
| Python | 3.8+ |
| debugpy | Installed automatically with the Python extension |
| Optional packages | `numpy`, `Pillow`, `torch`, `open3d` — depending on which types you visualize |

---

## Installation

### From VSIX

1. Download the `.vsix` file.
2. Open Extensions view (`Ctrl+Shift+X`) → `...` → **Install from VSIX…**

### From Source

```bash
git clone https://github.com/dull-bird/cv_debug_mate_python
cd cv_debug_mate_python
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

---

## Starting a Debug Session

1. Open a Python file (or Jupyter notebook) in VS Code.
2. Set one or more breakpoints.
3. Press **F5** (or use **Run → Start Debugging**).
4. The debugger pauses at the first breakpoint.

> Supported session types: `python`, `debugpy`, `jupyter`.

<!-- TODO: screenshot — Starting a Python debug session (breakpoint hit) -->

---

## Opening the Variables Panel

1. In the **Run and Debug** sidebar (`Ctrl+Shift+D`), scroll down until you see the **MatrixViewer Debug** section.
2. The panel lists all variables in the current scope that can be visualized.
3. The list refreshes automatically whenever the debugger steps to a new line.

<!-- TODO: screenshot — MatrixViewer Debug Variables panel showing detected variables -->

---

## Visualizing a Variable

There are three ways to open a viewer for a variable:

### Option 1 — MatrixViewer Debug panel (Recommended)

Click any variable name in the **MatrixViewer Debug** panel.  
A webview opens with the appropriate viewer (Image / Plot / Point Cloud).

### Option 2 — Context Menu

Right-click a variable in the native **Variables** pane → **View by MatrixViewer**.

<!-- TODO: screenshot — Right-click context menu on a variable -->

### Option 3 — Command Palette

`Ctrl+Shift+P` → **MatrixViewer: View by MatrixViewer** → type the variable name.

---

## Viewer Controls

### Image Viewer

Renders `PIL.Image`, `numpy` 2D/3D arrays, `torch.Tensor` image tensors, and `cv2` matrices as a zoomable canvas.

| Action | Control |
|--------|---------|
| Zoom in / out | Scroll wheel |
| Pan | Click and drag |
| Reset view | Click **Reset** button |
| Apply colormap | Colormap dropdown (gray, jet, viridis, hot, plasma) |
| Toggle normalize | **Normalize** checkbox — maps min→0, max→255 |
| Hover pixel info | Move cursor over the image to see `[row, col] = value` |
| Export | Click **Save PNG** |

<!-- TODO: screenshot — Image Viewer with colormap applied and pixel info tooltip -->

### Plot Viewer

Renders 1D line charts, 2D scatter charts, and histograms using uPlot.

| Action | Control |
|--------|---------|
| Zoom | Rectangle-select a region, or use the scroll wheel |
| Pan | Click and drag |
| Reset zoom | Double-click |
| Switch mode | **Line / Scatter / Histogram** buttons |
| Custom X-axis | Enter a variable name in the **X Variable** field and press Enter |
| View stats | Min, Max, Mean, Std displayed below the chart |
| Export PNG | Click **Save PNG** |
| Export CSV | Click **Save CSV** |

<!-- TODO: screenshot — Plot Viewer showing a 1D numpy array as a line chart -->

<!-- TODO: screenshot — Plot Viewer showing an Nx2 array as a 2D scatter chart -->

### Point Cloud Viewer

Renders 3D point clouds using Three.js + OrbitControls.

| Action | Control |
|--------|---------|
| Rotate | Click and drag |
| Zoom | Scroll wheel |
| Pan | Right-click and drag |
| Reset camera | Click **Reset** button |
| Color by axis | Select **X / Y / Z** in the color dropdown |
| Adjust point size | Use the **Point Size** slider |
| Export PLY | Click **Save PLY** |

<!-- TODO: screenshot — Point Cloud Viewer with color-by-Z enabled -->

---

## View Sync

Two open viewer panels can be paired so their viewport (zoom / pan / rotation) stays in sync.

1. Open two viewer panels for two different variables.
2. In either panel, click **Sync** and select the other panel from the dropdown.
3. Moving the viewport in one panel mirrors the movement in the other.
4. Click **Unsync** to break the pair.

<!-- TODO: screenshot — Two Image Viewers side-by-side with View Sync enabled -->

---

## Supported Python Types

### Image Viewer

| Type | Notes |
|------|-------|
| `PIL.Image.Image` | Any mode (RGB, RGBA, L, P, …) |
| `numpy.ndarray` | shape `(H, W)` — grayscale; `(H, W, 3)` — RGB; `(H, W, 4)` — RGBA |
| `torch.Tensor` | shape `(H, W)`, `(C, H, W)`, or `(1, C, H, W)` |
| `cv2.UMat` | OpenCV UMat (downloaded to CPU automatically) |
| `cv2.cuda.GpuMat` | OpenCV CUDA matrix (downloaded to CPU automatically) |

### Plot Viewer

| Type | Notes |
|------|-------|
| `numpy.ndarray` shape `(N,)` | 1D line chart |
| `numpy.ndarray` shape `(N, 2)` | 2D scatter — column 0 = X, column 1 = Y |
| `list` / `tuple` of numbers | 1D line chart |
| `list` / `tuple` of 2-element sequences | 2D scatter |
| `torch.Tensor` (1D) | 1D line chart |

### Point Cloud Viewer

| Type | Notes |
|------|-------|
| `numpy.ndarray` shape `(N, 3)` | XYZ columns |
| `numpy.ndarray` shape `(N, 6)` | XYZ + RGB columns |
| `open3d.geometry.PointCloud` | Points and optional per-point colors |
| `list` / `tuple` of 3-element sequences | Each element treated as `(x, y, z)` |

---

## Quick-Start Example

A ready-to-run demo covering all supported types lives in [`test/test_python/`](../../../test/test_python/).

```bash
cd test/test_python
pip install -r requirements.txt
# Open in VS Code — set a breakpoint in demo.py, then press F5
code .
```

<!-- TODO: screenshot — demo.py breakpoint hit with MatrixViewer Debug panel open -->
