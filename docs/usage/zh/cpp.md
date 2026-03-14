# C++ 使用指南 — Matrix Viewer Debug

[English](../../en/cpp.md) | 中文

> **返回主 README**：[README_CN.md](../../../README_CN.md)

---

## 目录

- [系统要求](#系统要求)
- [支持的编译器与调试器](#支持的编译器与调试器)
- [编译配置](#编译配置)
  - [LLVM / Clang + CodeLLDB（Windows）](#llvm--clang--codelldbwindows)
  - [GCC + cppdbg（Linux / macOS / WSL）](#gcc--cppdbglinux--macos--wsl)
  - [MSVC + cppdbg（Windows）](#msvc--cppdbgwindows)
- [launch.json 配置](#launchjson-配置)
- [打开变量面板](#打开变量面板)
- [可视化变量](#可视化变量)
- [查看器操作](#查看器操作)
  - [图像查看器](#图像查看器)
  - [曲线查看器](#曲线查看器)
  - [点云查看器](#点云查看器)
- [视图同步](#视图同步)
- [支持的 C++ 类型](#支持的-c-类型)
- [快速上手示例](#快速上手示例)
- [常见问题排查](#常见问题排查)

---

## 系统要求

| 要求 | 说明 |
|------|------|
| VS Code | 1.93.0+ |
| 调试器扩展 | [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)（`ms-vscode.cpptools`）— 用于 `cppdbg`<br>[CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)（`vadimcn.vscode-lldb`）— 用于 `lldb` |
| 编译器 | Clang/LLVM ≥ 14、GCC ≥ 11 或 MSVC 2022 |
| 可选第三方库 | `OpenCV 4`、`Eigen3`、`PCL`——根据需要可视化的类型按需安装 |

---

## 支持的编译器与调试器

| 编译器 | 调试器 | Session 类型 | 备注 |
|--------|--------|--------------|------|
| Clang/LLVM | CodeLLDB | `lldb` | Windows 下需要 `-gdwarf-4 -fstandalone-debug` |
| GCC | cppdbg + gdb | `cppdbg` | 标准 DWARF，开箱即用 |
| MSVC | cppdbg + vsdbg | `cppdbg` | 类型检查受限；完整支持需要 DWARF 调试信息 |

> **推荐组合：Windows + LLVM + CodeLLDB。**  
> LLDB 对 PDB（CodeView）支持有限；在 Windows 上必须使用 DWARF 调试信息，  
> 扩展才能解析 `cv::Mat`、`Eigen::Matrix` 等复杂类型。

---

## 编译配置

### LLVM / Clang + CodeLLDB（Windows）

在 CMakeLists.txt 中添加以下编译标志，以嵌入 DWARF 调试信息：

```cmake
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -gdwarf-4 -fstandalone-debug")
```

或通过命令行传入：

```powershell
cmake -G Ninja -DCMAKE_BUILD_TYPE=Debug `
  -DCMAKE_CXX_FLAGS_DEBUG="-O0 -gdwarf-4 -fstandalone-debug" `
  ..
```

演示项目中的 `build_llvm.bat` 脚本已自动设置这些标志：

```bat
test\test_cpp\scripts\bat\build_llvm.bat
```

> `-gdwarf-4` — 生成 DWARF 4 调试信息，而非 CodeView/PDB。  
> `-fstandalone-debug` — 为第三方（如 MSVC 编译的）头文件中的类型嵌入完整类型定义，  
> 使 LLDB 能够解析这些类型。

<!-- TODO: 截图 — 终端显示 build_llvm.bat 成功构建输出 -->

### GCC + cppdbg（Linux / macOS / WSL）

标准 Debug 构建无需额外标志：

```cmake
cmake -DCMAKE_BUILD_TYPE=Debug ..
make -j$(nproc)
```

### MSVC + cppdbg（Windows）

使用 Visual Studio 或 `cmake --build . --config Debug` 进行 Debug 构建。  
简单类型可以正常检测；`cv::Mat` 等复杂类型的类型信息可能不完整。

---

## launch.json 配置

### CodeLLDB（`"type": "lldb"`）

```jsonc
{
    "name": "C++ (LLVM / CodeLLDB)",
    "type": "lldb",
    "request": "launch",
    "program": "${workspaceFolder}/build_llvm/demo.exe",
    "args": [],
    "cwd": "${workspaceFolder}",
    "stopOnEntry": false,
    "env": {
        // 将 vcpkg debug DLL 目录和 LLVM bin 目录加入 PATH，确保运行时找到 DLL
        "PATH": "D:/Library/vcpkg/installed/x64-windows/debug/bin;C:/Program Files/LLVM/bin;${env:PATH}"
    }
}
```

> 使用 `stopOnEntry`，而非 `stopAtEntry`——后者是 `cppdbg`/`cppvsdbg` 专有属性，  
> 与 CodeLLDB 一起使用会导致 JSON Schema 错误。

### cppdbg + gdb（Linux / macOS / WSL）

```jsonc
{
    "name": "C++ (GCC / cppdbg)",
    "type": "cppdbg",
    "request": "launch",
    "program": "${workspaceFolder}/build/demo",
    "args": [],
    "cwd": "${workspaceFolder}",
    "stopAtEntry": false,
    "MIMode": "gdb",
    "miDebuggerPath": "/usr/bin/gdb"
}
```

<!-- TODO: 截图 — VS Code 编辑器中打开的 launch.json -->

---

## 打开变量面板

1. 启动调试会话（按 **F5**），等待调试器在断点处暂停。
2. 打开**运行和调试**侧边栏（`Ctrl+Shift+D`）。
3. 找到 **CV DebugMate** 区域——列出当前作用域内所有可视化变量。
4. 每次调试器步进时，列表自动刷新。

<!-- TODO: 截图 — 调试侧边栏中的 CV DebugMate 面板，显示 C++ 变量列表 -->

---

## 可视化变量

### 方式一：CV DebugMate 面板（推荐）

点击 **CV DebugMate** 面板中的任意变量名。

### 方式二：右键菜单

在原生**变量**面板中右键点击变量 → **View by CV DebugMate**。

<!-- TODO: 截图 — 在 cv::Mat 变量上右键弹出菜单 -->

### 方式三：命令面板

`Ctrl+Shift+P` → **CV DebugMate: Visualize Variable** → 输入变量名。

---

## 查看器操作

### 图像查看器

将 `cv::Mat`、二维 `std::array`、C 风格二维数组渲染为可缩放的画布。

| 操作 | 方式 |
|------|------|
| 缩放 | 滚轮 |
| 平移 | 鼠标拖动 |
| 重置视图 | 点击 **Reset** 按钮 |
| 应用伪彩色 | 伪彩色下拉菜单（gray、jet、viridis、hot、plasma） |
| 切换归一化 | **Normalize** 复选框——将 min→0、max→255 |
| 悬停像素信息 | 移动光标查看 `[行, 列] = 值` |
| 导出 | 点击 **Save PNG** |

<!-- TODO: 截图 — 图像查看器显示 cv::Mat 灰度图像，已应用 jet 伪彩色 -->

### 曲线查看器

将一维 / 二维数值数据渲染为折线图、散点图或直方图。

| 操作 | 方式 |
|------|------|
| 缩放 | 框选区域，或滚轮 |
| 平移 | 鼠标拖动 |
| 重置缩放 | 双击 |
| 切换模式 | **Line / Scatter / Histogram** 按钮 |
| 查看统计 | 图表下方显示 Min、Max、Mean、Std |
| 导出 PNG | 点击 **Save PNG** |
| 导出 CSV | 点击 **Save CSV** |

<!-- TODO: 截图 — 曲线查看器显示 Eigen VectorXd 一维折线图 -->

<!-- TODO: 截图 — 曲线查看器显示 Eigen MatrixXd（Nx2）二维散点图 -->

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

<!-- TODO: 截图 — 点云查看器显示 pcl::PointCloud，按 Z 轴着色 -->

---

## 视图同步

将两个已打开的查看器面板配对，使其视口保持同步：

1. 为两个变量分别打开查看器面板。
2. 在任意面板中点击 **Sync**，然后从下拉框中选择另一个面板。
3. 在一个面板中移动视口，另一个面板自动跟随。
4. 点击 **Unsync** 解除配对。

---

## 支持的 C++ 类型

### 图像查看器

| 类型 | 说明 |
|------|------|
| `cv::Mat` | 所有位深（CV_8U、CV_16U、CV_32F 等）；支持 1、3、4 通道 |
| `std::array<std::array<T,W>,H>` | 二维数组——视为灰度图像 |
| `T[H][W]` | C 风格二维数组——视为灰度图像 |
| `T[H][W][C]` | C 风格三维数组——视为多通道图像 |
| `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>` | rows > 1 且 cols > 2——渲染为灰度图像，自动归一化 |

### 曲线查看器

| 类型 | 说明 |
|------|------|
| `std::vector<T>`（数值类型 T） | 一维折线图 |
| `std::array<T,N>`（数值类型 T） | 一维折线图 |
| `T[N]`——C 风格一维数组 | 一维折线图 |
| `Eigen::VectorXd` / `Eigen::VectorXf` | 一维折线图 |
| `Eigen::RowVectorXd` / `Eigen::RowVectorXf` | 一维折线图 |
| `Eigen::Matrix<T,N,1>` / `Eigen::Matrix<T,1,N>` | 一维折线图 |
| `Eigen::Matrix<T,N,2>` | 二维散点图——第 0 列 = X，第 1 列 = Y |

**Eigen 路由规则**（运行时通过 `.rows()` / `.cols()` 判断）：

| 条件 | 查看器 |
|------|--------|
| `cols == 1` 或 `rows == 1` | 一维折线图 |
| `cols == 2` | 二维散点图（第 0 列 = X，第 1 列 = Y） |
| `rows > 1` 且 `cols > 2` | 图像（灰度，自动归一化） |

### 点云查看器

| 类型 | 说明 |
|------|------|
| `pcl::PointCloud<pcl::PointXYZ>` | XYZ 点 |
| `pcl::PointCloud<pcl::PointXYZRGB>` | XYZ + 逐点 RGB |
| `std::vector<cv::Point3f>` / `std::vector<cv::Point3d>` | 每个元素 = 一个三维点 |
| `std::array<cv::Point3f,N>` / `std::array<cv::Point3d,N>` | 每个元素 = 一个三维点 |

---

## 快速上手示例

演示项目在 [`test/test_cpp/`](../../../test/test_cpp/) 中：

1. 安装前置工具：

   ```powershell
   winget install LLVM.LLVM Ninja-build.Ninja Kitware.CMake
   vcpkg install opencv4 eigen3 pcl --triplet x64-windows
   ```

2. 构建（Windows + LLVM）：

   ```bat
   test\test_cpp\scripts\bat\build_llvm.bat
   ```

3. 用 VS Code 打开 `test/test_cpp`，按 **F5**，选择 **C++ Demo (LLVM / CodeLLDB)**。

4. 调试器停在断点处，打开 **CV DebugMate** 面板查看所有已检测到的变量。

<!-- TODO: 截图 — demo.cpp 断点触发，CV DebugMate 面板显示 cv::Mat、Eigen、pcl 变量 -->

---

## 常见问题排查

### 程序启动后立即退出，退出码 `0xc0000135`

可执行文件找不到 vcpkg 的 DLL。  
→ 在 `launch.json` 的 `env.PATH` 中添加 vcpkg `debug/bin` 目录：

```jsonc
"env": {
    "PATH": "D:/Library/vcpkg/installed/x64-windows/debug/bin;C:/Program Files/LLVM/bin;${env:PATH}"
}
```

### `cv::Mat` 变量未被检测到（类型信息缺失）

程序使用 CodeView/PDB 调试信息编译，而非 DWARF。  
→ 使用 `-gdwarf-4 -fstandalone-debug` 重新编译（`build_llvm.bat` 已自动设置此标志）。  
→ 核验方式：打开 `build_llvm/CMakeCache.txt`，确认存在以下内容：

```
CMAKE_CXX_FLAGS_DEBUG:STRING=-O0 -gdwarf-4 -fstandalone-debug
```

### Schema 错误"属性 stopAtEntry 不允许"

`stopAtEntry` 是 `cppdbg`/`cppvsdbg` 专有属性，CodeLLDB 不识别。  
→ 在 `"type": "lldb"` 的启动配置中改为 `stopOnEntry`。

### 变量在变量面板中可见，但未出现在 CV DebugMate 面板

该类型可能尚未被 Layer-1 快速检测识别。  
→ 使用**方式三（命令面板）**直接通过变量名可视化。

> 另请参阅：[C++ Windows CodeLLDB 配置指南](../../cpp-windows-codelldb-setup.md)，包含完整操作流程。
