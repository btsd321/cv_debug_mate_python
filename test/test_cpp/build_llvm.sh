#!/usr/bin/env bash
# build_llvm.sh — Configure and build with Clang/LLVM + Ninja (or Make)
# Run from any directory; script locates itself automatically.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build_llvm"

# Prefer ninja if available, fall-back to Unix Makefiles
if command -v ninja &>/dev/null; then
    GENERATOR="Ninja"
else
    GENERATOR="Unix Makefiles"
fi

# Allow override via environment: CC=clang-18 CXX=clang++-18 ./build_llvm.sh
CC_COMPILER="${CC:-clang}"
CXX_COMPILER="${CXX:-clang++}"

echo "[build_llvm] Configuring with ${GENERATOR} (${CXX_COMPILER})..."
cmake -S "${SCRIPT_DIR}" -B "${BUILD_DIR}" \
    -G "${GENERATOR}" \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_C_COMPILER="${CC_COMPILER}" \
    -DCMAKE_CXX_COMPILER="${CXX_COMPILER}" \
    -DWITH_OPENCV=ON \
    -DWITH_EIGEN=ON

echo "[build_llvm] Building..."
cmake --build "${BUILD_DIR}" --parallel "$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)"

echo "[build_llvm] SUCCESS  →  ${BUILD_DIR}/demo"
