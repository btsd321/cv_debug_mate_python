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
import { unwrapSmartPointer } from "./shared/utils";

// ── Pattern tables ────────────────────────────────────────────────────────

const IMAGE_TYPE_PATTERNS = [
    /\bcv::Mat\b/i,
    /\bcv2::Mat\b/i,
    // Eigen::Matrix — exclude column vectors (Cols=1) and row vectors (Rows=1).
    // GDB expands VectorXd → Matrix<double,-1,1,0,-1,1> which would otherwise
    // match here and be misclassified as image instead of plot.
    /\bEigen::Matrix(?!<[^,]+,\s*1[\s,])(?!<[^,]+,[^,]+,\s*1[\s,>])/,
    // Eigen::Array — same exclusion for 1-column/1-row arrays
    /\bEigen::Array(?!<[^,]+,\s*1[\s,])(?!<[^,]+,[^,]+,\s*1[\s,>])/,
    // Nested std::array (2D or 3D image): std::array<std::array<...>>
    /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/,
    // C-style 2D/3D array: T[H][W] or T[H][W][C]
    /\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/,
    // Qt image: QImage (Qt5 / Qt6)
    /\bQImage\b/,
];

// POINTCLOUD checked before PLOT so std::vector<cv::Point3f> → pointcloud, not plot
const POINTCLOUD_TYPE_PATTERNS = [
    /\bpcl::PointCloud\b/,
    /\bopen3d::geometry::PointCloud\b/,
    // std::vector / std::array of cv::Point3f / Point3d
    /std::(?:__1::)?(?:vector|array)\s*<[^>]*cv::Point3/,
    // Qt: QVector<QVector3D> or QList<QVector3D> (Qt5/Qt6)
    /Q(?:Vector|List)\s*<\s*QVector3D\s*>/,
];

const PLOT_TYPE_PATTERNS = [
    /\bstd::vector\b/,
    /\bEigen::Vector/,     // Eigen::VectorXf, VectorXd, etc.
    // GDB expands VectorXd → Matrix<double,-1,1,...>; match column/row vectors
    /\bEigen::Matrix<[^,]+,[^,]+,\s*1[\s,>]/,   // Cols=1 (column vector)
    /\bEigen::Matrix<[^,]+,\s*1[\s,]/,           // Rows=1 (row vector)
    /\bEigen::Array<[^,]+,[^,]+,\s*1[\s,>]/,    // 1D Array (Cols=1)
    /\bEigen::Array<[^,]+,\s*1[\s,]/,            // 1D Array (Rows=1)
    /\bstd::array\b/,
    /\bstd::deque\b/,
    // C-style 1D numeric arrays: double[128], int[64], etc.
    // Exclude 2D arrays (T[H][W]) which are handled by IMAGE_TYPE_PATTERNS.
    /^(?!.*\[\s*\d+\s*\]\s*\[\s*\d+\s*\])[a-zA-Z_][a-zA-Z0-9_ ]*\s*\[\s*\d+\s*\]$/,
    // Qt 1D / 2D numeric containers (Qt5/Qt6):
    //   QVector<float>, QList<int>, QPolygonF, QVector<QVector2D>, QList<QVector2D>
    /\bQ(?:Vector|List)\s*<[^>]+>/,
    /\bQPolygonF\b/,
    // Bare Qt containers — GDB sometimes omits the template argument entirely,
    // reporting "QVector" instead of "QVector<float>" or "QVector<QVector2D>".
    // Classify tentatively as "plot"; Layer-2 enrichment in cppAdapter will
    // reconstruct the full type from the variable's first indexed child.
    /\bQ(?:Vector|List)\b/,
];

// ── Layer-1 detection ─────────────────────────────────────────────────────

/**
 * Quick detection from the raw DAP type string.
 * Returns "unknown" when no pattern matches.
 *
 * Handles smart-pointer wrappers transparently:
 *   std::shared_ptr<cv::Mat>    → "image"
 *   std::unique_ptr<std::vector<double>> → "plot"
 *   QSharedPointer<QImage>      → "image"
 */
export function basicTypeDetect(typeStr: string): VisualizableKind {
    // Unwrap smart pointer / raw C pointer and re-run detection on inner type
    const unwrapped = unwrapSmartPointer(typeStr);
    if (unwrapped !== null) {
        return basicTypeDetect(unwrapped.innerType);
    }

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
