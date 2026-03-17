/**
 * std/imageProvider.ts — ImageData from C++ multi-dimensional array types.
 *
 * Supported types:
 *   std::array<std::array<T, W>, H>                   — 2D grayscale image
 *   std::array<std::array<std::array<T, C>, W>, H>    — 3D image (C channels)
 *   T [H][W]                                          — C-style 2D grayscale
 *   T [H][W][C]                                       — C-style 3D image (C ∈ {1,3,4})
 *
 * Data-fetch strategy:
 *   1. Parse H, W, C and element type from the type string
 *   2. Obtain address of first element via evaluate &varName[0][0] (or [0][0][0])
 *   3. Read H×W×C×bpe bytes via readMemoryChunked
 *   4. Build ImageData
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { ImageData, ImageFormat } from "../../../../../viewers/viewerTypes";
import { ILibImageProvider } from "../../../../ILibProviders";
import { logger } from "../../../../../log/logger";
import {
    readMemoryChunked,
    build2DDataPointerExpressions,
    build3DDataPointerExpressions,
    tryGetDataPointer,
} from "../../debugger";
import { cppTypeToDtype, bufferToBase64, computeMinMax } from "../utils";
import {
    is2DStdArray,
    is3DStdArray,
    is2DCStyleArray,
    is3DCStyleArray,
} from "./stdUtils";

// ── Helpers ───────────────────────────────────────────────────────────────

function bytesPerDtype(dtype: string): number {
    switch (dtype) {
        case "uint8":
        case "int8":
            return 1;
        case "uint16":
        case "int16":
            return 2;
        case "uint32":
        case "int32":
        case "float32":
            return 4;
        case "float64":
            return 8;
        default:
            return 1;
    }
}

// ── Provider ──────────────────────────────────────────────────────────────

export class StdImageProvider implements ILibImageProvider {

    canHandle(typeName: string): boolean {
        return (
            is2DStdArray(typeName).is2DArray ||
            is3DStdArray(typeName).is3DArray ||
            is2DCStyleArray(typeName).is2DArray ||
            is3DCStyleArray(typeName).is3DArray
        );
    }

    async fetchImageData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<ImageData | null> {
        const typeStr = info.typeName ?? info.type;

        // ── Step 1: resolve dimensions ────────────────────────────────────────
        let rows = 0;
        let cols = 0;
        let channels = 1;
        let elementType = "";
        let is3D = false;

        const s2D = is2DStdArray(typeStr);
        if (s2D.is2DArray) {
            rows = s2D.rows;
            cols = s2D.cols;
            elementType = s2D.elementType;
        } else {
            const s3D = is3DStdArray(typeStr);
            if (s3D.is3DArray) {
                rows = s3D.height;
                cols = s3D.width;
                channels = s3D.channels;
                elementType = s3D.elementType;
                is3D = true;
            } else {
                const c2D = is2DCStyleArray(typeStr);
                if (c2D.is2DArray) {
                    rows = c2D.rows;
                    cols = c2D.cols;
                    elementType = c2D.elementType;
                } else {
                    const c3D = is3DCStyleArray(typeStr);
                    if (c3D.is3DArray) {
                        rows = c3D.height;
                        cols = c3D.width;
                        channels = c3D.channels;
                        elementType = c3D.elementType;
                        is3D = true;
                    }
                }
            }
        }

        if (rows <= 0 || cols <= 0 || !elementType) {
            return null;
        }

        const dtype = cppTypeToDtype(elementType);
        const bpe = bytesPerDtype(dtype);
        const totalBytes = rows * cols * channels * bpe;

        // ── Step 2: data pointer ──────────────────────────────────────────────
        // Arrays are contiguous in memory; &varName[0][0] gives the start.
        const exprs = is3D
            ? build3DDataPointerExpressions(varName)
            : build2DDataPointerExpressions(varName);

        let dataPtr = await tryGetDataPointer(session, exprs, info.frameId);
        logger.debug(`[StdImage] ${varName}: tryGetDataPointer -> ${dataPtr}`);

        // Fallback: use [0][0] child memoryReference via variables tree
        if (!dataPtr && info.variablesReference && info.variablesReference > 0) {
            dataPtr = await getFirstElementRef(session, info.variablesReference);
            logger.debug(`[StdImage] ${varName}: getFirstElementRef -> ${dataPtr}`);
        }

        if (!dataPtr) {
            return null;
        }

        // ── Step 3: read memory ───────────────────────────────────────────────
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            return null;
        }

        const { dataMin, dataMax } = computeMinMax(buffer, dtype);

        return {
            b64Bytes: bufferToBase64(buffer),
            width: cols,
            height: rows,
            channels,
            dtype,
            isUint8: dtype === "uint8",
            dataMin,
            dataMax,
            varName,
            // C++ std array images assume RGB order (no cv2 convention)
            format: (channels === 1 ? "GRAY" : channels === 4 ? "RGBA" : "RGB") as ImageFormat,
        };
    }
}

/**
 * Walk one or two levels of the DAP variables tree to find the memoryReference
 * of the first contiguous data element.
 *
 * Handles both layouts:
 *   - Typical (GDB/Linux): top-level has `[0]` row children
 *   - MSVC STL (CodeLLDB/Windows): top-level has `_Elems` whose
 *     memoryReference directly points to the contiguous array storage
 */
async function getFirstElementRef(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<string | null> {
    try {
        const outer = await session.customRequest("variables", { variablesReference });
        const outerVars: { name: string; variablesReference?: number; memoryReference?: string }[] =
            outer?.variables ?? [];
        logger.debug(
            `[getFirstElementRef] variablesRef=${variablesReference} ` +
            `children=[${outerVars.map(v => `${v.name}(mr=${v.memoryReference ?? "none"})`).join(", ")}]`
        );

        // std::array internal storage field — name varies by STL implementation:
        //   _Elems   (MSVC STL)
        //   _M_elems (libstdc++)
        //   __elems_ (libc++)
        // Its memoryReference directly points to the first contiguous element.
        const elemsChild = outerVars.find(
            (v) => v.name === "_Elems" || v.name === "_M_elems" || v.name === "__elems_"
        );
        if (elemsChild?.memoryReference) {
            logger.debug(`[getFirstElementRef] using ${elemsChild.name}.memoryReference=${elemsChild.memoryReference}`);
            return elemsChild.memoryReference;
        }

        // Standard [0] row → [0] cell traversal
        const firstRow = outerVars.find((v) => v.name === "[0]");
        if (!firstRow) { return null; }

        if (firstRow.variablesReference && firstRow.variablesReference > 0) {
            const inner = await session.customRequest("variables", {
                variablesReference: firstRow.variablesReference,
            });
            const innerVars: { name: string; memoryReference?: string }[] = inner?.variables ?? [];
            const firstCell = innerVars.find(
                (v) => v.name === "[0]" || v.name === "_Elems" || v.name === "_M_elems" || v.name === "__elems_"
            );
            if (firstCell?.memoryReference) {
                logger.debug(`[getFirstElementRef] using row[0].${firstCell.name}=${firstCell.memoryReference}`);
                return firstCell.memoryReference;
            }
        }
        // Fallback: address of the first row itself
        return firstRow.memoryReference ?? null;
    } catch {
        return null;
    }
}
