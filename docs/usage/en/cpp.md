# C++ Usage Guide — Matrix Viewer Debug

[English](cpp.md) | [中文](../../zh/cpp.md)

> **Back to main README**: [README.md](../../../README.md)

---

## Table of Contents

- [Requirements](#requirements)
- [Supported Compilers and Debuggers](#supported-compilers-and-debuggers)
- [Build Configuration](#build-configuration)
  - [LLVM / Clang + CodeLLDB (Windows)](#llvm--clang--codelldb-windows)
  - [GCC + GDB (Linux / macOS / WSL)](#gcc--gdb-linux--macos--wsl)
  - [MSVC + vsdbg (Windows)](#msvc--vsdbg-windows)
- [launch.json Configuration](#launchjson-configuration)
- [Opening the Variables Panel](#opening-the-variables-panel)
- [Visualizing a Variable](#visualizing-a-variable)
- [Viewer Controls](#viewer-controls)
  - [Image Viewer](#image-viewer)
  - [Plot Viewer](#plot-viewer)
  - [Point Cloud Viewer](#point-cloud-viewer)
- [View Sync](#view-sync)
- [Supported C++ Types](#supported-c-types)
- [Quick-Start Example](#quick-start-example)
- [Troubleshooting](#troubleshooting)

---

## Requirements

| Requirement | Details |
|-------------|---------|
| VS Code | 1.93.0+ |
| Debugger extension | [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) (`ms-vscode.cpptools`) — for `cppdbg`<br>[CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) (`vadimcn.vscode-lldb`) — for `lldb` |
| Compiler | Clang/LLVM ≥ 14, GCC ≥ 11, or MSVC 2022 |
| Optional libraries | `OpenCV 4`, `Eigen3`, `PCL` — depending on which types you visualize |

> **All third-party libraries linked into the debugged program must be compiled with debug symbols.**
> GDB and LLDB can only access member functions, struct fields, and type metadata when the library
> carries DWARF debug symbols. Ubuntu / Debian system packages strip symbols by default.
> Without debug symbols, Qt containers (`QVector`, `QList`, `QImage`) and other library types
> fall back to raw memory reads and trigger a warning notification. For best results,
> either install the `*-dbgsym` counterpart packages or build all dependencies from source
> (e.g. via vcpkg with `-DCMAKE_BUILD_TYPE=Debug`).

---

## Supported Compilers and Debuggers

| Compiler | Debugger | Session Type | Notes |
|----------|----------|--------------|-------|
| Clang/LLVM | CodeLLDB | `lldb` | Requires `-gdwarf-4 -fstandalone-debug` on Windows |
| GCC | GDB | `cppdbg` | Standard DWARF, works out of the box |
| MSVC | vsdbg | `cppvsdbg` | Requires Visual Studio 2019+; build with `build_msvc.bat` |

> **Windows + LLVM + CodeLLDB is the recommended combination.**  
> LLDB has limited PDB (CodeView) support; building with DWARF debug info is required
> for the extension to resolve complex types such as `cv::Mat` or `Eigen::Matrix`.

---

## Build Configuration

### LLVM / Clang + CodeLLDB (Windows)

Add the following CMake flags to embed DWARF debug info:

```cmake
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -gdwarf-4 -fstandalone-debug")
```

Or pass them on the command line:

```powershell
cmake -G Ninja -DCMAKE_BUILD_TYPE=Debug `
  -DCMAKE_CXX_FLAGS_DEBUG="-O0 -gdwarf-4 -fstandalone-debug" `
  ..
```

The `build_llvm.bat` script in the demo project sets these flags automatically:

```bat
test\test_cpp\scripts\bat\build_llvm.bat
```

> `-gdwarf-4` — emit DWARF 4 debug info instead of CodeView/PDB.  
> `-fstandalone-debug` — embed complete type definitions for types from third-party
> (e.g. MSVC-compiled) headers so LLDB can resolve them.

### GCC + GDB (Linux / macOS / WSL)

Standard Debug build works without extra flags:

```cmake
cmake -DCMAKE_BUILD_TYPE=Debug ..
make -j$(nproc)
```

> **Third-party libraries must also carry DWARF debug symbols.**
> System Qt / OpenCV / PCL packages on Ubuntu strip symbols. Two options:
>
> **Option A — install system debug-symbol packages** (see [Troubleshooting](#troubleshooting)):
> ```bash
> sudo apt-get install libopencv-dev libopencv4.5-dbg     # OpenCV
> sudo apt-get install libqt5gui5-dbgsym                  # Qt5 (requires ddebs repo)
> ```
>
> **Option B — build all dependencies from source via vcpkg** (recommended; debug symbols always included):
> ```bash
> export https_proxy=http://127.0.0.1:7890   # set your proxy if needed
> cd ~/Library/vcpkg
> ./vcpkg install opencv4 eigen3 pcl qtbase --triplet x64-linux
> cmake -B build -DCMAKE_BUILD_TYPE=Debug \
>   -DCMAKE_TOOLCHAIN_FILE=$HOME/Library/vcpkg/scripts/buildsystems/vcpkg.cmake ..
> make -j$(nproc)
> ```

### MSVC + vsdbg (Windows)

Use the `build_msvc.bat` script:

```bat
test\test_cpp\scripts\bat\build_msvc.bat
```

This configures and builds with Visual Studio (2022 or 2024), producing `build_msvc/Debug/demo.exe`.

Or build manually:

```powershell
cmake -S . -B build_msvc -G "Visual Studio 17 2022" -A x64 `
  -DWITH_OPENCV=ON -DWITH_EIGEN=ON -DWITH_PCL=ON `
  "-DCMAKE_TOOLCHAIN_FILE=D:/Library/vcpkg/scripts/buildsystems/vcpkg.cmake"
cmake --build build_msvc --config Debug
```

> `std::vector`, `std::array`, `T[N]`, Eigen vector/matrix types are detected and visualized out of the box.  
> `cv::Mat` variables may not appear in the **MatrixViewer Debug** panel because vsdbg reports type strings differently from LLDB/GDB.  
> For the best coverage of complex types, use **LLVM + CodeLLDB** instead.

---

## launch.json Configuration

### CodeLLDB (`"type": "lldb"`)

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
        // Add vcpkg debug DLL folder and LLVM bin so runtime DLLs are found
        "PATH": "D:/Library/vcpkg/installed/x64-windows/debug/bin;C:/Program Files/LLVM/bin;${env:PATH}"
    }
}
```

> Use `stopOnEntry` (not `stopAtEntry`) — the latter is a `cppdbg`/`cppvsdbg` property
> and will cause a JSON schema error with CodeLLDB.

### GDB (Linux / macOS / WSL)

```jsonc
{
    "name": "C++ (GCC / GDB)",
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

### vsdbg (MSVC, Windows)

```jsonc
{
    "name": "C++ Demo (MSVC / vsdbg)",
    "type": "cppvsdbg",
    "request": "launch",
    "program": "${workspaceFolder}/build_msvc/Debug/demo.exe",
    "args": [],
    "cwd": "${workspaceFolder}",
    "stopAtEntry": false,
    "environment": [],
    "console": "internalConsole"
}
```

> If the executable cannot find vcpkg DLLs at startup, add the `debug/bin` folder to `environment`:
> ```jsonc
> "environment": [
>     { "name": "PATH", "value": "D:/Library/vcpkg/installed/x64-windows/debug/bin;${env:PATH}" }
> ]
> ```

---

## Opening the Variables Panel

1. Start the debug session (press **F5**) and let it pause at a breakpoint.
2. Open the **Run and Debug** sidebar (`Ctrl+Shift+D`).
3. Find the **MatrixViewer Debug** section — it lists all visualizable variables in the current scope.
4. The list refreshes automatically on every debugger step.

![MatrixViewer Debug panel in the Debug sidebar showing C++ variables](../../../assets/usage_images/cpp_debug_show_variables_list.png)

---

## Visualizing a Variable

### Option 1 — MatrixViewer Debug panel (Recommended)

Click any variable name in the **MatrixViewer Debug** panel.

### Option 2 — Context Menu

Right-click a variable in the native **Variables** pane → **View by MatrixViewer**.

![Right-click context menu on a cv::Mat variable showing View by MatrixViewer](../../../assets/usage_images/right-click%20context%20menu%20on%20a%20cvMat%20variable.png)

### Option 3 — Command Palette

`Ctrl+Shift+P` → **MatrixViewer: View by MatrixViewer** → type the variable name.

---

## Viewer Controls

### Image Viewer

Renders `cv::Mat`, 2D/3D `std::array`, and C-style 2D arrays as a zoomable canvas.

| Action | Control |
|--------|---------|
| Zoom in / out | Scroll wheel |
| Pan | Click and drag |
| Reset view | Click **Reset** button |
| Apply colormap | Colormap dropdown (gray, jet, viridis, hot, plasma) |
| Toggle normalize | **Normalize** checkbox — maps min→0, max→255 |
| Hover pixel info | Move cursor to see `[row, col] = value` |
| Export | Click **Save PNG** |

![Image Viewer showing a cv::Mat grayscale image with jet colormap](../../../assets/usage_images/cv_gray_jet.png)

### Plot Viewer

Renders 1D/2D numeric data as a line chart, scatter chart, or histogram.

| Action | Control |
|--------|---------|
| Zoom | Rectangle-select, or scroll wheel |
| Pan | Click and drag |
| Reset zoom | Double-click |
| Switch mode | **Line / Scatter / Histogram** buttons |
| View stats | Min, Max, Mean, Std displayed below the chart |
| Export PNG | Click **Save PNG** |
| Export CSV | Click **Save CSV** |

![Plot Viewer showing an Eigen VectorXd as a 1D line chart](../../../assets/usage_images/eigen_1d.png)

![Plot Viewer showing an Eigen MatrixXd (Nx2) as a 2D scatter chart](../../../assets/usage_images/eigen_2d.png)

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

![Point Cloud Viewer showing a pcl::PointCloud colored by Z axis](../../../assets/usage_images/cpp_pcl.png)

---

## View Sync

Pair two open viewer panels so their viewport stays in sync:

1. Open two viewer panels.
2. In either panel, click **Sync** and select the other panel.
3. Moving the viewport in one panel mirrors it in the other.
4. Click **Unsync** to break the pair.

---

## Supported C++ Types

### Image Viewer

| Type | Notes |
|------|-------|
| `cv::Mat` | All depths (CV_8U, CV_16U, CV_32F, …); 1, 3, 4 channels |
| `std::array<std::array<T,W>,H>` | 2D array — treated as grayscale image |
| `T[H][W]` | C-style 2D array — treated as grayscale image |
| `T[H][W][C]` | C-style 3D array — treated as multi-channel image |
| `Eigen::Matrix<T,R,C>` / `Eigen::Array<T,R,C>` | rows > 1 and cols > 2 — rendered as grayscale image, auto-normalised |

### Plot Viewer

| Type | Notes |
|------|-------|
| `std::vector<T>` (numeric T) | 1D line chart |
| `std::array<T,N>` (numeric T) | 1D line chart |
| `T[N]` — C-style 1D array | 1D line chart |
| `Eigen::VectorXd` / `Eigen::VectorXf` | 1D line chart |
| `Eigen::RowVectorXd` / `Eigen::RowVectorXf` | 1D line chart |
| `Eigen::Matrix<T,N,1>` / `Eigen::Matrix<T,1,N>` | 1D line chart |
| `Eigen::Matrix<T,N,2>` | 2D scatter — column 0 = X, column 1 = Y |

**Eigen routing rules** (determined at runtime via `.rows()` / `.cols()`):

| Condition | Viewer |
|-----------|--------|
| `cols == 1` or `rows == 1` | 1D line plot |
| `cols == 2` | 2D scatter (col 0 = X, col 1 = Y) |
| `rows > 1` and `cols > 2` | Image (grayscale, auto-normalised) |

### Point Cloud Viewer

| Type | Notes |
|------|-------|
| `pcl::PointCloud<pcl::PointXYZ>` | XYZ points |
| `pcl::PointCloud<pcl::PointXYZRGB>` | XYZ + per-point RGB |
| `std::vector<cv::Point3f>` / `std::vector<cv::Point3d>` | Each element = one 3D point |
| `std::array<cv::Point3f,N>` / `std::array<cv::Point3d,N>` | Each element = one 3D point |

---

## Quick-Start Example

A ready-to-run C++ demo lives in [`test/test_cpp/`](../../../test/test_cpp/).

1. Install prerequisites:

   ```powershell
   winget install LLVM.LLVM Ninja-build.Ninja Kitware.CMake
   vcpkg install opencv4 eigen3 pcl --triplet x64-windows
   ```

2. Build (Windows + LLVM):

   ```bat
   test\test_cpp\scripts\bat\build_llvm.bat
   ```

3. Open `test/test_cpp` in VS Code, press **F5**, select **C++ Demo (LLVM / CodeLLDB)**.

4. The debugger stops at the breakpoint. Open the **MatrixViewer Debug** panel to see all detected variables.

![demo.cpp breakpoint hit with MatrixViewer Debug panel showing cv::Mat, Eigen, and pcl variables](../../../assets/usage_images/quick_start.png)

---

## Troubleshooting

### Process exits immediately with `0xc0000135`

The executable cannot find one or more vcpkg DLLs at startup.  
→ Add the vcpkg `debug/bin` directory to `env.PATH` in `launch.json`:

```jsonc
"env": {
    "PATH": "D:/Library/vcpkg/installed/x64-windows/debug/bin;C:/Program Files/LLVM/bin;${env:PATH}"
}
```

### `cv::Mat` variables not detected (type information missing)

The binary was compiled with CodeView/PDB debug info instead of DWARF.  
→ Rebuild using `-gdwarf-4 -fstandalone-debug` (the `build_llvm.bat` script does this).  
→ Verify: open `build_llvm/CMakeCache.txt` and confirm:

```
CMAKE_CXX_FLAGS_DEBUG:STRING=-O0 -gdwarf-4 -fstandalone-debug
```

### Schema error "属性 stopAtEntry 不允许"

`stopAtEntry` is a `cppdbg`/`cppvsdbg` property and is not recognised by CodeLLDB.  
→ Rename it to `stopOnEntry` in the `"type": "lldb"` launch configuration.

### Variable appears in Variables pane but not in MatrixViewer Debug panel

The type may not yet be detected by Layer-1 quick detection.  
→ Use **Option 3 (Command Palette)** to visualize it by name directly.

### `QImage` cannot be visualized under GDB ("Couldn't find method" / "There is no member named d")

The system Qt library does not have a separate debug-symbols package installed, so GDB
cannot access `QImage` member functions or private members.  
The extension already includes a memory-layout-based fallback that can read pixel data
without debug symbols, but installing the symbols package makes the access more
reliable.

> See also: [C++ Windows CodeLLDB Setup Guide](../../cpp-windows-codelldb-setup.md) for a full walk-through.
