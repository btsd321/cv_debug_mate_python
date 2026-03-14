# Matrix Viewer Debug

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdull-bird%2Fcv_debug_mate_python%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/dull-bird/cv_debug_mate_python)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![debugpy](https://img.shields.io/badge/debugpy-supported-green)](https://github.com/microsoft/debugpy)

[English](README.md) | [中文](README_CN.md)

A Visual Studio Code extension for visualizing 1D/2D/3D data structures during debugging. Supports **Python** (debugpy) and **C++** (cppdbg / lldb).

**Inspired by [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) and [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.**

---

## 🚀 Try It Now!

> **📂 Example Project: [`test/test_python/`](test/test_python/)**
>
> Complete demo with ALL supported types!
> Run with the debugger to see MatrixViewer Debug in action.
>
> ```bash
> cd test/test_python
> pip install -r requirements.txt
> # Open in VS Code, set a breakpoint, press F5
> code .
> ```

---

## ⚡ Supported Types (Quick Reference)

| Category | Type | Visualization |
| -------------------- | --------------------------------------- | --------------- |
| **Image (2D)** | `PIL.Image.Image` | 🖼️ Image Viewer |
| | `torch.Tensor` shape `(H, W)` / `(C, H, W)` / `(1, C, H, W)` | 🖼️ Image Viewer |
| | `cv2.UMat` / `cv2.cuda.GpuMat` | 🖼️ Image Viewer |
| | `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>` rows>1, cols>2 | 🖼️ Image Viewer |
| **Point Cloud (3D)** | `numpy.ndarray` shape `(N, 3)` — XYZ | 📊 3D Viewer |
| | `numpy.ndarray` shape `(N, 6)` — XYZ + RGB | 📊 3D Viewer |
| | `open3d.geometry.PointCloud` | 📊 3D Viewer |
| | `list` / `tuple` of 3-element seqs | 📊 3D Viewer |
| **Plot (1D/2D)** | `numpy.ndarray` shape `(N,)` | 📈 1D Chart |
| | `numpy.ndarray` shape `(N, 2)` | 📈 2D Scatter |
| | `list` / `tuple` of numeric values | 📈 1D Chart |
| | `list` / `tuple` of 2-element seqs | 📈 2D Scatter |
| | `torch.Tensor` (1D) | 📈 1D Chart |
| | `Eigen::VectorX*` / `Eigen::RowVectorX*` | 📈 1D Chart |
| | `Eigen::Matrix<T,N,1>` / `Eigen::Matrix<T,1,N>` | 📈 1D Chart |
| | `Eigen::Matrix<T,N,2>` (N×2) | 📈 2D Scatter (col0=X, col1=Y) |

> **Eigen routing rules**: query runtime `.rows()` / `.cols()` to decide viewer type:
> - `cols == 1` or `rows == 1` → **1D line plot**
> - `cols == 2` → **2D scatter** (column-major storage: X = col 0, Y = col 1)
> - `rows > 1` and `cols > 2` → **image** (grayscale, auto-normalised)

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

| Debugger | Session Type | 1D Data | Image | Point Cloud | Status |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| debugpy | `python` / `debugpy` | ✅ | ✅ | ✅ | **Supported** |
| Jupyter | `jupyter` | ✅ | ✅ | ✅ | **Supported** |
| cppdbg / lldb | `cppdbg` / `lldb` | ✅ | ✅ | ✅ | **Supported** |

> Python support requires the [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`) or a compatible debugpy launch config.

---

## 📖 Usage

### Quick Start

1. Start a debug session (Python or C++)
2. Open the **Run and Debug** sidebar (`Ctrl+Shift+D`) → find **MatrixViewer Debug**
3. Click a variable name to open the viewer

Alternatively: right-click any variable in the **Variables** pane → **View by MatrixViewer**,  
or use the Command Palette (`Ctrl+Shift+P`) → **MatrixViewer: View by MatrixViewer**.

### Detailed Usage Guides

| Language | English | 中文 |
|----------|---------|------|
| **Python** | [Python Usage Guide](docs/usage/en/python.md) | [Python 使用指南](docs/usage/zh/python.md) |
| **C++** | [C++ Usage Guide](docs/usage/en/cpp.md) | [C++ 使用指南](docs/usage/zh/cpp.md) |

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
- **Python debugging**: Python 3.8+, [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`), debugpy (installed automatically with the Python extension)
- **C++ debugging**: [C/C++ extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) or [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
- Optional Python packages: `numpy`, `Pillow`, `torch` — depending on the types you want to visualize

---

## 🏗️ Architecture Overview

The extension uses a two-level provider hierarchy so that adding a new library or a new language never requires touching existing code:

```
IDebugAdapter          ← one implementation per language (Python, C++, …)
  └─ *Provider (coordinator)   ← one coordinator per viewer type (image / plot / pointCloud)
       └─ ILib*Provider (libs/)  ← one file per third-party library
            numpy/imageProvider.ts
            pil/imageProvider.ts
            torch/imageProvider.ts
            … open3d/pointCloudProvider.ts (future)
```

| What to add | Where to add it |
|---|---|
| New **library** (e.g. open3d) | `src/adapters/<lang>/libs/<libName>/` |
| New **language** (e.g. Rust) | `src/adapters/<lang>/` + register in `adapterRegistry.ts` |

---

## 🙏 Acknowledgments

Inspired by [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) and [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) for Visual Studio.

---

## 📄 License

MIT

---

## 🤝 Contributing

Issues and PRs welcome!

