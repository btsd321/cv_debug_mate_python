/**
 * ros2/pointCloudProvider.ts — PointCloudData from sensor_msgs::msg::PointCloud2 (GDB).
 *
 * Layout of sensor_msgs::msg::PointCloud2_<Alloc>:
 *   uint32_t height                          (1 for unordered clouds)
 *   uint32_t width                           (point count when height == 1)
 *   std::vector<PointField_<Alloc>> fields
 *   uint8_t  is_bigendian
 *   uint32_t point_step                      (bytes per point)
 *   uint32_t row_step
 *   std::vector<uint8_t> data                (point_step * width * height bytes)
 *   uint8_t  is_dense
 *
 * PointField_<Alloc>:
 *   std::string name      ("x", "y", "z", "rgb", "rgba", "intensity", ...)
 *   uint32_t offset
 *   uint8_t  datatype     (1..8, see ros2Utils POINTFIELD_*)
 *   uint32_t count
 *
 * Strategy:
 *   1. Evaluate height, width, point_step → pointCount = width * height.
 *   2. Enumerate fields via .fields.size() and per-element evaluate.
 *   3. Resolve x/y/z float32 offsets (mandatory) and rgb/rgba offset (optional).
 *   4. tryGetDataPointer for &data[0]; readMemoryChunked(point_step * pointCount).
 *   5. Walk the buffer with stride = point_step, extracting xyz (and rgb).
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PointCloudData } from "../../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../../ILibProviders";
import {
    evaluateExpression,
    tryGetDataPointer,
    readMemoryChunked,
    getContainerSize,
} from "../../debugger";
import { computeBounds } from "../utils";
import { logger } from "../../../../../log/logger";
import {
    isRos2PointCloud2,
    readStdString,
    POINTFIELD_FLOAT32,
    POINTFIELD_UINT32,
} from "./ros2Utils";

interface ResolvedFields {
    xOff: number;
    yOff: number;
    zOff: number;
    /** Offset of an rgb/rgba packed uint32 (PCL convention: B,G,R,A bytes). */
    rgbOff: number | null;
}

async function evalUint32(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<number> {
    const r = await evaluateExpression(session, `(unsigned int)${expr}`, frameId);
    const n = parseInt(r ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function evalUint8(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<number> {
    const r = await evaluateExpression(session, `(int)(${expr})`, frameId);
    const n = parseInt(r ?? "", 10);
    return Number.isFinite(n) ? n : -1;
}

async function resolveFields(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<ResolvedFields | null> {
    const fieldCount = await getContainerSize(session, `${varName}.fields`, frameId);
    logger.debug(`[ROS2 PC2] ${varName}: fieldCount=${fieldCount}`);
    if (fieldCount <= 0) {
        return null;
    }

    let xOff = -1, yOff = -1, zOff = -1;
    let rgbOff: number | null = null;

    for (let i = 0; i < fieldCount; i++) {
        const name = await readStdString(session, `${varName}.fields[${i}].name`, frameId);
        if (!name) {
            continue;
        }
        const datatype = await evalUint8(session, `${varName}.fields[${i}].datatype`, frameId);
        const offset   = await evalUint32(session, `${varName}.fields[${i}].offset`, frameId);
        logger.debug(`[ROS2 PC2]   field[${i}] name=${name} datatype=${datatype} offset=${offset}`);

        if (name === "x" && datatype === POINTFIELD_FLOAT32) { xOff = offset; }
        else if (name === "y" && datatype === POINTFIELD_FLOAT32) { yOff = offset; }
        else if (name === "z" && datatype === POINTFIELD_FLOAT32) { zOff = offset; }
        else if ((name === "rgb" || name === "rgba") &&
                 (datatype === POINTFIELD_FLOAT32 || datatype === POINTFIELD_UINT32)) {
            rgbOff = offset;
        }
    }

    if (xOff < 0 || yOff < 0 || zOff < 0) {
        logger.warn(`[ROS2 PC2] ${varName}: missing x/y/z float32 fields (xOff=${xOff} yOff=${yOff} zOff=${zOff})`);
        return null;
    }
    return { xOff, yOff, zOff, rgbOff };
}

function unpackPoints(
    buffer: Uint8Array,
    pointCount: number,
    pointStep: number,
    fields: ResolvedFields
): { xyzValues: number[]; rgbValues?: number[] } {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const xyzValues: number[] = [];
    const rgbValues: number[] = [];
    const hasRgb = fields.rgbOff !== null;

    for (let i = 0; i < pointCount; i++) {
        const base = i * pointStep;
        if (base + pointStep > buffer.byteLength) {
            break;
        }
        xyzValues.push(
            view.getFloat32(base + fields.xOff, true),
            view.getFloat32(base + fields.yOff, true),
            view.getFloat32(base + fields.zOff, true)
        );
        if (hasRgb) {
            // PCL convention: bytes at rgbOff are B, G, R, A
            const off = base + (fields.rgbOff as number);
            const b = buffer[off]     / 255;
            const g = buffer[off + 1] / 255;
            const r = buffer[off + 2] / 255;
            rgbValues.push(r, g, b);
        }
    }

    return {
        xyzValues,
        rgbValues: hasRgb && rgbValues.length > 0 ? rgbValues : undefined,
    };
}

export class Ros2PointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        return isRos2PointCloud2(typeName);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        const frameId = info.frameId;

        // ── Step 1: scalar fields ────────────────────────────────────────
        const height    = await evalUint32(session, `${varName}.height`,     frameId);
        const width     = await evalUint32(session, `${varName}.width`,      frameId);
        const pointStep = await evalUint32(session, `${varName}.point_step`, frameId);
        logger.debug(`[ROS2 PC2] ${varName}: height=${height} width=${width} point_step=${pointStep}`);
        if (width <= 0 || pointStep <= 0) {
            logger.warn(`[ROS2 PC2] ${varName}: invalid dimensions`);
            return null;
        }
        const pointCount = width * (height > 0 ? height : 1);

        // ── Step 2: field offsets ────────────────────────────────────────
        const fields = await resolveFields(session, varName, frameId);
        if (!fields) {
            return null;
        }

        // ── Step 3: data pointer ─────────────────────────────────────────
        const dataPtr = await tryGetDataPointer(
            session,
            [
                `(long long)${varName}.data.data()`,
                `(long long)&${varName}.data[0]`,
                `reinterpret_cast<long long>(${varName}.data.data())`,
            ],
            frameId
        );
        if (!dataPtr) {
            logger.warn(`[ROS2 PC2] ${varName}: failed to resolve data pointer`);
            return null;
        }

        // ── Step 4: read bytes ───────────────────────────────────────────
        const totalBytes = pointCount * pointStep;
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            return null;
        }

        // ── Step 5: unpack ───────────────────────────────────────────────
        const { xyzValues, rgbValues } = unpackPoints(buffer, pointCount, pointStep, fields);
        return {
            xyzValues,
            rgbValues,
            pointCount,
            bounds: computeBounds(xyzValues),
            varName,
        };
    }
}
