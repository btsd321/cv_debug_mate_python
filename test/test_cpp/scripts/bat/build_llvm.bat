@echo off
@echo off
rem build_llvm.bat -- Configure and build with Clang/LLVM + Ninja (Windows)
rem Run from any directory; script locates itself automatically.
rem
rem Prerequisites:
rem   winget install LLVM.LLVM
rem   winget install Ninja-build.Ninja
rem   VS Code extension: vadimcn.vscode-lldb  (CodeLLDB)
rem
rem Override compiler paths:
rem   set LLVM_ROOT=C:\Program Files\LLVM
rem   set VCPKG_ROOT=D:\Library\vcpkg

rem -- LLVM root ---------------------------------------------------------------
if not defined LLVM_ROOT (
    if exist "C:\Program Files\LLVM\bin\clang.exe" (
        set "LLVM_ROOT=C:\Program Files\LLVM"
    ) else if exist "C:\LLVM\bin\clang.exe" (
        set "LLVM_ROOT=C:\LLVM"
    ) else (
        where clang >nul 2>&1
        if errorlevel 1 (
            echo [build_llvm] ERROR: clang.exe not found.
            echo             Install LLVM:  winget install LLVM.LLVM
            exit /b 1
        )
        set "LLVM_ROOT="
    )
)

where ninja >nul 2>&1
if errorlevel 1 (
    echo [build_llvm] ERROR: ninja.exe not found.
    echo             Install Ninja:  winget install Ninja-build.Ninja
    exit /b 1
)

if not defined VCPKG_ROOT set "VCPKG_ROOT=D:\Library\vcpkg"
if not defined CMAKE_TOOLCHAIN_FILE (
    if exist "%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake" (
        set "CMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
    )
)

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
set "SOURCE_DIR=%SCRIPT_DIR%..\.."
set "BUILD_DIR=%SCRIPT_DIR%..\..\build_llvm"

if defined LLVM_ROOT (
    set "CC_COMPILER=%LLVM_ROOT%\bin\clang.exe"
    set "CXX_COMPILER=%LLVM_ROOT%\bin\clang++.exe"
) else (
    set "CC_COMPILER=clang"
    set "CXX_COMPILER=clang++"
)

set "RC_COMPILER="
if defined LLVM_ROOT (
    if exist "%LLVM_ROOT%\bin\llvm-rc.exe" set "RC_COMPILER=%LLVM_ROOT%\bin\llvm-rc.exe"
)
if not defined RC_COMPILER (
    where llvm-rc >nul 2>&1
    if not errorlevel 1 set "RC_COMPILER=llvm-rc"
)
if not defined RC_COMPILER (
    where rc >nul 2>&1
    if not errorlevel 1 set "RC_COMPILER=rc"
)
if not defined RC_COMPILER (
    echo [build_llvm] ERROR: No RC compiler found ^(llvm-rc.exe or rc.exe^).
    exit /b 1
)

rem CMake needs forward slashes (backslash is an escape in cmake strings)
set "RC_COMPILER_FWD=%RC_COMPILER:\=/%"

if exist "%BUILD_DIR%\CMakeCache.txt" del /f /q "%BUILD_DIR%\CMakeCache.txt"
if exist "%BUILD_DIR%\CMakeFiles"     rmdir /s /q "%BUILD_DIR%\CMakeFiles"

echo [build_llvm] Compiler : %CXX_COMPILER%
echo [build_llvm] RC       : %RC_COMPILER%
echo [build_llvm] Build dir: %BUILD_DIR%
echo [build_llvm] Configuring...

rem Use DWARF debug info (-gdwarf-4) instead of CodeView (-Xclang -gcodeview) so that
rem LLDB (used by CodeLLDB) can fully resolve C++ type information, including
rem complex types like cv::Mat that are opaque under PDB/CodeView parsing.
rem -fstandalone-debug embeds full type definitions instead of references,
rem which is necessary when types come from MSVC-compiled third-party headers.
cmake -S "%SOURCE_DIR%" -B "%BUILD_DIR%" -G "Ninja" -DCMAKE_BUILD_TYPE=Debug "-DCMAKE_CXX_COMPILER=%CXX_COMPILER%" "-DCMAKE_RC_COMPILER=%RC_COMPILER_FWD%" -DWITH_OPENCV=ON -DWITH_EIGEN=ON "-DCMAKE_TOOLCHAIN_FILE=%CMAKE_TOOLCHAIN_FILE%" "-DOpenCV_ROOT=%VCPKG_ROOT%\installed\x64-windows\share\opencv" "-DEigen3_DIR=%VCPKG_ROOT%\installed\x64-windows\share\eigen3" "-DPCL_DIR=%VCPKG_ROOT%\installed\x64-windows\share\pcl" "-DCMAKE_CXX_FLAGS_DEBUG=-O0 -gdwarf-4 -fstandalone-debug"

if errorlevel 1 (
    echo [build_llvm] Configure FAILED.
    exit /b 1
)

echo [build_llvm] Building...
cmake --build "%BUILD_DIR%" --parallel

if errorlevel 1 (
    echo [build_llvm] Build FAILED.
    exit /b 1
)

echo [build_llvm] SUCCESS: %BUILD_DIR%\demo.exe
echo.
echo To debug with CodeLLDB, add to .vscode/launch.json:
echo   {
echo     "type": "lldb",
echo     "request": "launch",
echo     "name": "C++ Demo (LLDB)",
echo     "program": "${workspaceFolder}/test/test_cpp/build_llvm/demo.exe"
echo   }
