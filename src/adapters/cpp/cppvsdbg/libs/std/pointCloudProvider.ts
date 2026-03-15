/**
 * std/pointCloudProvider.ts — PointCloudData from C++ Point3 containers.
 *
 * Supported types:
 *   std::vector<cv::Point3f>            — N × (x,y,z) float32 + 4-byte padding
 *   std::vector<cv::Point3d>            — N × (x,y,z) float64 + 8-byte padding
 *   std::array<cv::Point3f, N>          — same, fixed size
 *   std::array<cv::Point3d, N>          — same, fixed size
 *
 * cv::Point3_<T> memory layout (no virtual table, ABI-stable):
 *   float  → { float x; float y; float z; }          = 12 bytes (no padding)
 *   double → { double x; double y; double z; }        = 24 bytes (no padding)
 *
 * Data-fetch strategy:
 *   1. Determine element count from .size() or fixed size in type string
 *   2. Obtain data pointer via DAP [0] child memoryReference or &varName[0]
 *   3. Read N × stride bytes via readMemoryChunked
 *   4. Unpack x/y/z interleaved values
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PointCloudData } from "../../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../../ILibProviders";
import {
    readMemoryChunked,
    getVectorDataPointer,
    getContainerSize,
    tryGetDataPointer,
} from "../../debugger";
import { computeBounds } from "../utils";
import { isPoint3Vector, isPoint3StdArray } from "./stdUtils";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Obtain the data pointer for the first element of the container.
 * Uses the DAP variables-tree [0] → memoryReference, or evaluates &varName[0].
 */
async function getDataPointer(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<string | null> {
    if (info.variablesReference && info.variablesReference > 0) {
        const ptr = await getVectorDataPointer(
            session,
            varName,
            info.variablesReference,
            info.frameId
        );
        if (ptr) { return ptr; }
    }

    const exprs = [
        `(long long)&${varName}[0]`,
        `(long long)${varName}.data()`,
        `reinterpret_cast<long long>(&${varName}[0])`,
    ];
    return tryGetDataPointer(session, exprs, info.frameId);
}

/**
 * Unpack XYZ values from a raw byte buffer of cv::Point3<T> structs.
 * @param buffer  Raw bytes
 * @param count   Number of Point3 elements
 * @param isDouble  true → float64 (Point3d); false → float32 (Point3f)
 */
function unpackPoint3(
    buffer: Uint8Array,
    count: number,
    isDouble: boolean
): number[] {
    const stride = isDouble ? 24 : 12; // 3 × (8 or 4) bytes, no padding for Point3
    const result: number[] = [];
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    for (let i = 0; i < count; i++) {
        const offset = i * stride;
        if (offset + stride > buffer.byteLength) { break; }
        if (isDouble) {
            result.push(
                view.getFloat64(offset, true),
                view.getFloat64(offset + 8, true),
                view.getFloat64(offset + 16, true)
            );
        } else {
            result.push(
                view.getFloat32(offset, true),
                view.getFloat32(offset + 4, true),
                view.getFloat32(offset + 8, true)
            );
        }
    }
    return result;
}

// ── Provider ──────────────────────────────────────────────────────────────

export class StdPointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        return (
            isPoint3Vector(typeName).isPoint3 ||
            isPoint3StdArray(typeName).isPoint3
        );
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        const typeStr = info.typeName ?? info.type;

        // ── Step 1: count and element type ────────────────────────────────────
        let pointCount = 0;
        let isDouble = false;

        const vec = isPoint3Vector(typeStr);
        if (vec.isPoint3) {
            isDouble = vec.isDouble;
            pointCount = await getContainerSize(session, varName, info.frameId);
        } else {
            const arr = isPoint3StdArray(typeStr);
            if (arr.isPoint3) {
                isDouble = arr.isDouble;
                pointCount = arr.size;
            }
        }

        if (pointCount <= 0) {
            return null;
        }

        const stride = isDouble ? 24 : 12;
        const totalBytes = pointCount * stride;

        // ── Step 2: data pointer ──────────────────────────────────────────────
        const dataPtr = await getDataPointer(session, varName, info);
        if (!dataPtr) {
            return null;
        }

        // ── Step 3: read memory ───────────────────────────────────────────────
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            return null;
        }

        // ── Step 4: unpack XYZ ───────────────────────────────────────────────
        const xyzValues = unpackPoint3(buffer, pointCount, isDouble);

        return {
            xyzValues,
            pointCount,
            bounds: computeBounds(xyzValues),
            varName,
        };
    }
}
