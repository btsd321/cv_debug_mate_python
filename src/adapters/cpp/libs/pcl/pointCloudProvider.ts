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
    parseSizeFromValue,
    isValidMemoryReference,
    evaluateExpression,
} from "../../cppDebugger";
import { computeBounds } from "../utils";
import { debug } from "../../../../log/logger";

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

// ── Helpers ───────────────────────────────────────────────────────────────

type VarChild = {
    name: string;
    value?: string;
    memoryReference?: string;
    variablesReference?: number;
};

/**
 * Recursively search a variable sub-tree for a known STL vector begin-pointer field
 * (_Myfirst / _M_start / __begin_).  Used when CodeLLDB exposes a `[raw]` synthetic
 * node for the inner std::vector instead of individual `[0]`, `[1]` … elements.
 *
 * The MSVC STL nesting is: [raw] → _Mypair → _Myval2 → _Myfirst  (depth ≤ 3)
 */
async function searchVecBeginPtr(
    session: vscode.DebugSession,
    varsRef: number,
    maxDepth: number
): Promise<string | null> {
    if (maxDepth <= 0 || varsRef <= 0) {
        return null;
    }
    try {
        const resp = await session.customRequest("variables", { variablesReference: varsRef });
        const children: VarChild[] = resp?.variables ?? [];
        debug(`[PclPC] vecRaw[d=${maxDepth}]: ${children.slice(0, 6).map((c) => c.name).join(", ")}`);
        // Priority: check well-known begin-pointer field names first
        const BEGIN_NAMES = new Set(["_Myfirst", "_M_start", "__begin_"]);
        for (const child of children) {
            if (BEGIN_NAMES.has(child.name)) {
                if (child.memoryReference && isValidMemoryReference(child.memoryReference)) {
                    return child.memoryReference;
                }
                const m = (child.value ?? "").match(/0x[0-9a-fA-F]+/);
                if (m && isValidMemoryReference(m[0])) {
                    return m[0];
                }
            }
        }
        // Recurse into struct sub-fields (depth-first)
        for (const child of children) {
            if ((child.variablesReference ?? 0) > 0) {
                const found = await searchVecBeginPtr(session, child.variablesReference!, maxDepth - 1);
                if (found) {
                    return found;
                }
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

// ── Data pointer resolution ───────────────────────────────────────────────

/**
 * Expand `variablesReference` and find the child named `points`.
 * Returns [pointsValue, pointsVarsRef] or null if not found.
 *
 * On LLDB/Windows, walking the variables tree is far more reliable than
 * evaluating member-function expressions (.size(), .data(), pointer arithmetic).
 */
async function expandPclPointsChild(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<{ value: string; variablesReference: number } | null> {
    if (variablesReference <= 0) {
        return null;
    }
    try {
        const resp = await session.customRequest("variables", { variablesReference });
        const v = (resp?.variables ?? []).find(
            (c: { name: string }) => c.name === "points"
        );
        if (v) {
            return { value: v.value ?? "", variablesReference: v.variablesReference ?? 0 };
        }
    } catch {
        /* fall through */
    }
    return null;
}

/**
 * Get size of `varName.points` (the inner std::vector).
 *
 * Strategy (in order):
 *  1. Evaluate `varName.width` (plain struct member, always works on LLDB).
 *     pcl::PointCloud::size() == width * height.
 *  2. Walk the variables tree: expand `variablesReference` → find "points" child → parse its value.
 *  3. Evaluate .size() / internal pointer arithmetic fallbacks.
 */
async function getPclPointCount(
    session: vscode.DebugSession,
    varName: string,
    variablesReference: number,
    frameId?: number
): Promise<number> {
    // Strategy 1 — read plain struct members width & height (no function calls, LLDB-safe)
    const wStr = await evaluateExpression(session, `${varName}.width`, frameId);
    const hStr = await evaluateExpression(session, `${varName}.height`, frameId);
    debug(`[PclPC] width eval="${wStr}" height eval="${hStr}"`);
    const w = parseInt(wStr ?? "");
    const h = parseInt(hStr ?? "");
    if (!isNaN(w) && w > 0) {
        const h2 = (!isNaN(h) && h > 1) ? h : 1;
        debug(`[PclPC] point count from width*height = ${w}*${h2}=${w * h2}`);
        return w * h2;
    }

    // Strategy 2 — variables tree
    const pointsChild = await expandPclPointsChild(session, variablesReference);
    debug(`[PclPC] pointsChild value="${pointsChild?.value}" varsRef=${pointsChild?.variablesReference}`);
    if (pointsChild) {
        const n = parseSizeFromValue(pointsChild.value);
        debug(`[PclPC] parseSizeFromValue -> ${n}`);
        if (n > 0) {
            return n;
        }
    }

    // Strategy 3 — evaluate expressions
    let count = await getContainerSize(session, varName, frameId);
    debug(`[PclPC] getContainerSize(cloud) -> ${count}`);
    if (count > 0) {
        return count;
    }
    count = await getContainerSize(session, `${varName}.points`, frameId);
    debug(`[PclPC] getContainerSize(points) -> ${count}`);
    return count;
}

/**
 * Obtain the data pointer to the first element of `varName.points`.
 *
 * Strategy (in order):
 *  1. Walk the variables tree: expand "points" child → expand its children → find "[0]" memoryReference.
 *  2. Walk the variables tree: check if "[0]" is a direct child of the cloud (synthetic flatting).
 *  3. Evaluate address expressions (MSVC/libstdc++/libc++ LLDB fallbacks + cppdbg).
 */
async function getPclDataPointer(
    session: vscode.DebugSession,
    varName: string,
    variablesReference: number,
    frameId?: number
): Promise<string | null> {
    // Strategy 1 — expand cloud → find points child → expand → find [0]
    const pointsChild = await expandPclPointsChild(session, variablesReference);
    if (pointsChild && pointsChild.variablesReference > 0) {
        try {
            const elemResp = await session.customRequest("variables", {
                variablesReference: pointsChild.variablesReference,
            });
            const elems: VarChild[] = elemResp?.variables ?? [];
            debug(`[PclPC] points children names: ${elems.slice(0, 5).map((e) => e.name).join(", ")}`);
            // CodeLLDB exposes std::vector data as a "[raw]" synthetic child whose
            // memoryReference points to the start of the buffer (not "[0]").
            const first = elems.find((c) => c.name === "[0]" || c.name === "[raw]");
            debug(`[PclPC] [0]/[raw] memRef=${first?.memoryReference} value=${first?.value}`);
            if (first) {
                if (first.memoryReference && isValidMemoryReference(first.memoryReference)) {
                    return first.memoryReference;
                }
                // CodeLLDB: [raw] value is a type string, not a pointer address.
                // But if it happens to contain a hex address, use it.
                const ptrMatch = (first.value ?? "").match(/0x[0-9a-fA-F]+/);
                if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
                    return ptrMatch[0];
                }
                // CodeLLDB: [raw] is the unformatted MSVC STL struct — expand its sub-tree
                // to find _Myfirst (MSVC), _M_start (libstdc++), or __begin_ (libc++).
                if ((first.variablesReference ?? 0) > 0) {
                    const ptr = await searchVecBeginPtr(session, first.variablesReference!, 3);
                    if (ptr) {
                        return ptr;
                    }
                }
            }
        } catch {
            /* fall through */
        }
    }

    // Strategy 2 — check [0] directly in top-level cloud expansion (synthetic inlining)
    if (variablesReference > 0) {
        try {
            const topResp = await session.customRequest("variables", { variablesReference });
            const topElems: Array<{ name: string; memoryReference?: string }> = topResp?.variables ?? [];
            debug(`[PclPC] cloud top-level children: ${topElems.slice(0, 8).map((e) => e.name).join(", ")}`);
            const first = topElems.find((c) => c.name === "[0]");
            if (first?.memoryReference && isValidMemoryReference(first.memoryReference)) {
                return first.memoryReference;
            }
        } catch {
            /* fall through */
        }
    }

    // Strategy 3 — evaluate expressions
    const exprs = isUsingLLDB(session)
        ? [
            // MSVC STL: access begin pointer directly (no function call, LLDB-safe)
            `${varName}.points._Mypair._Myval2._Myfirst`,
            `&${varName}.points[0]`,
            `${varName}.points.data()`,
            `&${varName}[0]`,
            // libstdc++ begin pointer
            `${varName}.points._M_impl._M_start`,
            // libc++ begin pointer
            `${varName}.points.__begin_`,
        ]
        : [
            `(long long)&${varName}.points[0]`,
            `(long long)${varName}.points.data()`,
            `reinterpret_cast<long long>(&${varName}.points[0])`,
            `(long long)&${varName}[0]`,
        ];
    const ptr = await tryGetDataPointer(session, exprs, frameId);
    debug(`[PclPC] tryGetDataPointer -> ${ptr}`);
    return ptr;
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
        const variablesReference = info.variablesReference ?? 0;

        // ── Step 1: point count ───────────────────────────────────────────────
        const pointCount = await getPclPointCount(session, varName, variablesReference, frameId);
        debug(`[PclPC] pointCount=${pointCount}`);
        if (pointCount <= 0) {
            return null;
        }

        // ── Step 2: layout from point type ────────────────────────────────────
        const layout = pclPointLayout(typeStr);
        const totalBytes = pointCount * layout.stride;

        // ── Step 3: data pointer ──────────────────────────────────────────────
        const dataPtr = await getPclDataPointer(session, varName, variablesReference, frameId);
        debug(`[PclPC] dataPtr=${dataPtr}`);        if (!dataPtr) {
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
