# Matrix Viewer Debug

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbtsd321%2Fmatrix_viewer_debug%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/btsd321/matrix_viewer_debug)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![debugpy](https://img.shields.io/badge/debugpy-supported-green)](https://github.com/microsoft/debugpy)

[English](README.md) | [中文](README_CN.md)

A Visual Studio Code extension for visualizing 1D/2D/3D data structures during debugging. Supports **Python** (debugpy) and **C++** (GDB / vsdbg / CodeLLDB).

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

### Python

| Category | Type | Visualization |
| -------------------- | --------------------------------------- | --------------- |
| **Image (2D)** | `PIL.Image.Image` | 🖼️ Image Viewer |
| | `numpy.ndarray` shape `(H, W)` / `(H, W, 3)` / `(H, W, 4)` | 🖼️ Image Viewer |
| | `cv2.UMat` | 🖼️ Image Viewer |
| **Point Cloud (3D)** | `numpy.ndarray` shape `(N, 3)` — XYZ | 📊 3D Viewer |
| | `numpy.ndarray` shape `(N, 6)` — XYZ + RGB | 📊 3D Viewer |
| | `open3d.geometry.PointCloud` | 📊 3D Viewer |
| | `list` / `tuple` of 3-element seqs | 📊 3D Viewer |
| **Plot (1D/2D)** | `numpy.ndarray` shape `(N,)` | 📈 1D Chart |
| | `numpy.ndarray` shape `(N, 2)` | 📈 2D Scatter |
| | `list` / `tuple` of numeric values | 📈 1D Chart |
| | `list` / `tuple` of 2-element seqs | 📈 2D Scatter |

### C++

| Category | Type | Visualization |
| -------------------- | --------------------------------------- | --------------- |
| **Image (2D)** | `cv::Mat` (OpenCV) | 🖼️ Image Viewer |
| | `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>` (rows>1, cols>2) | 🖼️ Image Viewer |
| | `QImage` (Qt5 / Qt6) | 🖼️ Image Viewer |
| | `shared_ptr<T>` / `unique_ptr<T>` / `weak_ptr<T>` / `T*` where `T` is any image type above | 🖼️ Image Viewer |
| **Point Cloud (3D)** | `pcl::PointCloud<PointXYZ>` / `<PointXYZRGB>` / `<PointXYZI>` | 📊 3D Viewer |
| | `std::vector<cv::Point3f>` / `std::vector<cv::Point3d>` | 📊 3D Viewer |
| | `std::array<cv::Point3f, N>` / `std::array<cv::Point3d, N>` | 📊 3D Viewer |
| | `QVector<QVector3D>` (Qt5 / Qt6) | 📊 3D Viewer |
| | `shared_ptr<T>` / `unique_ptr<T>` / `weak_ptr<T>` / `T*` where `T` is any point cloud type above | 📊 3D Viewer |
| **Plot (1D/2D)** | `Eigen::VectorX*` / `Eigen::RowVectorX*` | 📈 1D Chart |
| | `Eigen::Matrix<T,N,1>` / `Eigen::Matrix<T,1,N>` | 📈 1D Chart |
| | `Eigen::Matrix<T,N,2>` (N×2) | 📈 2D Scatter (col0=X, col1=Y) |
| | `std::vector<T>` / `std::array<T, N>` / `T[N]` (numeric) | 📈 1D Chart |
| | `QVector<T>` / `QList<T>` (numeric scalar, Qt5 / Qt6) | 📈 1D Chart |
| | `QPolygonF` (Qt5 / Qt6) | 📈 2D Scatter |
| | `QVector<QVector2D>` / `QList<QVector2D>` (Qt5 / Qt6) | 📈 2D Scatter |
| | `shared_ptr<T>` / `unique_ptr<T>` / `weak_ptr<T>` / `T*` where `T` is any plot type above | 📈 1D/2D Chart |

> **Eigen routing rules** (C++): query runtime `.rows()` / `.cols()` to decide viewer type:
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
| **🖱️ Editor Context Menu** | Right-click a variable name in the code editor to visualize it directly (shown only when the variable is visualizable in the current debug scope) |

---

## 🔧 Debugger Support

### Python

| Debugger | Session Type | 1D Data | Image | Point Cloud | Status |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| debugpy | `python` / `debugpy` | ✅ | ✅ | ✅ | **Supported** |

> Requires the [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`) or a compatible debugpy launch config.

### C++

| Debugger | Session Type | 1D Data | Image | Point Cloud | Status |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| GDB | `cppdbg` | ✅ | ✅ | ✅ | **Supported** |
| vsdbg | `cppvsdbg` | ✅ | ✅ | ✅ | **Supported** |
| CodeLLDB | `lldb` | ✅ | ✅ | ✅ | **Supported** |

> **vsdbg (cppvsdbg)**: Requires Visual Studio 2019+. Build with [`build_msvc.bat`](test/test_cpp/scripts/bat/build_msvc.bat). For the best variable detection coverage (especially `cv::Mat`), LLVM + CodeLLDB is recommended.

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

---

## 📋 Requirements

- VS Code 1.93.0+
- **Python debugging**: Python 3.8+, [Python extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python) (`ms-python.python`), debugpy (installed automatically with the Python extension)
- **C++ debugging**: [C/C++ extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) or [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
- Optional Python packages: `numpy`, `Pillow` — depending on the types you want to visualize

---

## 🏗️ Architecture Overview

The extension uses a three-level provider hierarchy so that adding a new library or a new language never requires touching existing code:

```
IDebugAdapter                    ← one implementation per language (Python, C++, …)
  └─ per-debugger layer          ← C++: gdb/ | codelldb/ | cppvsdbg/
       └─ *Provider (coordinator)  ← one coordinator per viewer type (image / plot / pointCloud)
            └─ ILib*Provider (libs/)  ← one file per third-party library
                 opencv/imageProvider.ts
                 eigen/plotProvider.ts
                 pcl/pointCloudProvider.ts …
```

The **per-debugger layer** ensures that GDB, CodeLLDB, and vsdbg expressions are completely isolated — no runtime `if (isLLDB)` branching inside library providers.

| What to add | Where to add it |
|---|---|
| New **library for Python** (e.g. open3d) | `src/adapters/python/debugpy/libs/<libName>/` |
| New **library for C++** (e.g. a new OpenCV wrapper) | `src/adapters/cpp/{gdb,codelldb,cppvsdbg}/libs/<libName>/` |
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

