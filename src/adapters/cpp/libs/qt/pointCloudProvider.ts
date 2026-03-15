/**
 * qt/pointCloudProvider.ts — PointCloudData from QVector<QVector3D> (Qt5 + Qt6).
 *
 * Supported types:
 *   QVector<QVector3D>   — N × (x,y,z) float32  (Qt5)
 *   QList<QVector3D>     — N × (x,y,z) float32  (Qt6 — QVector<T> is a typedef of QList<T>)
 *
 * QVector3D memory layout (Qt stable ABI):
 *   struct QVector3D { float xp; float yp; float zp; };  // 12 bytes, no padding
 *
 * QVector<QVector3D> / QList<QVector3D> stores elements contiguously:
 *   bytes = N × 12  →  [x0,y0,z0,  x1,y1,z1, …]  all float32 little-endian
 *
 * Data-fetch strategy:
 *   1. Get N via .size() (getContainerSize)
 *   2. Obtain data pointer via [0] child memoryReference or varName.data() / &varName[0]
 *   3. Read N × 12 bytes via readMemoryChunked
 *   4. Unpack with Float32Array, build xyzValues, compute bounds
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PointCloudData } from "../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../ILibProviders";
import {
    isUsingLLDB,
    readMemoryChunked,
    getVectorDataPointer,
    getContainerSize,
    tryGetDataPointer,
} from "../../cppDebugger";
import { computeBounds } from "../utils";
import { isQVectorOf3D, getQContainerSize } from "./qtUtils";
import { log_debug, log_warn } from "../../../../log/logger";

// QVector3D = { float xp; float yp; float zp; } — 12 bytes, no padding
const QVECTOR3D_STRIDE = 12;

// ── Helpers ───────────────────────────────────────────────────────────────

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
    const exprs = isUsingLLDB(session)
        ? [`${varName}.data()`, `&${varName}[0]`]
        : [
            `(long long)${varName}.data()`,
            `(long long)&${varName}[0]`,
            `reinterpret_cast<long long>(${varName}.data())`,
        ];
    return tryGetDataPointer(session, exprs, info.frameId);
}

// ── Provider ──────────────────────────────────────────────────────────────

export class QtPointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        return isQVectorOf3D(typeName);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        const frameId = info.frameId;

        // ── Step 1: element count ─────────────────────────────────────────
        let count = await getContainerSize(session, varName, frameId);
        if (count <= 0 && (info.variablesReference ?? 0) > 0) {
            count = await getQContainerSize(session, info.variablesReference!);
        }
        if (count <= 0) {
            log_warn(`QtPointCloudProvider: size() returned 0 for ${varName}`);
            return null;
        }
        log_debug(`QtPointCloudProvider: ${varName} count=${count}`);

        // ── Step 2: data pointer ──────────────────────────────────────────
        const dataPtr = await getDataPointer(session, varName, info);
        if (!dataPtr) {
            log_warn(`QtPointCloudProvider: could not resolve data pointer for ${varName}`);
            return null;
        }

        // ── Step 3: read memory ───────────────────────────────────────────
        const totalBytes = count * QVECTOR3D_STRIDE;
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            log_warn(`QtPointCloudProvider: readMemory failed for ${varName}`);
            return null;
        }

        // ── Step 4: unpack XYZ ────────────────────────────────────────────
        // QVector3D is { float xp, yp, zp } — 3 × float32, tightly packed
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const floats = new Float32Array(ab);
        const xyzValues = Array.from(floats) as number[];

        if (xyzValues.length < count * 3) {
            log_warn(`QtPointCloudProvider: unexpected buffer size for ${varName}`);
            return null;
        }

        const bounds = computeBounds(xyzValues);
        log_debug(`QtPointCloudProvider: returning ${count} points bounds x[${bounds.xMin.toFixed(2)},${bounds.xMax.toFixed(2)}] y[${bounds.yMin.toFixed(2)},${bounds.yMax.toFixed(2)}] z[${bounds.zMin.toFixed(2)},${bounds.zMax.toFixed(2)}]`);

        return {
            xyzValues,
            pointCount: count,
            bounds,
            varName,
        };
    }
}
