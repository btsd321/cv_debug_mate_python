# Matrix Viewer Debug

[![VS Code](https://img.shields.io/badge/VS%20Code-1.93%2B-blue?logo=visualstudiocode)](https://code.visualstudio.com/)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdull-bird%2Fcv_debug_mate_python%2Fmain%2Fpackage.json&query=%24.version&label=version&color=blue)](https://github.com/dull-bird/cv_debug_mate_python)
[![Python](https://img.shields.io/badge/Python-3.8%2B-blue?logo=python)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![debugpy](https://img.shields.io/badge/debugpy-supported-green)](https://github.com/microsoft/debugpy)

[English](README.md) | 中文

一个在调试过程中可视化 1/2/3D 数据结构的 VS Code 扩展。目前支持 **Python**（debugpy）；**C++**（cppdbg / lldb）支持正在开发中。

**灵感来源于 [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) 以及 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。**

---

## 🚀 快速开始！

> **📂 示例项目：[`test/test_python/`](test/test_python/)**
>
> 包含所有支持类型的完整演示。
> 打开调试器即可体验 CV DebugMate 的效果。
>
> ```bash
> cd test/test_python
> pip install -r requirements.txt
> # 在 VS Code 中打开，设置断点，按 F5
> code .
> ```

---

## ⚡ 支持类型速查

| 类别 | 类型 | 可视化方式 |
| -------------------- | --------------------------------------- | --------------- |
| **图像（2D）** | `numpy.ndarray` shape `(H, W)` | 🖼️ 图像查看器 |
| | `numpy.ndarray` shape `(H, W, 1/3/4)` | 🖼️ 图像查看器 |
| | `PIL.Image.Image` | 🖼️ 图像查看器 |
| | `torch.Tensor` shape `(H, W)` / `(C, H, W)` / `(1, C, H, W)` | 🖼️ 图像查看器 |
| **点云（3D）** | `numpy.ndarray` shape `(N, 3)` — XYZ | 📊 3D 查看器 |
| | `numpy.ndarray` shape `(N, 6)` — XYZ + RGB | 📊 3D 查看器 |
| | 元素为长度 3/6 的 `list` 或 `tuple` | 📊 3D 查看器 |
| **曲线（1D）** | `numpy.ndarray` shape `(N,)` 或 `(N, 1)` | 📈 曲线查看器 |
| | `torch.Tensor`（1D）| 📈 曲线查看器 |
| | 元素为数值的 `list` / `tuple` | 📈 曲线查看器 |

> **支持的数据类型**：`uint8`、`uint16`、`int8`、`int16`、`int32`、`int64`、`float16`、`float32`、`float64`、`bool`

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

| 调试器 | Session 类型 | 1D 数据 | 图像 | 点云 | 状态 |
| --------- | ------------ | ------- | ----- | ----------- | ------ |
| debugpy | `python` / `debugpy` | ✅ | ✅ | ✅ | **已支持** |
| Jupyter | `jupyter` | ✅ | ✅ | ✅ | **已支持** |
| cppdbg / lldb | `cppdbg` / `lldb` | 🔧 | 🔧 | 🔧 | **开发中** |

> Python 支持需要安装 [Python 扩展](https://marketplace.visualstudio.com/items?itemName=ms-python.python)（`ms-python.python`）或兼容 debugpy 的启动配置。

---

## 📖 使用方法

### 方式一：CV DebugMate 面板（推荐）

1. 启动 Python 调试会话
2. 打开 **"运行和调试"** 侧边栏
3. 找到 **CV DebugMate** 区域
4. 点击变量名即可可视化

### 方式二：右键菜单

在 **变量** 面板中右键点击变量 → **"View by CV DebugMate"**

### 方式三：命令面板

打开命令面板（`Ctrl+Shift+P`）→ 搜索 **"CV DebugMate: Visualize Variable"**

---

## 📷 截图

### 1D 曲线图

<!-- TODO: 补充截图 -->

### 2D 图像

<!-- TODO: 补充截图 -->

### 3D 点云

<!-- TODO: 补充截图 -->

### 变量面板

<!-- TODO: 补充截图 -->

---

## 🎮 操作说明

### 图像查看器

| 操作 | 方式 |
| ------ | --------------- |
| 缩放 | 滚轮 |
| 平移 | 拖动 |
| 重置 | 点击"Reset" |
| 伪彩色 | 下拉选择器 |
| 导出 | Save PNG |

### 3D 点云查看器

| 操作 | 方式 |
| ------ | -------------------- |
| 旋转 | 拖动 |
| 缩放 | 滚轮 |
| 着色 | 按 X/Y/Z 轴切换 |
| 导出 | Save PLY |

### 曲线查看器

| 操作 | 方式 |
| ------ | -------------------------- |
| 缩放 | 框选或滚轮 |
| 平移 | 拖动 |
| 模式 | 折线图 / 散点图 / 直方图 |
| 导出 | Save PNG / CSV |

---

## 📦 安装

### 通过 VSIX 安装

1. 下载 `.vsix` 文件
2. 扩展视图（`Ctrl+Shift+X`）→ `...` → "从 VSIX 安装..."

### 从源码构建

```bash
git clone https://github.com/dull-bird/cv_debug_mate_python
cd cv_debug_mate_python
npm install
npm run compile
# 按 F5 在扩展开发宿主中运行
```

---

## 📋 系统要求

- VS Code 1.93.0+
- **Python 调试**：Python 3.8+、[Python 扩展](https://marketplace.visualstudio.com/items?itemName=ms-python.python)（`ms-python.python`）、debugpy（随 Python 扩展自动安装）
- **C++ 调试** *（即将支持）*：[C/C++ 扩展](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) 或 [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
- 可选 Python 包：`numpy`、`Pillow`、`torch`——根据需要可视化的类型按需安装

---

## 🏗️ 架构说明

扩展采用两层 Provider 层级结构，新增库或语言品级无需修改已有代码：

```
IDebugAdapter             ← 每种语言一个实现（Python、C++、…）
  └─ *Provider（分发器）      ← 每种显示类型一个（image / plot / pointCloud）
       └─ ILib*Provider（libs/）  ← 每个三方库一个文件
            numpy/imageProvider.ts
            pil/imageProvider.ts
            torch/imageProvider.ts
            … open3d/pointCloudProvider.ts（未来）
```

| 添加内容 | 在哪里添加 |
|---|---|
| 新库（如 open3d） | `src/adapters/<lang>/libs/<libName>/` |
| 新语言（如 Rust） | `src/adapters/<lang>/` + 在 `adapterRegistry.ts` 中注册 |

---

## 🙏 致谢

灵感来源于 [cv_debug_mate_cpp](https://github.com/dull-bird/cv_debug_mate_cpp) 以及 Visual Studio 的 [Image Watch](https://marketplace.visualstudio.com/items?itemName=VisualCPPTeam.ImageWatch2022) 插件。

---

## 📄 许可证

MIT

---

## 🤝 贡献

欢迎提交 Issue 和 PR！
