/**
 * ros2/imageProvider.ts — ImageData extraction from sensor_msgs::msg::Image (GDB).
 *
 * Layout of sensor_msgs::msg::Image_<Alloc>:
 *   uint32_t height
 *   uint32_t width
 *   std::string encoding              ("rgb8", "bgr8", "mono8", "32FC1", ...)
 *   uint8_t  is_bigendian
 *   uint32_t step                     (bytes per row, may include trailing padding)
 *   std::vector<uint8_t> data         (length = step * height)
 *
 * Strategy:
 *   1. Evaluate scalar fields (height, width, step, encoding).
 *   2. Map encoding → channels / dtype / format.
 *   3. Resolve data buffer pointer via .data.data() / &.data[0].
 *   4. readMemoryChunked(step * height) bytes; strip per-row padding when present.
 *   5. Compute min/max for normalisation UI.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import {
    evaluateExpression,
    tryGetDataPointer,
    readMemoryChunked,
} from "../../debugger";
import { bufferToBase64, computeMinMax } from "../utils";
import { logger } from "../../../../../log/logger";
import { decodeRos2Encoding, isRos2Image, readStdString } from "./ros2Utils";

async function evalUint32(
    session: vscode.DebugSession,
    expr: string,
    frameId?: number
): Promise<number> {
    const r = await evaluateExpression(session, `(unsigned int)${expr}`, frameId);
    const n = parseInt(r ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export class Ros2ImageProvider implements ILibImageProvider {
    canHandle(typeName: string): boolean {
        return isRos2Image(typeName);
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const frameId = info.frameId;

        // ── Step 1: scalar fields ────────────────────────────────────────
        const height = await evalUint32(session, `${varName}.height`, frameId);
        const width  = await evalUint32(session, `${varName}.width`,  frameId);
        const step   = await evalUint32(session, `${varName}.step`,   frameId);
        logger.debug(`[ROS2 Image] ${varName}: height=${height} width=${width} step=${step}`);
        if (height <= 0 || width <= 0) {
            logger.warn(`[ROS2 Image] ${varName}: empty dimensions`);
            return null;
        }

        // ── Step 2: encoding ─────────────────────────────────────────────
        const encStr = await readStdString(session, `${varName}.encoding`, frameId);
        logger.debug(`[ROS2 Image] ${varName}: encoding="${encStr}"`);
        if (!encStr) {
            logger.warn(`[ROS2 Image] ${varName}: failed to read encoding string`);
            return null;
        }
        const enc = decodeRos2Encoding(encStr);
        if (!enc) {
            logger.warn(`[ROS2 Image] ${varName}: unsupported encoding "${encStr}"`);
            return null;
        }

        const rowBytes = width * enc.channels * enc.bytesPerChannel;
        const effectiveStep = step > 0 ? step : rowBytes;
        const totalBytes = effectiveStep * height;

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
            logger.warn(`[ROS2 Image] ${varName}: failed to resolve data pointer`);
            return null;
        }

        // ── Step 4: read bytes ───────────────────────────────────────────
        const raw = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!raw) {
            return null;
        }

        // Strip per-row padding when step > rowBytes
        let pixels: Uint8Array;
        if (effectiveStep === rowBytes) {
            pixels = raw;
        } else {
            pixels = new Uint8Array(rowBytes * height);
            for (let r = 0; r < height; r++) {
                pixels.set(
                    raw.subarray(r * effectiveStep, r * effectiveStep + rowBytes),
                    r * rowBytes
                );
            }
        }

        // ── Step 5: pack & return ────────────────────────────────────────
        const { dataMin, dataMax } = computeMinMax(pixels, enc.dtype);
        return {
            b64Bytes: bufferToBase64(pixels),
            width,
            height,
            channels: enc.channels,
            dtype: enc.dtype,
            isUint8: enc.dtype === "uint8",
            dataMin,
            dataMax,
            varName,
            format: enc.format,
        };
    }
}
