# Python 使用指南 — Matrix Viewer Debug

[English](../../en/python.md) | 中文

> **返回主 README**：[README_CN.md](../../../README_CN.md)

---

## 目录

- [系统要求](#系统要求)
- [安装](#安装)
- [启动调试会话](#启动调试会话)
- [打开变量面板](#打开变量面板)
- [可视化变量](#可视化变量)
- [查看器操作](#查看器操作)
  - [图像查看器](#图像查看器)
  - [曲线查看器](#曲线查看器)
  - [点云查看器](#点云查看器)
- [视图同步](#视图同步)
- [支持的 Python 类型](#支持的-python-类型)
- [快速上手示例](#快速上手示例)

---

## 系统要求

| 要求 | 说明 |
|------|------|
| VS Code | 1.93.0+ |
| Python 扩展 | [`ms-python.python`](https://marketplace.visualstudio.com/items?itemName=ms-python.python) |
| Python | 3.8+ |
| debugpy | 随 Python 扩展自动安装 |
| 可选 Python 包 | `numpy`、`Pillow`、`torch`、`open3d`——根据需要可视化的类型按需安装 |

---

## 安装

### 通过 VSIX 安装

1. 下载 `.vsix` 文件。
2. 打开扩展视图（`Ctrl+Shift+X`）→ `...` → **从 VSIX 安装…**

### 从源码构建

```bash
git clone https://github.com/dull-bird/cv_debug_mate_python
cd cv_debug_mate_python
npm install
npm run compile
# 按 F5 启动扩展开发宿主
```

---

## 启动调试会话

1. 在 VS Code 中打开 Python 文件（或 Jupyter Notebook）。
2. 设置一个或多个断点。
3. 按 **F5**（或使用**运行 → 启动调试**）。
4. 调试器在第一个断点处暂停。

> 支持的 Session 类型：`python`、`debugpy`、`jupyter`。

<!-- TODO: 截图 — Python 调试会话已启动，调试器停在断点处 -->

---

## 打开变量面板

1. 在**运行和调试**侧边栏（`Ctrl+Shift+D`）中向下滚动，找到 **CV DebugMate** 区域。
2. 面板列出当前作用域内所有可以可视化的变量。
3. 每次调试器步进到新行时，列表自动刷新。

<!-- TODO: 截图 — CV DebugMate 变量面板显示已检测到的变量 -->

---

## 可视化变量

有三种方式打开变量的查看器：

### 方式一：CV DebugMate 面板（推荐）

点击 **CV DebugMate** 面板中的任意变量名，即可打开对应查看器（图像 / 曲线 / 点云）。

### 方式二：右键菜单

在原生**变量**面板中右键点击变量 → **View by CV DebugMate**。

<!-- TODO: 截图 — 在变量上右键弹出菜单 -->

### 方式三：命令面板

`Ctrl+Shift+P` → **CV DebugMate: Visualize Variable** → 输入变量名。

---

## 查看器操作

### 图像查看器

将 `PIL.Image`、`numpy` 2D/3D 数组、`torch.Tensor` 图像张量、`cv2` 矩阵渲染为可缩放的画布。

| 操作 | 方式 |
|------|------|
| 缩放 | 滚轮 |
| 平移 | 鼠标拖动 |
| 重置视图 | 点击 **Reset** 按钮 |
| 应用伪彩色 | 伪彩色下拉菜单（gray、jet、viridis、hot、plasma） |
| 切换归一化 | **Normalize** 复选框——将 min→0、max→255 |
| 悬停像素信息 | 移动光标查看 `[行, 列] = 值` |
| 导出 | 点击 **Save PNG** |

<!-- TODO: 截图 — 图像查看器，已应用 jet 伪彩色并显示像素悬停提示 -->

### 曲线查看器

使用 uPlot 将数据渲染为折线图、散点图或直方图。

| 操作 | 方式 |
|------|------|
| 缩放 | 框选区域，或滚轮 |
| 平移 | 鼠标拖动 |
| 重置缩放 | 双击 |
| 切换模式 | **Line / Scatter / Histogram** 按钮 |
| 自定义 X 轴 | 在 **X Variable** 输入框中填写变量名后按 Enter |
| 查看统计 | 图表下方显示 Min、Max、Mean、Std |
| 导出 PNG | 点击 **Save PNG** |
| 导出 CSV | 点击 **Save CSV** |

<!-- TODO: 截图 — 曲线查看器显示一维 numpy 数组折线图 -->

<!-- TODO: 截图 — 曲线查看器显示 Nx2 数组二维散点图 -->

### 点云查看器

使用 Three.js + OrbitControls 渲染三维点云。

| 操作 | 方式 |
|------|------|
| 旋转 | 鼠标拖动 |
| 缩放 | 滚轮 |
| 平移 | 右键拖动 |
| 重置相机 | 点击 **Reset** 按钮 |
| 按轴着色 | 颜色下拉框选择 **X / Y / Z** |
| 调整点大小 | 拖动 **Point Size** 滑块 |
| 导出 PLY | 点击 **Save PLY** |

<!-- TODO: 截图 — 点云查看器，按 Z 轴着色 -->

---

## 视图同步

将两个已打开的查看器面板配对，使其视口（缩放 / 平移 / 旋转）保持同步：

1. 为两个不同变量分别打开查看器面板。
2. 在任意面板中点击 **Sync**，然后从下拉框中选择另一个面板。
3. 在一个面板中移动视口，另一个面板自动跟随。
4. 点击 **Unsync** 解除配对。

<!-- TODO: 截图 — 两个图像查看器并排，已启用视图同步 -->

---

## 支持的 Python 类型

### 图像查看器

| 类型 | 说明 |
|------|------|
| `PIL.Image.Image` | 任意模式（RGB、RGBA、L、P 等） |
| `numpy.ndarray` | shape `(H, W)` — 灰度；`(H, W, 3)` — RGB；`(H, W, 4)` — RGBA |
| `torch.Tensor` | shape `(H, W)`、`(C, H, W)` 或 `(1, C, H, W)` |
| `cv2.UMat` | OpenCV UMat，自动下载到 CPU |
| `cv2.cuda.GpuMat` | OpenCV CUDA 矩阵，自动下载到 CPU |

### 曲线查看器

| 类型 | 说明 |
|------|------|
| `numpy.ndarray` shape `(N,)` | 一维折线图 |
| `numpy.ndarray` shape `(N, 2)` | 二维散点图——第 0 列 = X，第 1 列 = Y |
| `list` / `tuple`（元素为数值） | 一维折线图 |
| `list` / `tuple`（元素为二元序列） | 二维散点图 |
| `torch.Tensor`（一维） | 一维折线图 |

### 点云查看器

| 类型 | 说明 |
|------|------|
| `numpy.ndarray` shape `(N, 3)` | XYZ 列 |
| `numpy.ndarray` shape `(N, 6)` | XYZ + RGB 列 |
| `open3d.geometry.PointCloud` | 点坐标及可选的逐点颜色 |
| `list` / `tuple`（元素为三元序列） | 每个元素视为 `(x, y, z)` |

---

## 快速上手示例

覆盖所有支持类型的演示项目在 [`test/test_python/`](../../../test/test_python/) 中：

```bash
cd test/test_python
pip install -r requirements.txt
# 在 VS Code 中打开，在 demo.py 中设断点，按 F5
code .
```

<!-- TODO: 截图 — demo.py 断点触发，CV DebugMate 面板已打开 -->
