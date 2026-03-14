# C++ Test — Matrix Viewer Debug

## Files

| File | Purpose |
|------|---------|
| `demo.cpp` | Variables covering all supported C++ visualizable types |
| `CMakeLists.txt` | CMake project; auto-detects OpenCV and Eigen3 |
| `build_msvc.bat` | Build with MSVC (Visual Studio 2019/2022) |
| `build_gcc.sh` | Build with GCC |
| `build_llvm.sh` | Build with Clang/LLVM |
| `.vscode/launch.json` | Debug launch configs for all three toolchains |

## Prerequisites

| Toolchain | Requirements |
|-----------|-------------|
| MSVC | Visual Studio 2019 or 2022, CMake ≥ 3.16 |
| GCC | `gcc`, `g++`, `cmake`, optionally `ninja` |
| LLVM | `clang`, `clang++`, `cmake`, optionally `ninja` |

Optional libraries (tests gracefully skipped if not found):
- **OpenCV ≥ 4.x** — `cv::Mat`, `cv::Point3f` tests
- **Eigen3 ≥ 3.x** — `Eigen::MatrixXd`, `Eigen::VectorXd` tests

## Build

### Windows — MSVC
```bat
cd test\test_cpp
build_msvc.bat
```
Output: `build_msvc\Debug\demo.exe`

### Linux / macOS — GCC
```bash
cd test/test_cpp
chmod +x build_gcc.sh
./build_gcc.sh
```
Output: `build_gcc/demo`

### Linux / macOS — LLVM/Clang
```bash
cd test/test_cpp
chmod +x build_llvm.sh
./build_llvm.sh          # uses system clang/clang++
# Or specify a version:
CXX=clang++-18 CC=clang-18 ./build_llvm.sh
```
Output: `build_llvm/demo`

## Debug

1. Open `test/test_cpp/` as a VS Code workspace.
2. Set a breakpoint on the `volatile int bp = 0;` line in `demo.cpp`.
3. Select a launch configuration from `.vscode/launch.json`:
   - **MSVC / cppvsdbg** — Windows only, requires the C/C++ extension
   - **GCC / cppdbg + gdb** — Linux/macOS/WSL
   - **LLVM / cppdbg + lldb-mi** — Linux/macOS (lldb-mi must be on PATH)
   - **LLVM / CodeLLDB** — Linux/macOS (requires CodeLLDB extension)
4. Open the **Matrix Viewer** panel in the Debug sidebar.
5. Click any variable to open its viewer.

## Variables in demo.cpp

| Variable | Type | Expected Viewer |
|----------|------|----------------|
| `signal_1d` | `std::vector<double>` | Plot (1D) |
| `ramp_1d` | `std::vector<float>` | Plot (1D) |
| `arr_1d` | `std::array<double,64>` | Plot (1D) |
| `c_arr_1d` | `double[128]` | Plot (1D) |
| `std_gray` | `std::array<std::array<uint8_t,64>,64>` | Image (grayscale) |
| `c_gray` | `uint8_t[64][64]` | Image (grayscale) |
| `c_bgr` | `uint8_t[64][64][3]` | Image (BGR colour) |
| `mat_bgr` *(OpenCV)* | `cv::Mat` CV_8UC3 | Image (BGR) |
| `mat_gray` *(OpenCV)* | `cv::Mat` CV_8UC1 | Image (grayscale) |
| `mat_f32` *(OpenCV)* | `cv::Mat` CV_32FC1 | Image (float) |
| `cloud_xyz` *(OpenCV)* | `std::vector<cv::Point3f>` | Point Cloud |
| `eigen_mat` *(Eigen)* | `Eigen::MatrixXd` | Image / Plot |
| `eigen_vec` *(Eigen)* | `Eigen::VectorXd` | Plot (1D) |
