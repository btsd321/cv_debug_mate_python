cmake_minimum_required(VERSION 3.16)
project(matrix_viewer_debug_cpp_test CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Debug build by default ────────────────────────────────────────────────
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Build type" FORCE)
endif()

# ── Optional dependencies ─────────────────────────────────────────────────
option(WITH_OPENCV "Build with OpenCV support" ON)
option(WITH_EIGEN  "Build with Eigen support"  ON)

set(EXTRA_DEFS)
set(EXTRA_LIBS)
set(EXTRA_INCLUDES)

if(WITH_OPENCV)
    find_package(OpenCV QUIET)
    if(OpenCV_FOUND)
        message(STATUS "OpenCV ${OpenCV_VERSION} found — HAVE_OPENCV enabled")
        list(APPEND EXTRA_DEFS  HAVE_OPENCV)
        list(APPEND EXTRA_LIBS  ${OpenCV_LIBS})
        list(APPEND EXTRA_INCLUDES ${OpenCV_INCLUDE_DIRS})
    else()
        message(WARNING "OpenCV not found — cv::Mat tests will be skipped")
    endif()
endif()

if(WITH_EIGEN)
    find_package(Eigen3 QUIET)
    if(Eigen3_FOUND)
        message(STATUS "Eigen3 ${Eigen3_VERSION} found — HAVE_EIGEN enabled")
        list(APPEND EXTRA_DEFS  HAVE_EIGEN)
        list(APPEND EXTRA_LIBS  Eigen3::Eigen)
    else()
        # Fallback: look for Eigen headers in common system paths
        find_path(EIGEN_INCLUDE_DIR
            NAMES Eigen/Dense
            PATHS
                /usr/include/eigen3
                /usr/local/include/eigen3
                /opt/homebrew/include/eigen3
                "C:/vcpkg/installed/x64-windows/include"
                "C:/vcpkg/installed/x64-windows-static/include"
        )
        if(EIGEN_INCLUDE_DIR)
            message(STATUS "Eigen3 headers found at ${EIGEN_INCLUDE_DIR} — HAVE_EIGEN enabled")
            list(APPEND EXTRA_DEFS    HAVE_EIGEN)
            list(APPEND EXTRA_INCLUDES ${EIGEN_INCLUDE_DIR})
        else()
            message(WARNING "Eigen3 not found — Eigen tests will be skipped")
        endif()
    endif()
endif()

# ── Executable ────────────────────────────────────────────────────────────
add_executable(demo demo.cpp)

target_compile_definitions(demo PRIVATE ${EXTRA_DEFS})
target_include_directories(demo PRIVATE ${EXTRA_INCLUDES})
target_link_libraries(demo PRIVATE ${EXTRA_LIBS})

# ── Compiler-specific flags ───────────────────────────────────────────────
if(MSVC)
    # /Zi  — full PDB debug info
    # /Od  — disable optimisations
    # /RTC1 — runtime checks (Debug only)
    target_compile_options(demo PRIVATE /Zi /Od /RTC1 /W4)
    # Ensure PDB is written even in Debug
    target_link_options(demo PRIVATE /DEBUG)
elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    target_compile_options(demo PRIVATE -g3 -O0 -Wall -Wextra)
else()   # GCC or other
    target_compile_options(demo PRIVATE -g3 -O0 -Wall -Wextra)
endif()

# ── Install (optional) ────────────────────────────────────────────────────
install(TARGETS demo RUNTIME DESTINATION bin)

message(STATUS "---------------------------------------------------")
message(STATUS "  Target:      demo")
message(STATUS "  Build type:  ${CMAKE_BUILD_TYPE}")
message(STATUS "  Compiler:    ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  OpenCV:      ${OpenCV_FOUND}")
message(STATUS "  Eigen3:      ${Eigen3_FOUND}")
message(STATUS "---------------------------------------------------")
