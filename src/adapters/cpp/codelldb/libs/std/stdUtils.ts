/**
 * stdUtils.ts — Type detection helpers for C++ standard library types.
 *
 * Pure functions only — no VS Code API, no async, no DAP calls.
 * Used by StdPlotProvider, StdImageProvider, StdPointCloudProvider,
 * and cppTypes.ts (Layer-1 detection).
 *
 * Supported container families:
 *   1D (plot):   std::vector<T>, std::array<T,N>, std::set<T>, T[N]
 *   2D (image):  std::array<std::array<T,W>,H>, T[H][W]
 *   3D (image):  std::array<std::array<std::array<T,C>,W>,H>, T[H][W][C]
 *   point cloud: std::vector<cv::Point3f/d>, std::array<cv::Point3f/d,N>
 */

// ── Basic numeric types ───────────────────────────────────────────────────

const BASIC_NUMERIC_SET = new Set([
    "int", "float", "double",
    "char", "unsigned char", "uchar",
    "short", "unsigned short", "ushort",
    "long", "unsigned long",
    "long long", "unsigned long long",
    "int8_t", "uint8_t",
    "int16_t", "uint16_t",
    "int32_t", "uint32_t",
    "int64_t", "uint64_t",
    "size_t",
]);

export function isBasicNumericType(elementType: string): boolean {
    const t = elementType.trim();
    if (BASIC_NUMERIC_SET.has(t)) { return true; }
    if (t.startsWith("class ") && BASIC_NUMERIC_SET.has(t.slice(6))) { return true; }
    if (t.startsWith("struct ") && BASIC_NUMERIC_SET.has(t.slice(7))) { return true; }
    const withoutSigned = t.replace(/^signed\s+/, "").trim();
    if (BASIC_NUMERIC_SET.has(withoutSigned)) { return true; }
    return false;
}

// ── 1D container detection ────────────────────────────────────────────────

/**
 * Returns the numeric element type if typeStr is `std::vector<T>` where T is numeric.
 * Note: std::vector<cv::Point3f/d> is excluded (handled by isPoint3Vector).
 */
export function is1DVector(typeStr: string): { is1D: boolean; elementType: string } {
    // Exclude Point3 vectors — those are point clouds
    if (/cv::Point3/.test(typeStr)) {
        return { is1D: false, elementType: "" };
    }
    const m = typeStr.match(
        /std::(?:__1::)?vector\s*<\s*([^,>]+?)\s*(?:,\s*[^>]+)?\s*>/
    );
    if (m) {
        const et = m[1].trim();
        if (isBasicNumericType(et)) {
            return { is1D: true, elementType: et };
        }
    }
    return { is1D: false, elementType: "" };
}

/**
 * Returns element type and size if typeStr is a 1-level `std::array<T, N>`
 * where T is numeric.  Nested arrays and cv::Point3 arrays are excluded.
 */
export function is1DStdArray(typeStr: string): {
    is1D: boolean;
    elementType: string;
    size: number;
} {
    // Exclude nested arrays (2D+)
    if (
        /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/.test(typeStr)
    ) {
        return { is1D: false, elementType: "", size: 0 };
    }
    // Exclude cv::Point3 arrays
    if (/std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3/.test(typeStr)) {
        return { is1D: false, elementType: "", size: 0 };
    }
    const m = typeStr.match(
        /std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>/
    );
    if (m) {
        const et = m[1].trim();
        if (isBasicNumericType(et)) {
            return { is1D: true, elementType: et, size: parseInt(m[2]) };
        }
    }
    return { is1D: false, elementType: "", size: 0 };
}

/**
 * Returns element type if typeStr is `std::set<T>` or `std::multiset<T>`
 * where T is numeric.
 */
export function is1DSet(typeStr: string): { isSet: boolean; elementType: string } {
    const m = typeStr.match(
        /std::(?:__1::)?(?:multi)?set\s*<\s*([^,>]+?)\s*(?:,.*)?>/
    );
    if (m) {
        const et = m[1].trim();
        if (isBasicNumericType(et)) {
            return { isSet: true, elementType: et };
        }
    }
    return { isSet: false, elementType: "" };
}

/**
 * Returns element type and size if typeStr is a C-style 1D array `T [N]`.
 * 2D+ arrays (T[H][W]) are excluded.
 */
export function is1DCStyleArray(typeStr: string): {
    is1DArray: boolean;
    elementType: string;
    size: number;
} {
    // Exclude 2D+ arrays
    if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(typeStr)) {
        return { is1DArray: false, elementType: "", size: 0 };
    }
    const m = typeStr.match(
        /([a-zA-Z_][a-zA-Z0-9_ ]*?)\s*\[\s*(\d+)\s*\]/
    );
    if (m) {
        const et = m[1].trim();
        if (isBasicNumericType(et)) {
            return { is1DArray: true, elementType: et, size: parseInt(m[2]) };
        }
    }
    return { is1DArray: false, elementType: "", size: 0 };
}

// ── 2D/3D image container detection ──────────────────────────────────────

/**
 * Returns dimensions if typeStr is `std::array<std::array<T, W>, H>`.
 */
export function is2DStdArray(typeStr: string): {
    is2DArray: boolean;
    rows: number;
    cols: number;
    elementType: string;
} {
    // Exclude 3D arrays (3-level nested)
    if (
        /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array/.test(
            typeStr
        )
    ) {
        return { is2DArray: false, rows: 0, cols: 0, elementType: "" };
    }
    const m = typeStr.match(
        /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>/
    );
    if (m) {
        return {
            is2DArray: true,
            rows: parseInt(m[3]),
            cols: parseInt(m[2]),
            elementType: m[1].trim(),
        };
    }
    return { is2DArray: false, rows: 0, cols: 0, elementType: "" };
}

/**
 * Returns dimensions if typeStr is `std::array<std::array<std::array<T, C>, W>, H>`.
 * Only valid when C ∈ {1, 3, 4}.
 */
export function is3DStdArray(typeStr: string): {
    is3DArray: boolean;
    height: number;
    width: number;
    channels: number;
    elementType: string;
} {
    const m = typeStr.match(
        /std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*(?:class\s+)?std::(?:__1::)?array\s*<\s*([^,>]+?)\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>\s*,\s*(\d+)\s*>/
    );
    if (m) {
        const channels = parseInt(m[2]);
        if (channels !== 1 && channels !== 3 && channels !== 4) {
            return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "" };
        }
        return {
            is3DArray: true,
            height: parseInt(m[4]),
            width: parseInt(m[3]),
            channels,
            elementType: m[1].trim(),
        };
    }
    return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "" };
}

/**
 * Returns dimensions if typeStr is a C-style 2D array `T[H][W]`.
 * 3D+ arrays are excluded.
 */
export function is2DCStyleArray(typeStr: string): {
    is2DArray: boolean;
    rows: number;
    cols: number;
    elementType: string;
} {
    // Exclude 3D+ arrays
    if (/\[\s*\d+\s*\]\s*\[\s*\d+\s*\]\s*\[\s*\d+\s*\]/.test(typeStr)) {
        return { is2DArray: false, rows: 0, cols: 0, elementType: "" };
    }
    const m = typeStr.match(
        /([a-zA-Z_][a-zA-Z0-9_ ]*?)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/
    );
    if (m) {
        return {
            is2DArray: true,
            rows: parseInt(m[2]),
            cols: parseInt(m[3]),
            elementType: m[1].trim(),
        };
    }
    return { is2DArray: false, rows: 0, cols: 0, elementType: "" };
}

/**
 * Returns dimensions if typeStr is a C-style 3D array `T[H][W][C]`.
 * Only valid when C ∈ {1, 3, 4}.
 */
export function is3DCStyleArray(typeStr: string): {
    is3DArray: boolean;
    height: number;
    width: number;
    channels: number;
    elementType: string;
} {
    const m = typeStr.match(
        /([a-zA-Z_][a-zA-Z0-9_ ]*?)\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]\s*\[\s*(\d+)\s*\]/
    );
    if (m) {
        const channels = parseInt(m[4]);
        if (channels !== 1 && channels !== 3 && channels !== 4) {
            return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "" };
        }
        return {
            is3DArray: true,
            height: parseInt(m[2]),
            width: parseInt(m[3]),
            channels,
            elementType: m[1].trim(),
        };
    }
    return { is3DArray: false, height: 0, width: 0, channels: 0, elementType: "" };
}

// ── Point cloud container detection ──────────────────────────────────────

/**
 * Returns true if typeStr is `std::vector<cv::Point3f>` or
 * `std::vector<cv::Point3d>` (including Point3_<float/double> variants).
 */
export function isPoint3Vector(typeStr: string): {
    isPoint3: boolean;
    isDouble: boolean;
} {
    const isDouble =
        /std::(?:__1::)?vector\s*<\s*(?:class\s+)?cv::Point3d\s*>/.test(typeStr) ||
        /std::(?:__1::)?vector\s*<\s*(?:class\s+)?cv::Point3_\s*<\s*double\s*>/.test(typeStr);
    const isFloat =
        /std::(?:__1::)?vector\s*<\s*(?:class\s+)?cv::Point3f\s*>/.test(typeStr) ||
        /std::(?:__1::)?vector\s*<\s*(?:class\s+)?cv::Point3_\s*<\s*float\s*>/.test(typeStr);
    return { isPoint3: isDouble || isFloat, isDouble };
}

/**
 * Returns true if typeStr is `std::array<cv::Point3f, N>` or
 * `std::array<cv::Point3d, N>`.
 */
export function isPoint3StdArray(typeStr: string): {
    isPoint3: boolean;
    isDouble: boolean;
    size: number;
} {
    const dm =
        typeStr.match(
            /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3d\s*,\s*(\d+)\s*>/
        ) ??
        typeStr.match(
            /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3_\s*<\s*double\s*>\s*,\s*(\d+)\s*>/
        );
    if (dm) { return { isPoint3: true, isDouble: true, size: parseInt(dm[1]) }; }

    const fm =
        typeStr.match(
            /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3f\s*,\s*(\d+)\s*>/
        ) ??
        typeStr.match(
            /std::(?:__1::)?array\s*<\s*(?:class\s+)?cv::Point3_\s*<\s*float\s*>\s*,\s*(\d+)\s*>/
        );
    if (fm) { return { isPoint3: true, isDouble: false, size: parseInt(fm[1]) }; }

    return { isPoint3: false, isDouble: false, size: 0 };
}
