# C++ Debugging on Windows with LLVM / CodeLLDB

This document describes the steps required to use the MatrixViewer Debug extension  
with a C++ project on Windows, compiled by Clang/LLVM and debugged with CodeLLDB.

---

## Prerequisites

| Tool | Install command |
|------|----------------|
| LLVM / Clang | `winget install LLVM.LLVM` |
| Ninja | `winget install Ninja-build.Ninja` |
| CMake ≥ 3.16 | `winget install Kitware.CMake` |
| vcpkg | See [vcpkg docs](https://vcpkg.io/en/getting-started) |
| VS Code extension: **CodeLLDB** | `vadimcn.vscode-lldb` |
| VS Code extension: **C/C++** (optional, for IntelliSense) | `ms-vscode.cpptools` |

---

## 1. Install third-party libraries via vcpkg

```powershell
vcpkg install opencv4 eigen3 pcl --triplet x64-windows
```

The default vcpkg root assumed by the build script is `D:\Library\vcpkg`.  
If yours is different, set the environment variable before running the script:

```powershell
$env:VCPKG_ROOT = "C:\path\to\vcpkg"
```

---

## 2. Build the demo with DWARF debug info

> **Why DWARF?**  
> Clang on Windows defaults to CodeView/PDB debug format when targeting the MSVC ABI.  
> LLDB (and therefore CodeLLDB) has limited support for PDB: it cannot resolve the type
> information for complex types such as `cv::Mat`. Using DWARF (`-gdwarf-4`) lets LLDB
> read full type definitions, which the MatrixViewer extension relies on to detect
> visualizable variables.  
> `-fstandalone-debug` additionally embeds complete type definitions for types that come
> from MSVC-compiled third-party headers (OpenCV, PCL, Eigen).

Run the build script from the project root or from the `test/test_cpp` folder:

```bat
test\test_cpp\scripts\bat\build_llvm.bat
```

The script passes `-DCMAKE_CXX_FLAGS_DEBUG="-O0 -gdwarf-4 -fstandalone-debug"` to CMake,
which overrides the default CodeView flags. The compiled binary is placed at:

```
test/test_cpp/build_llvm/demo.exe
```

---

## 3. Configure `launch.json`

In `.vscode/launch.json` (relative to the C++ project folder), add a CodeLLDB entry:

```jsonc
{
    "name": "C++ Demo (LLVM / CodeLLDB)",
    "type": "lldb",               // CodeLLDB extension
    "request": "launch",
    "program": "${workspaceFolder}/build_llvm/demo.exe",
    "args": [],
    "cwd": "${workspaceFolder}",
    "stopOnEntry": false,         // NOTE: CodeLLDB uses "stopOnEntry", not "stopAtEntry"
    "env": {
        // Add the vcpkg debug DLL folder and LLVM bin to PATH so that
        // the runtime can find OpenCV/PCL/Boost DLLs when launching the process.
        "PATH": "D:/Library/vcpkg/installed/x64-windows/debug/bin;C:/Program Files/LLVM/bin;${env:PATH}"
    }
}
```

**Key points:**

| Property | Value | Note |
|----------|-------|------|
| `type` | `"lldb"` | Provided by the CodeLLDB extension, **not** `"cppdbg"` |
| `stopOnEntry` | `false` / `true` | CodeLLDB uses `stopOnEntry`; `stopAtEntry` is a `cppdbg`/`cppvsdbg` property and will cause a schema error |
| `env.PATH` | vcpkg debug bin + LLVM bin | Without this, the process exits immediately with `0xc0000135` (DLL not found) |

Adjust the vcpkg path to match your actual installation root if it differs from  
`D:/Library/vcpkg`.

---

## 4. Verify the setup

1. Open the `test/test_cpp` folder in VS Code.
2. Press **F5** and select `C++ Demo (LLVM / CodeLLDB)`.
3. The debugger should stop at the breakpoint on line 235 (`volatile int bp = 0`).
4. Open the **MatrixViewer Debug** panel in the Debug sidebar.
5. All visualizable variables (`cv::Mat`, `std::vector`, `Eigen::Matrix`,  
   `pcl::PointCloud`, `std::array`, C-style arrays like `double[128]`, …)  
   should appear automatically.

---

## Troubleshooting

### Process exits with `0xc0000135`

The executable cannot find one or more vcpkg DLLs at startup.  
→ Add the vcpkg `debug/bin` directory to `env.PATH` in `launch.json` (see Step 3).

### `cv::Mat` variables not detected (type shown as empty)

The binary was compiled with CodeView/PDB debug info instead of DWARF.  
→ Rebuild using the `build_llvm.bat` script, which sets `-gdwarf-4 -fstandalone-debug`.  
→ Verify by checking `build_llvm/CMakeCache.txt`:  
   `CMAKE_CXX_FLAGS_DEBUG:STRING=-O0 -gdwarf-4 -fstandalone-debug`

### Schema error "属性 stopAtEntry 不允许" on the CodeLLDB entry

CodeLLDB does not recognise `stopAtEntry` (that is a `cppdbg`/`cppvsdbg` property).  
→ Rename it to `stopOnEntry` in the `"type": "lldb"` configuration block.
