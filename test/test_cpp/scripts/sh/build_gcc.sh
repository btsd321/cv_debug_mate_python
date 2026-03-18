#!/usr/bin/env bash
# build_gcc.sh — Configure and build with GCC + Ninja (or Make)
# Run from any directory; script locates itself automatically.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${SOURCE_DIR}/build_gcc"

# Prefer ninja if available, fall-back to Unix Makefiles
if command -v ninja &>/dev/null; then
    GENERATOR="Ninja"
else
    GENERATOR="Unix Makefiles"
fi

VCPKG_ROOT="${HOME}/Library/vcpkg"
VCPKG_TOOLCHAIN="${VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"

# ── Clean switch ──────────────────────────────────────────────────────────
# Set to "ON" to wipe the build directory before configuring (full rebuild).
# Set to "OFF" for incremental build.
# CLEAN="ON"
CLEAN="ON"

if [[ "${CLEAN}" == "ON" ]]; then
    echo "[build_gcc] CLEAN=ON — removing build directory: ${BUILD_DIR}"
    rm -rf "${BUILD_DIR}"
fi

echo "[build_gcc] Configuring with ${GENERATOR}..."
cmake -S "${SOURCE_DIR}" -B "${BUILD_DIR}" \
    -G "${GENERATOR}" \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_C_COMPILER=gcc \
    -DCMAKE_CXX_COMPILER=g++ \
    -DCMAKE_TOOLCHAIN_FILE="${VCPKG_TOOLCHAIN}" \
    -DWITH_OPENCV=ON \
    -DWITH_EIGEN=ON

echo "[build_gcc] Building..."
cmake --build "${BUILD_DIR}" --parallel "$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)"

echo "[build_gcc] SUCCESS : ${BUILD_DIR}/demo"
