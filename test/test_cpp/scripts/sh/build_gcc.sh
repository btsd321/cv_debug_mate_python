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

# Remove stale cache so CMAKE_TOOLCHAIN_FILE takes effect
if [[ -f "${BUILD_DIR}/CMakeCache.txt" ]]; then
    echo "[build_gcc] Removing stale CMakeCache.txt ..."
    rm -f "${BUILD_DIR}/CMakeCache.txt"
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
