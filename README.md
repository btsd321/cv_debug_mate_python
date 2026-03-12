# CV DebugMate Python

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdull-bird%2Fcv_debug_mate_python%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/dull-bird/cv_debug_mate_python)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![debugpy](https://img.shields.io/badge/debugpy-supported-green)](https://github.com/microsoft/debugpy)

[English](README.md) | [中文](README_CN.md)

A Visual Studio Code extension for visualizing 1/2/3D data structures during Python debugging.

**Inspired by [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) and [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.**

---

## 🚀 Try It Now!

> **📂 Example Project: [`test_python/`](test_python/)**
>
> Complete demo with ALL supported types!
> Run with the debugger to see CV DebugMate in action.
>
> ```bash
> cd test_python
> pip install -r requirements.txt
> # Open in VS Code, set a breakpoint, press F5
> code .
> ```

---

## ⚡ Supported Types (Quick Reference)

| Category | Type | Visualization |
| -------------------- | --------------------------------------- | --------------- |
| **Image (2D)** | `numpy.ndarray` shape `(H, W)` | 🖼️ Image Viewer |
| | `numpy.ndarray` shape `(H, W, 1/3/4)` | 🖼️ Image Viewer |
| | `PIL.Image.Image` | 🖼️ Image Viewer |
| | `torch.Tensor` shape `(H, W)` / `(C, H, W)` / `(1, C, H, W)` | 🖼️ Image Viewer |
| | `tensorflow.Tensor` shape `(H, W, C)` | 🖼️ Image Viewer |
| **Point Cloud (3D)** | `numpy.ndarray` shape `(N, 3)` — XYZ | 📊 3D Viewer |
| | `numpy.ndarray` shape `(N, 6)` — XYZ + RGB | 📊 3D Viewer |
| | `list` of length-3/6 tuples or lists | 📊 3D Viewer |
| **Plot (1D)** | `numpy.ndarray` shape `(N,)` or `(N, 1)` | 📈 Plot Viewer |
| | `torch.Tensor` / `tensorflow.Tensor` (1D) | 📈 Plot Viewer |
| | `list` / `tuple` of numeric values | 📈 Plot Viewer |

> **Supported dtypes**: `uint8`, `uint16`, `int8`, `int16`, `int32`, `int64`, `float16`, `float32`, `float64`, `bool`

---

## 🎯 Features

| Feature | Description |
| --------------------- | ------------------------------------------------------------------------------- |
| **📈 1D Plot** | Line/Scatter/Histogram, custom X-axis, zoom, pan, export PNG/CSV |
| **🖼️ 2D Image** | Multi-channel, auto-normalize, colormap, zoom up to 100×, pixel values on hover |
| **📊 3D Point Cloud** | Three.js powered, color by X/Y/Z, adjustable point size, export PLY |
| **🔗 View Sync** | Pair variables for synchronized zoom/pan/rotation across viewers |
| **🔍 Auto Detection** | Variables panel auto-detects all visualizable types in current scope |
| **🔄 Auto Refresh** | Webview auto-updates when stepping through code |

---

## 🔧 Debugger Support

| Debugger | Session Type | 1D Data | Image | Point Cloud | Notes |
| --------- | ------------ | ------- | ----- | ----------- | ----- |
| debugpy | `python` | ✅ | ✅ | ✅ | VS Code Python extension |
| debugpy | `debugpy` | ✅ | ✅ | ✅ | Direct debugpy launch |

> Requires the [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`) or a compatible debugpy launch config.

---

## 📖 Usage

### Option 1: CV DebugMate Panel (Recommended)

1. Start a Python debug session
2. Open **"Run and Debug"** sidebar
3. Find **CV DebugMate** section
4. Click a variable name to visualize it

### Option 2: Context Menu

Right-click a variable in the **Variables** pane → **"View by CV DebugMate"**

### Option 3: Command Palette

Open the Command Palette (`Ctrl+Shift+P`) → search for **"CV DebugMate: Visualize Variable"**

---

## 📷 Screenshots

### 1D Plot

<!-- TODO: add screenshot -->

### 2D Image

<!-- TODO: add screenshot -->

### 3D Point Cloud

<!-- TODO: add screenshot -->

### Variables Panel

<!-- TODO: add screenshot -->

---

## 🎮 Controls

### Image Viewer

| Action | Control |
| ------ | --------------- |
| Zoom | Scroll wheel |
| Pan | Drag |
| Reset | Click "Reset" |
| Colormap | Dropdown selector |
| Export | Save PNG |

### 3D Point Cloud Viewer

| Action | Control |
| ------ | -------------------- |
| Rotate | Drag |
| Zoom | Scroll wheel |
| Color | Switch by X/Y/Z axis |
| Export | Save PLY |

### Plot Viewer

| Action | Control |
| ------ | -------------------------- |
| Zoom | Rectangle select or scroll |
| Pan | Drag |
| Mode | Line / Scatter / Histogram |
| Export | Save PNG / CSV |

---

## 📦 Installation

### From VSIX

1. Download `.vsix` file
2. Extensions view (`Ctrl+Shift+X`) → `...` → "Install from VSIX..."

### From Source

```bash
git clone https://github.com/dull-bird/cv_debug_mate_python
cd cv_debug_mate_python
npm install
npm run compile
# Press F5 to run in Extension Development Host
```

---

## 📋 Requirements

- VS Code 1.93.0+
- Python 3.8+
- [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`)
- debugpy (installed automatically with the Python extension)
- Optional: `numpy`, `Pillow`, `torch`, `tensorflow` — depending on the types you want to visualize

---

## 🙏 Acknowledgments

Inspired by [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) and [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.

---

## 📄 License

MIT

---

## 🤝 Contributing

Issues and PRs welcome!

