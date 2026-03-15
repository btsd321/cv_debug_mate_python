@echo off
rem build_msvc.bat — Configure and build with MSVC (Visual Studio)
rem Run from any directory; script locates itself automatically.
rem
rem If Visual Studio is installed in a non-default location, set VS_INSTALL_DIR
rem before calling this script:
rem   set "VS_INSTALL_DIR=D:\SoftWare\Microsoft Visual Studio\18\Community"
rem Leave empty ("") to let CMake auto-detect via vswhere.
if not defined VS_INSTALL_DIR set "VS_INSTALL_DIR=D:\SoftWare\Microsoft Visual Studio\18\Community"

rem vcpkg toolchain — auto-detected if CMAKE_TOOLCHAIN_FILE env var is set,
rem otherwise falls back to the path below. Set VCPKG_ROOT to override.
if not defined VCPKG_ROOT set "VCPKG_ROOT=D:\Library\vcpkg"
if not defined CMAKE_TOOLCHAIN_FILE (
    if exist "%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" (
        set "CMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
    )
)

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "SOURCE_DIR=%SCRIPT_DIR%..\.."
set "BUILD_DIR=%SCRIPT_DIR%..\..\build_msvc"

rem Remove stale CMake cache so generator/instance changes always apply cleanly
if exist "%BUILD_DIR%\CMakeCache.txt" del /f /q "%BUILD_DIR%\CMakeCache.txt"
if exist "%BUILD_DIR%\CMakeFiles"     rmdir /s /q "%BUILD_DIR%\CMakeFiles"

echo [build_msvc] Configuring...
cmake -S "%SOURCE_DIR%" -B "%BUILD_DIR%" ^
    -G "Visual Studio 18 2026" -A x64 ^
    -DCMAKE_BUILD_TYPE=Debug ^
    -DWITH_OPENCV=ON ^
    -DWITH_EIGEN=ON ^
    -DWITH_PCL=ON ^
    -DWITH_QT=ON ^
    "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTALL_DIR%" ^
    "-DCMAKE_TOOLCHAIN_FILE=%CMAKE_TOOLCHAIN_FILE%" ^
    "-DOpenCV_ROOT=%VCPKG_ROOT%\installed\x64-windows\share\opencv" ^
    "-DEigen3_DIR=%VCPKG_ROOT%\installed\x64-windows\share\eigen3" ^
    "-DPCL_DIR=%VCPKG_ROOT%\installed\x64-windows\share\pcl" ^
    "-DQt5_DIR=%VCPKG_ROOT%\installed\x64-windows\lib\cmake\Qt5"

if errorlevel 1 (
    echo [build_msvc] CMake configure FAILED. Trying VS 2022...
    if exist "%BUILD_DIR%\CMakeCache.txt" del /f /q "%BUILD_DIR%\CMakeCache.txt"
    if exist "%BUILD_DIR%\CMakeFiles"     rmdir /s /q "%BUILD_DIR%\CMakeFiles"
    cmake -S "%SOURCE_DIR%" -B "%BUILD_DIR%" ^
        -G "Visual Studio 17 2022" -A x64 ^
        -DCMAKE_BUILD_TYPE=Debug ^
        -DWITH_OPENCV=ON ^
        -DWITH_EIGEN=ON ^
        -DWITH_PCL=ON ^
        -DWITH_QT=ON ^
        "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTALL_DIR%" ^
        "-DCMAKE_TOOLCHAIN_FILE=%CMAKE_TOOLCHAIN_FILE%" ^
        "-DOpenCV_ROOT=%VCPKG_ROOT%\installed\x64-windows\share\opencv" ^
        "-DEigen3_DIR=%VCPKG_ROOT%\installed\x64-windows\share\eigen3" ^
        "-DPCL_DIR=%VCPKG_ROOT%\installed\x64-windows\share\pcl" ^
        "-DQt5_DIR=%VCPKG_ROOT%\installed\x64-windows\lib\cmake\Qt5"
)

if errorlevel 1 (
    echo [build_msvc] Configure failed. Make sure Visual Studio is installed.
    exit /b 1
)

echo [build_msvc] Building...
cmake --build "%BUILD_DIR%" --config Debug --parallel

if errorlevel 1 (
    echo [build_msvc] Build FAILED.
    exit /b 1
)

echo [build_msvc] SUCCESS: %BUILD_DIR%\Debug\demo.exe
