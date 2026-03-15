# Matrix Viewer Debug

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fbtsd321%2Fmatrix_viewer_debug%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/btsd321/matrix_viewer_debug)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![debugpy](https://img.shields.io/badge/debugpy-supported-green)](https://github.com/microsoft/debugpy)

[English](README.md) | 中文

一个在调试过程中可视化 1/2/3D 数据结构的 VS Code 扩展。支持 **Python**（debugpy）和 **C++**（GDB / vsdbg / CodeLLDB）。

**灵感来源于 [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) 以及 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 🚀 快速开始！

> **📂 示例项目：[`test/test_python/`](test/test_python/)**
>
> 包含所有支持类型的完整演示。
> 打开调试器即可体验 MatrixViewer Debug 的效果。
>
> ```bash
> cd test/test_python
> pip install -r requirements.txt
> # 在 VS Code 中打开，设置断点，按 F5
> code .
> ```

---

## ⚡ 支持类型速查

### Python

| 类别 | 类型 | 可视化方式 |
| -------------------- | --------------------------------------- | --------------- |
| **图像（2D）** | `PIL.Image.Image` | 🖼️ 图像查看器 |
| | `numpy.ndarray` shape `(H, W)` / `(H, W, 3)` / `(H, W, 4)` | 🖼️ 图像查看器 |
| | `cv2.UMat` | 🖼️ 图像查看器 |
| **点云（3D）** | `numpy.ndarray` shape `(N, 3)` — XYZ | 📊 3D 查看器 |
| | `numpy.ndarray` shape `(N, 6)` — XYZ + RGB | 📊 3D 查看器 |
| | `open3d.geometry.PointCloud` | 📊 3D 查看器 |
| | 元素为 3 元素的 `list` / `tuple` | 📊 3D 查看器 |
| **曲线（1D/2D）** | `numpy.ndarray` shape `(N,)` | 📈 1D 折线图 |
| | `numpy.ndarray` shape `(N, 2)` | 📈 2D 散点图 |
| | 元素为数值的 `list` / `tuple` | 📈 1D 折线图 |
| | 元素为 2 元素序列的 `list` / `tuple` | 📈 2D 散点图 |

### C++

| 类别 | 类型 | 可视化方式 |
| -------------------- | --------------------------------------- | --------------- |
| **图像（2D）** | `cv::Mat`（OpenCV）| 🖼️ 图像查看器 |
| | `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>`（rows>1, cols>2）| 🖼️ 图像查看器 |
| | `QImage`（Qt5 / Qt6）| 🖼️ 图像查看器 |
| **点云（3D）** | `pcl::PointCloud<PointXYZ>` / `<PointXYZRGB>` / `<PointXYZI>` | 📊 3D 查看器 |
| | `std::vector<cv::Point3f>` / `std::vector<cv::Point3d>` | 📊 3D 查看器 |
| | `std::array<cv::Point3f, N>` / `std::array<cv::Point3d, N>` | 📊 3D 查看器 |
| | `QVector<QVector3D>`（Qt5 / Qt6）| 📊 3D 查看器 |
| **曲线（1D/2D）** | `Eigen::VectorX*` / `Eigen::RowVectorX*` | 📈 1D 折线图 |
| | `Eigen::Matrix<T,N,1>` / `Eigen::Matrix<T,1,N>` | 📈 1D 折线图 |
| | `Eigen::Matrix<T,N,2>`（N×2 矩阵）| 📈 2D 散点图（列0=X，列1=Y）|
| | `std::vector<T>` / `std::array<T, N>` / `T[N]`（数值类型）| 📈 1D 折线图 |
| | `QVector<T>` / `QList<T>`（数值类型，Qt5 / Qt6）| 📈 1D 折线图 |
| | `QPolygonF`（Qt5 / Qt6）| 📈 2D 散点图 |
| | `QVector<QVector2D>` / `QList<QVector2D>`（Qt5 / Qt6）| 📈 2D 散点图 |

> **Eigen 路由规则**（C++）：运行时查询 `.rows()` / `.cols()` 决定可视化类型：
> - `cols == 1` 或 `rows == 1` → **1D 折线图**
> - `cols == 2` → **2D 散点图**（列优先存储：X = 第 0 列，Y = 第 1 列）
> - `rows > 1` 且 `cols > 2` → **图像**（单通道灰度，自动开启归一化）

---

## 🎯 功能特性

| 功能 | 说明 |
| --------------------- | ------------------------------------------------------------------------------- |
| **📈 1D 曲线图** | 折线图 / 散点图 / 直方图，自定义 X 轴，缩放平移，导出 PNG/CSV |
| **🖼️ 2D 图像** | 多通道，自动归一化，伪彩色映射，最高 100× 缩放，悬停显示像素值 |
| **📊 3D 点云** | Three.js 渲染，按 X/Y/Z 轴着色，可调点大小，导出 PLY |
| **🔗 视图同步** | 配对两个变量，实现缩放 / 平移 / 旋转联动 |
| **🔍 自动检测** | 变量面板自动检测当前作用域内所有可视化变量 |
| **🔄 自动刷新** | 单步调试时所有 Webview 自动更新 |

---

## 🔧 调试器支持

### Python

| 调试器 | Session 类型 | 1D 数据 | 图像 | 点云 | 状态 |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| debugpy | `python` / `debugpy` | ✅ | ✅ | ✅ | **已支持** |

> 需要安装 [Python 扩展](https://marketplace.visualstudio.com/items?itemName=ms-python.python)（`ms-python.python`）或兼容 debugpy 的启动配置。

### C++

| 调试器 | Session 类型 | 1D 数据 | 图像 | 点云 | 状态 |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| GDB | `cppdbg` | ✅ | ✅ | ✅ | **已支持** |
| vsdbg | `cppvsdbg` | ✅ | ✅ | ✅ | **已支持** |
| CodeLLDB | `lldb` | ✅ | ✅ | ✅ | **已支持** |

> **vsdbg（cppvsdbg）**：需要 Visual Studio 2019+。使用 [`build_msvc.bat`](test/test_cpp/scripts/bat/build_msvc.bat) 构建。如需最佳类型检测覆盖率（尤其是 `cv::Mat`），推荐使用 LLVM + CodeLLDB。

---

## 📖 使用方法

### 快速开始

1. 启动调试会话（Python 或 C++）
2. 打开**运行和调试**侧边栏（`Ctrl+Shift+D`），找到 **MatrixViewer Debug** 区域
3. 点击变量名即可打开查看器

也可以：在原生**变量**面板中右键点击变量 → **View by MatrixViewer**，  
或使用命令面板（`Ctrl+Shift+P`）→ **MatrixViewer: View by MatrixViewer**。

### 详细使用文档

| 语言 | English | 中文 |
|------|---------|------|
| **Python** | [Python Usage Guide](docs/usage/en/python.md) | [Python 使用指南](docs/usage/zh/python.md) |
| **C++** | [C++ Usage Guide](docs/usage/en/cpp.md) | [C++ 使用指南](docs/usage/zh/cpp.md) |

---

## 📦 安装

### 通过 VSIX 安装

1. 下载 `.vsix` 文件
2. 扩展视图（`Ctrl+Shift+X`）→ `...` → "从 VSIX 安装..."

---

## 📋 系统要求

- VS Code 1.93.0+
- **Python 调试**：Python 3.8+、[Python 扩展](https://marketplace.visualstudio.com/items?itemName=ms-python.python)（`ms-python.python`）、debugpy（随 Python 扩展自动安装）
- **C++ 调试**：[C/C++ 扩展](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) 或 [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
- 可选 Python 包：`numpy`、`Pillow`——根据需要可视化的类型按需安装

---

## 🏗️ 架构说明

扩展采用三层 Provider 层级结构，新增库或语言无需修改已有代码：

```
IDebugAdapter                    ← 每种语言一个实现（Python、C++、…）
  └─ 调试器专属层                   ← C++：gdb/ | codelldb/ | cppvsdbg/
       └─ *Provider（分发器）         ← 每种显示类型一个（image / plot / pointCloud）
            └─ ILib*Provider（libs/）  ← 每个三方库一个文件
                 opencv/imageProvider.ts
                 eigen/plotProvider.ts
                 pcl/pointCloudProvider.ts …
```

**调试器专属层**确保 GDB、CodeLLDB、vsdbg 的表达式完全隔离——库 Provider 内部不再有 `if (isLLDB)` 等运行时分支。

| 添加内容 | 在哪里添加 |
|---|---|
| 新 **Python 库**（如 open3d）| `src/adapters/python/debugpy/libs/<libName>/` |
| 新 **C++ 库**（如新的 OpenCV 封装）| `src/adapters/cpp/{gdb,codelldb,cppvsdbg}/libs/<libName>/` |
| 新**语言**（如 Rust）| `src/adapters/<lang>/` + 在 `adapterRegistry.ts` 中注册 |

---

## 🙏 致谢

灵感来源于 [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) 以及 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。

---

## 📄 许可证

MIT

---

## 🤝 贡献

欢迎提交 Issue 和 PR！
