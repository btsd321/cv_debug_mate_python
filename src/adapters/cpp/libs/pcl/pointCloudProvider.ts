/**
 * pcl/pointCloudProvider.ts — PointCloudData from pcl::PointCloud (C++ / cppdbg).
 *
 * Supported types:
 *   pcl::PointCloud<pcl::PointXYZ>      → XYZ only     (stride 16 bytes)
 *   pcl::PointCloud<pcl::PointXYZRGB>   → XYZ + RGB    (stride 32 bytes)
 *   pcl::PointCloud<pcl::PointXYZRGBA>  → XYZ + RGBA   (stride 32 bytes)
 *   pcl::PointCloud<pcl::PointXYZI>     → XYZ + intensity (stride 16 bytes)
 *
 * pcl::PointCloud<PointT> layout summary:
 *   std::vector<PointT> points;  ← the actual data array
 *   uint32_t width, height;
 *
 * Per-point memory layout (SSE-aligned structs):
 *   PointXYZ   : 16 bytes → float x,y,z at offsets 0,4,8  (padding at 12)
 *   PointXYZI  : 16 bytes → float x,y,z at offsets 0,4,8  (intensity at 12)
 *   PointXYZRGB/RGBA: 32 bytes → float x,y,z at offsets 0,4,8; packed rgba uint32 at offset 16
 *     rgba byte order in memory: b(+0), g(+1), r(+2), a(+3)
 *
 * Data-fetch strategy:
 *   1. Get point count via varName.size() or varName.points.size()
 *   2. Determine point type and stride from template parameter in type string
 *   3. Obtain data pointer for varName.points[0] or &varName.points[0]
 *   4. Read N × stride bytes via readMemoryChunked
 *   5. Unpack XYZ (and optional RGB) using DataView
 *
 * References:
 *   - https://pointclouds.org/documentation/structpcl_1_1_point_cloud.html
 *   - pcl/point_types.h for struct layouts
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PointCloudData } from "../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../ILibProviders";
import {
  isUsingLLDB,
  readMemoryChunked,
  tryGetDataPointer,
  getContainerSize,
} from "../../cppDebugger";
import { computeBounds } from "../utils";

// ── Point type descriptors ────────────────────────────────────────────────

interface PclPointLayout {
  /** Total bytes per point (SSE-aligned). */
  stride: number;
  /** Byte offsets for x, y, z (always float32). */
  xOff: number;
  yOff: number;
  zOff: number;
  /** Whether this point type carries color information. */
  hasRgb: boolean;
  /** Byte offset of the packed uint32 rgba field (only when hasRgb). */
  rgbaOff: number;
}

/**
 * Select memory layout from the point type name embedded in the type string.
 *
 * pcl::PointCloud<pcl::PointXYZRGB> → "PointXYZRGB"
 */
function pclPointLayout(typeStr: string): PclPointLayout {
  const rgbMatch = /PointXYZRGBA?/i.test(typeStr);
  if (rgbMatch) {
    // PointXYZRGB/RGBA: PCL_ADD_POINT4D (16 B) + union rgba (4 B) + 12 B padding = 32 B
    return {
      stride: 32,
      xOff: 0,
      yOff: 4,
      zOff: 8,
      hasRgb: true,
      rgbaOff: 16,
    };
  }
  // PointXYZ, PointXYZI, PointNormal, PointWithRange, etc.:
  // PCL_ADD_POINT4D = 16 bytes; x,y,z at 0,4,8
  return { stride: 16, xOff: 0, yOff: 4, zOff: 8, hasRgb: false, rgbaOff: 0 };
}

// ── Data pointer resolution ───────────────────────────────────────────────

/**
 * Get size of `varName.points` (the inner std::vector).
 * Falls back to evaluating `.size()` directly on the PointCloud itself
 * (pcl::PointCloud provides size() as an alias for points.size()).
 */
async function getPclPointCount(
  session: vscode.DebugSession,
  varName: string,
  frameId?: number
): Promise<number> {
  // Try .size() on varName directly (pcl::PointCloud::size() == points.size())
  let count = await getContainerSize(session, varName, frameId);
  if (count > 0) {
    return count;
  }
  // Fallback: explicit .points.size()
  count = await getContainerSize(session, `${varName}.points`, frameId);
  return count;
}

/**
 * Obtain the data pointer to the first element of `varName.points`.
 */
async function getPclDataPointer(
  session: vscode.DebugSession,
  varName: string,
  frameId?: number
): Promise<string | null> {
  // First, try evaluating width to check if this is a PointCloud (sanity check is implicit)
  const exprs = isUsingLLDB(session)
    ? [
        `&${varName}.points[0]`,
        `${varName}.points.data()`,
        `&${varName}[0]`,
      ]
    : [
        `(long long)&${varName}.points[0]`,
        `(long long)${varName}.points.data()`,
        `reinterpret_cast<long long>(&${varName}.points[0])`,
        `(long long)&${varName}[0]`,
      ];
  return tryGetDataPointer(session, exprs, frameId);
}

// ── Memory unpacking ──────────────────────────────────────────────────────

/**
 * Unpack XYZ (and optional normalized RGB [0,1]) from a raw byte buffer
 * of pcl::PointT structs.
 *
 * PCL stores RGBA packed as: byte 0 = B, byte 1 = G, byte 2 = R, byte 3 = A.
 * rgbValues output uses [R, G, B] order normalized to [0, 1].
 */
function unpackPclPoints(
  buffer: Uint8Array,
  count: number,
  layout: PclPointLayout
): { xyzValues: number[]; rgbValues?: number[] } {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const xyzValues: number[] = [];
  const rgbValues: number[] = [];

  for (let i = 0; i < count; i++) {
    const base = i * layout.stride;
    if (base + layout.stride > buffer.byteLength) {
      break;
    }
    xyzValues.push(
      view.getFloat32(base + layout.xOff, true),
      view.getFloat32(base + layout.yOff, true),
      view.getFloat32(base + layout.zOff, true)
    );
    if (layout.hasRgb) {
      // Memory byte order: b, g, r, a
      const b = buffer[base + layout.rgbaOff] / 255;
      const g = buffer[base + layout.rgbaOff + 1] / 255;
      const r = buffer[base + layout.rgbaOff + 2] / 255;
      rgbValues.push(r, g, b);
    }
  }

  return {
    xyzValues,
    rgbValues: layout.hasRgb && rgbValues.length > 0 ? rgbValues : undefined,
  };
}

// ── Provider ──────────────────────────────────────────────────────────────

export class PclPointCloudProvider implements ILibPointCloudProvider {
  canHandle(typeName: string): boolean {
    return /pcl::PointCloud/i.test(typeName);
  }

  async fetchPointCloudData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
  ): Promise<PointCloudData | null> {
    const frameId = info.frameId;
    const typeStr = info.typeName ?? info.type;

    // ── Step 1: point count ───────────────────────────────────────────────
    const pointCount = await getPclPointCount(session, varName, frameId);
    if (pointCount <= 0) {
      return null;
    }

    // ── Step 2: layout from point type ────────────────────────────────────
    const layout = pclPointLayout(typeStr);
    const totalBytes = pointCount * layout.stride;

    // ── Step 3: data pointer ──────────────────────────────────────────────
    const dataPtr = await getPclDataPointer(session, varName, frameId);
    if (!dataPtr) {
      return null;
    }

    // ── Step 4: read memory ───────────────────────────────────────────────
    const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
    if (!buffer) {
      return null;
    }

    // ── Step 5: unpack ────────────────────────────────────────────────────
    const { xyzValues, rgbValues } = unpackPclPoints(buffer, pointCount, layout);

    return {
      xyzValues,
      rgbValues,
      pointCount,
      bounds: computeBounds(xyzValues),
      varName,
    };
  }
}
