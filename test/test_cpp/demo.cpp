/**
 * demo.cpp — Matrix Viewer Debug: C++ variable visualization demo
 * ================================================================
 * Build with CMake and launch under a debugger (cppdbg / CodeLLDB / cppvsdbg).
 * Set a breakpoint on the volatile-read line at the bottom, then open the
 * "Matrix Viewer" panel in the Debug sidebar and click any variable.
 *
 * Supported types exercised here:
 *
 *   cv::Mat                             → Image Viewer (BGR / GRAY)
 *   std::vector<double>                 → Plot Viewer  (1D)
 *   std::vector<cv::Point3f>            → Point Cloud Viewer
 *   std::array<double, N>               → Plot Viewer  (1D)
 *   std::array<std::array<uint8_t,W>,H> → Image Viewer (2D greyscale)
 *   T[N]  C-style array                 → Plot Viewer  (1D)
 *   T[H][W]                             → Image Viewer (2D)
 *   T[H][W][C]                          → Image Viewer (2D colour)
 *
 * Dependencies (all optional — missing libs are guarded by #ifdef):
 *   OpenCV  ≥ 4.x   (HAVE_OPENCV)
 *   Eigen   ≥ 3.x   (HAVE_EIGEN)
 */

#include <cmath>
#include <vector>
#include <array>
#include <cstdint>

#ifdef HAVE_OPENCV
#  include <opencv2/core.hpp>
#  include <opencv2/imgcodecs.hpp>
#  include <opencv2/imgproc.hpp>
#endif

#ifdef HAVE_EIGEN
#  include <Eigen/Dense>
#endif

// ── Helpers ───────────────────────────────────────────────────────────────

static constexpr int N    = 512;   // 1-D signal length
static constexpr int M    = 2048;  // point cloud size
static constexpr int ROWS = 64;    // small image height
static constexpr int COLS = 64;    // small image width

static float lerp(float t) { return t; }  // quiet unused warnings

int main()
{
    // =========================================================================
    // std::vector<double>  →  1D Plot Viewer
    // =========================================================================
    std::vector<double> signal_1d(N);
    for (int i = 0; i < N; ++i) {
        double t = i * 4.0 * 3.14159265 / N;
        signal_1d[i] = std::sin(t) + 0.5 * std::sin(3.0 * t);
    }

    std::vector<float> ramp_1d(N);
    for (int i = 0; i < N; ++i) {
        ramp_1d[i] = static_cast<float>(i);
    }

    // =========================================================================
    // std::vector<float> with 2 columns (Nx2, as pairs)  →  2D Scatter
    // (stored as interleaved x,y — viewer reads col-0=X col-1=Y)
    // =========================================================================
    std::vector<float> scatter_circle(300 * 2);
    for (int i = 0; i < 300; ++i) {
        double a = i * 2.0 * 3.14159265 / 300;
        scatter_circle[i * 2 + 0] = static_cast<float>(std::cos(a));
        scatter_circle[i * 2 + 1] = static_cast<float>(std::sin(a));
    }

    // =========================================================================
    // std::vector<cv::Point3f>  →  Point Cloud Viewer
    // =========================================================================
#ifdef HAVE_OPENCV
    std::vector<cv::Point3f> cloud_xyz;
    cloud_xyz.reserve(M);
    for (int i = 0; i < M; ++i) {
        float phi   = static_cast<float>(i) * 3.14159f / M;
        float theta = static_cast<float>(i) * 6.28318f / M;
        cloud_xyz.push_back({
            std::sin(phi) * std::cos(theta),
            std::sin(phi) * std::sin(theta),
            std::cos(phi)
        });
    }
#endif

    // =========================================================================
    // std::array<double, N>  →  1D Plot Viewer
    // =========================================================================
    std::array<double, 64> arr_1d{};
    for (int i = 0; i < 64; ++i) {
        arr_1d[static_cast<std::size_t>(i)] = std::sin(i * 0.2);
    }

    // =========================================================================
    // C-style 1D array  →  1D Plot Viewer
    // =========================================================================
    double c_arr_1d[128]{};
    for (int i = 0; i < 128; ++i) {
        c_arr_1d[i] = std::cos(i * 0.1);
    }

    // =========================================================================
    // std::array<std::array<uint8_t, COLS>, ROWS>  →  Image Viewer (greyscale)
    // =========================================================================
    std::array<std::array<uint8_t, COLS>, ROWS> std_gray{};
    for (int r = 0; r < ROWS; ++r) {
        for (int c = 0; c < COLS; ++c) {
            std_gray[static_cast<std::size_t>(r)][static_cast<std::size_t>(c)] =
                static_cast<uint8_t>((r + c) * 2 % 256);
        }
    }

    // =========================================================================
    // C-style 2D array  →  Image Viewer (greyscale)
    // =========================================================================
    uint8_t c_gray[ROWS][COLS]{};
    for (int r = 0; r < ROWS; ++r)
        for (int c = 0; c < COLS; ++c)
            c_gray[r][c] = static_cast<uint8_t>((r * COLS + c) % 256);

    // =========================================================================
    // C-style 3D array  →  Image Viewer (BGR colour)
    // =========================================================================
    uint8_t c_bgr[ROWS][COLS][3]{};
    for (int r = 0; r < ROWS; ++r) {
        for (int c = 0; c < COLS; ++c) {
            c_bgr[r][c][0] = static_cast<uint8_t>(c * 4);          // B
            c_bgr[r][c][1] = static_cast<uint8_t>(r * 4);          // G
            c_bgr[r][c][2] = static_cast<uint8_t>((r + c) * 2 % 256); // R
        }
    }

    // =========================================================================
    // cv::Mat  →  Image Viewer
    // =========================================================================
#ifdef HAVE_OPENCV
    // Load real image if available, otherwise synthesise one
    cv::Mat mat_bgr  = cv::Mat::zeros(ROWS, COLS, CV_8UC3);
    cv::Mat mat_gray = cv::Mat::zeros(ROWS, COLS, CV_8UC1);
    cv::Mat mat_f32  = cv::Mat::zeros(ROWS, COLS, CV_32FC1);

    for (int r = 0; r < ROWS; ++r) {
        for (int c = 0; c < COLS; ++c) {
            mat_bgr.at<cv::Vec3b>(r, c) = {
                static_cast<uchar>(c * 4),
                static_cast<uchar>(r * 4),
                static_cast<uchar>((r + c) * 2 % 256)
            };
            mat_gray.at<uchar>(r, c) = static_cast<uchar>((r + c) * 2 % 256);
            mat_f32.at<float>(r, c)  = static_cast<float>(r * COLS + c) / (ROWS * COLS);
        }
    }
#endif

    // =========================================================================
    // Eigen matrices  →  Image / Plot Viewer
    // =========================================================================
#ifdef HAVE_EIGEN
    Eigen::MatrixXd eigen_mat(ROWS, COLS);
    for (int r = 0; r < ROWS; ++r)
        for (int c = 0; c < COLS; ++c)
            eigen_mat(r, c) = std::sin(r * 0.3) * std::cos(c * 0.3);

    Eigen::VectorXd eigen_vec(N);
    for (int i = 0; i < N; ++i)
        eigen_vec(i) = std::sin(i * 0.05);
#endif

    // =========================================================================
    // BREAKPOINT — open Matrix Viewer panel and click any variable above
    // =========================================================================
    volatile int bp = 0; (void)bp;  // <— set breakpoint here
    (void)lerp(0);

    return 0;
}
