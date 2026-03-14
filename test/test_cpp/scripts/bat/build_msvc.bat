@echo off
rem build_msvc.bat — Configure and build with MSVC (Visual Studio)
rem Run from any directory; script locates itself automatically.
rem
rem If Visual Studio is installed in a non-default location, set VS_INSTALL_DIR
rem before calling this script:
rem   set "VS_INSTALL_DIR=D:\SoftWare\Microsoft Visual Studio\18\Community"
rem Leave empty ("") to let CMake auto-detect via vswhere.
if not defined VS_INSTALL_DIR set "VS_INSTALL_DIR=D:\SoftWare\Microsoft Visual Studio\18\Community"

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
    "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTALL_DIR%"

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
        "-DCMAKE_GENERATOR_INSTANCE=%VS_INSTALL_DIR%"
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
