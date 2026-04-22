/**
 * ros2Utils.ts — Helpers exclusive to ROS 2 message visualisation (GDB only).
 *
 * Scope:
 *   - Encoding string → (channels, dtype, format, bytesPerChannel) mapping for sensor_msgs::msg::Image
 *   - PointField datatype enum constants for sensor_msgs::msg::PointCloud2
 *   - std::string field reading via the GDB evaluate context
 *
 * All functions here are specific to ROS 2 messages and must NOT be moved to
 * shared/utils.ts.
 */

import * as vscode from "vscode";
import { ImageFormat } from "../../../../../viewers/viewerTypes";
import { evaluateExpression } from "../../debugger";

// ── ROS 2 type-name predicates ────────────────────────────────────────────

/** True if `typeName` is `sensor_msgs::msg::Image_<...>` (any allocator). */
export function isRos2Image(typeName: string): boolean {
    return /\bsensor_msgs::msg::Image_\b/.test(typeName);
}

/** True if `typeName` is `sensor_msgs::msg::PointCloud2_<...>` (any allocator). */
export function isRos2PointCloud2(typeName: string): boolean {
    return /\bsensor_msgs::msg::PointCloud2_\b/.test(typeName);
}

// ── Image encoding mapping ────────────────────────────────────────────────

export interface Ros2ImageEncoding {
    channels: number;
    /** Numpy-style dtype: uint8, int8, uint16, int16, float32, float64 */
    dtype: string;
    /** Bytes per channel (1, 2, 4, or 8). */
    bytesPerChannel: number;
    format: ImageFormat;
}

/**
 * Map a ROS 2 image encoding string (e.g. "rgb8", "32FC3", "mono16") to
 * channel count / dtype / display format.
 *
 * Returns null for unsupported encodings (bayer patterns, YUV, etc.).
 *
 * Reference: sensor_msgs/image_encodings.hpp
 */
export function decodeRos2Encoding(enc: string): Ros2ImageEncoding | null {
    const e = enc.trim().toLowerCase();

    // Named encodings
    const NAMED: Record<string, Ros2ImageEncoding> = {
        mono8:  { channels: 1, dtype: "uint8",  bytesPerChannel: 1, format: "GRAY" },
        mono16: { channels: 1, dtype: "uint16", bytesPerChannel: 2, format: "GRAY" },
        rgb8:   { channels: 3, dtype: "uint8",  bytesPerChannel: 1, format: "RGB"  },
        rgba8:  { channels: 4, dtype: "uint8",  bytesPerChannel: 1, format: "RGBA" },
        bgr8:   { channels: 3, dtype: "uint8",  bytesPerChannel: 1, format: "BGR"  },
        bgra8:  { channels: 4, dtype: "uint8",  bytesPerChannel: 1, format: "BGRA" },
        rgb16:  { channels: 3, dtype: "uint16", bytesPerChannel: 2, format: "RGB"  },
        rgba16: { channels: 4, dtype: "uint16", bytesPerChannel: 2, format: "RGBA" },
        bgr16:  { channels: 3, dtype: "uint16", bytesPerChannel: 2, format: "BGR"  },
        bgra16: { channels: 4, dtype: "uint16", bytesPerChannel: 2, format: "BGRA" },
    };
    if (NAMED[e]) {
        return NAMED[e];
    }

    // OpenCV-style "{bits}{S|U|F}C{n}" e.g. "8UC1", "32FC3", "16SC1"
    const m = /^(\d+)([usf])c(\d+)$/i.exec(e);
    if (m) {
        const bits = parseInt(m[1], 10);
        const sign = m[2].toLowerCase();
        const channels = parseInt(m[3], 10);
        if (channels < 1 || channels > 4) {
            return null;
        }
        let dtype: string | null = null;
        const bytesPerChannel = bits / 8;
        if (sign === "u" && bits === 8)  { dtype = "uint8"; }
        else if (sign === "s" && bits === 8)  { dtype = "int8"; }
        else if (sign === "u" && bits === 16) { dtype = "uint16"; }
        else if (sign === "s" && bits === 16) { dtype = "int16"; }
        else if (sign === "s" && bits === 32) { dtype = "int32"; }
        else if (sign === "f" && bits === 32) { dtype = "float32"; }
        else if (sign === "f" && bits === 64) { dtype = "float64"; }
        if (!dtype) {
            return null;
        }
        // Convention: cv::Mat-style multi-channel encodings are typically BGR(A) order.
        const format: ImageFormat =
            channels === 1 ? "GRAY" :
            channels === 4 ? "BGRA" :
            channels === 3 ? "BGR"  :
            "GRAY"; // 2-channel falls back to GRAY (uncommon)
        return { channels, dtype, bytesPerChannel, format };
    }

    return null;
}

// ── PointField datatype constants (from sensor_msgs/msg/PointField) ──────

export const POINTFIELD_INT8     = 1;
export const POINTFIELD_UINT8    = 2;
export const POINTFIELD_INT16    = 3;
export const POINTFIELD_UINT16   = 4;
export const POINTFIELD_INT32    = 5;
export const POINTFIELD_UINT32   = 6;
export const POINTFIELD_FLOAT32  = 7;
export const POINTFIELD_FLOAT64  = 8;

export interface Ros2PointField {
    name: string;
    offset: number;
    datatype: number;
    count: number;
}

// ── std::string reading via evaluate ──────────────────────────────────────

/**
 * Read a `std::string` field on the current frame via GDB evaluate.
 *
 * GDB typically prints std::string as `"hello"` (with surrounding double
 * quotes and possibly an `0x… ` prefix). Strip them and unescape minimal
 * sequences. Returns null on failure.
 */
export async function readStdString(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<string | null> {
    const raw = await evaluateExpression(session, expr, frameId);
    if (raw == null) {
        return null;
    }
    return parseEvaluatedString(raw);
}

/**
 * Strip GDB / lldb decorations from an evaluated string result.
 *
 * Examples of inputs handled:
 *   `"rgb8"`                       → rgb8
 *   `0x7ffe1234 "rgb8"`            → rgb8
 *   `{_M_dataplus = ..., "rgb8"}`  → rgb8
 *   `rgb8`                         → rgb8
 */
export function parseEvaluatedString(raw: string): string | null {
    const s = raw.trim();
    if (!s) {
        return null;
    }
    // Find first quoted region
    const m = /"((?:[^"\\]|\\.)*)"/.exec(s);
    if (m) {
        return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    // Plain identifier-like result
    if (/^[A-Za-z0-9_-]+$/.test(s)) {
        return s;
    }
    return null;
}
