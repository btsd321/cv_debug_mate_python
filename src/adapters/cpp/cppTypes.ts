/**
 * cppTypes.ts — C++ type detection patterns (Layer-1 quick detection).
 *
 * Maps C++ type name strings from the DAP `type` field to VisualizableKind.
 * Add patterns here as new C++ container/matrix types are supported.
 *
 * Expected type strings (from cppdbg / lldb DAP responses):
 *   - "cv::Mat"                   → image
 *   - "Eigen::Matrix<float,-1,-1>" → image / plot / pointcloud
 *   - "std::vector<double>"        → plot
 *   - "pcl::PointCloud<...>"       → pointcloud
 */

import { VisualizableKind } from "../IDebugAdapter";

// ── Pattern tables ────────────────────────────────────────────────────────

const IMAGE_TYPE_PATTERNS = [
    /\bcv::Mat\b/i,
    /\bcv2::Mat\b/i,
    /\bEigen::Matrix\b/,   // 2D matrix — refined in Layer 2 once shape known
    /\bEigen::Array\b/,    // 2D array — same
    // Nested std::array (2D or 3D image): std::array<std::array<...>>
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/,
    // C-style 2D/3D array: T[H][W] or T[H][W][C]
    /\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/,
];

// POINTCLOUD checked before PLOT so std::vector<cv::Point3f> → pointcloud, not plot
const POINTCLOUD_TYPE_PATTERNS = [
    /\bpcl::PointCloud\b/,
    /\bopen3d::geometry::PointCloud\b/,
    // std::vector / std::array of cv::Point3f / Point3d
    /std::(?:__1::)?(?:vector|array)\s*<[^>]*cv::Point3/,
];

const PLOT_TYPE_PATTERNS = [
    /\bstd::vector\b/,
    /\bEigen::Vector/,     // Eigen::VectorXf, VectorXd, etc.
    /\bstd::array\b/,
    /\bstd::deque\b/,
];

// ── Layer-1 detection ─────────────────────────────────────────────────────

/**
 * Quick detection from the raw DAP type string.
 * Returns "unknown" when no pattern matches.
 */
export function basicTypeDetect(typeStr: string): VisualizableKind {
    for (const pat of IMAGE_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            return "image";
        }
    }
    // Check pointcloud BEFORE plot: std::vector<cv::Point3f> must be pointcloud
    for (const pat of POINTCLOUD_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            return "pointcloud";
        }
    }
    for (const pat of PLOT_TYPE_PATTERNS) {
        if (pat.test(typeStr)) {
            return "plot";
        }
    }
    return "unknown";
}
