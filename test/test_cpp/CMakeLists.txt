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
option(WITH_PCL    "Build with PCL support"    ON)
option(WITH_QT     "Build with Qt5 support"    ON)

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

if(WITH_PCL)
    find_package(PCL QUIET COMPONENTS common)
    if(PCL_FOUND)
        message(STATUS "PCL ${PCL_VERSION} found — HAVE_PCL enabled")
        list(APPEND EXTRA_DEFS     HAVE_PCL)
        list(APPEND EXTRA_LIBS     ${PCL_LIBRARIES})
        list(APPEND EXTRA_INCLUDES ${PCL_INCLUDE_DIRS})
        # Suppress noisy PCL deprecation warnings on MSVC
        if(MSVC)
            list(APPEND EXTRA_DEFS _SILENCE_ALL_CXX17_DEPRECATION_WARNINGS)
        endif()
    else()
        message(WARNING "PCL not found — pcl::PointCloud tests will be skipped")
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

if(WITH_QT)
    # Disable Qt meta-object compiler — we don't use Q_OBJECT in this demo
    set(CMAKE_AUTOMOC OFF)
    # Try Qt6 first, fall back to Qt5
    find_package(Qt6 QUIET COMPONENTS Core Gui)
    if(Qt6_FOUND)
        message(STATUS "Qt6 ${Qt6_VERSION} found — HAVE_QT enabled")
        list(APPEND EXTRA_DEFS  HAVE_QT)
        list(APPEND EXTRA_LIBS  Qt6::Core Qt6::Gui)
    else()
        find_package(Qt5 QUIET COMPONENTS Core Gui)
        if(Qt5_FOUND)
            message(STATUS "Qt5 ${Qt5_VERSION} found — HAVE_QT enabled")
            list(APPEND EXTRA_DEFS  HAVE_QT)
            list(APPEND EXTRA_LIBS  Qt5::Core Qt5::Gui)
        else()
            message(WARNING "Qt6/Qt5 not found — Qt tests will be skipped")
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
    # /utf-8 — source and execution charset UTF-8
    # /Zi   — full PDB debug info
    # /Od   — disable optimisations
    # /RTC1 — runtime checks (Debug only)
    target_compile_options(demo PRIVATE /utf-8 /Zi /Od /RTC1 /W4)
    # Ensure PDB is written even in Debug
    target_link_options(demo PRIVATE /DEBUG)
elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    # -gdwarf-4: emit DWARF (not CodeView) so CodeLLDB/LLDB can resolve type info
    # -fstandalone-debug: embed full type definitions, needed for types from
    #   MSVC-compiled third-party headers (OpenCV, PCL, Eigen)
    target_compile_options(demo PRIVATE -gdwarf-4 -fstandalone-debug -O0 -Wall -Wextra)
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
message(STATUS "  PCL:         ${PCL_FOUND}")
message(STATUS "  Qt6:         ${Qt6_FOUND}")
message(STATUS "  Qt5:         ${Qt5_FOUND}")
message(STATUS "---------------------------------------------------")
