/**
 * qt/plotProvider.ts — PlotData from Qt numeric containers (Qt5 + Qt6).
 *
 * Supported types → viewer mode:
 *
 *   QVector<T>   (T numeric scalar)  → 1D line plot
 *   QList<T>     (T numeric scalar)  → 1D line plot   (Qt6: same as QVector)
 *   QPolygonF    (= QList<QPointF>)  → 2D scatter (x = QPointF.x, y = QPointF.y)
 *   QVector<QVector2D>               → 2D scatter (x = QVector2D.x(), y = .y())
 *   QList<QVector2D>                 → 2D scatter
 *
 * Memory layouts:
 *   QVector<T> / QList<T>   — contiguous T[] starting at .data() or &[0]
 *   QPolygonF (= QList<QPointF>)
 *     QPointF = { double x; double y; }  (16 bytes per element)
 *   QVector<QVector2D>
 *     QVector2D = { float x; float y; }  (8 bytes per element)
 *
 * Data-fetch strategy:
 *   1. Determine element count via .size() → getContainerSize
 *   2. Determine element stride and dtype from type
 *   3. Obtain data pointer via getVectorDataPointer or tryGetDataPointer
 *   4. Read count × stride bytes via readMemoryChunked
 *   5. Build PlotData
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../IDebugAdapter";
import { PlotData } from "../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../ILibProviders";
import {
    isUsingLLDB,
    readMemoryChunked,
    getVectorDataPointer,
    getContainerSize,
    tryGetDataPointer,
} from "../../cppDebugger";
import { typedBufferToNumbers, computeStats } from "../utils";
import {
    isQVectorNumericScalar,
    isQVectorOf2D,
    isQPolygonF,
    qVectorElementType,
    qtScalarToDtype,
    getQContainerSize,
} from "./qtUtils";
import { logger } from "../../../../log/logger";

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

function bytesForDtype(dtype: string): number {
    switch (dtype) {
        case "uint8": case "int8": return 1;
        case "uint16": case "int16": return 2;
        case "uint32": case "int32": case "float32": return 4;
        case "float64": return 8;
        default: return 4;
    }
}

// ── Provider ──────────────────────────────────────────────────────────────

export class QtPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        return (
            isQVectorNumericScalar(typeName) ||
            isQVectorOf2D(typeName) ||
            isQPolygonF(typeName) ||
            // QList<T> with numeric scalar (Qt6 alias)
            (/\bQList\s*</.test(typeName) && isQVectorNumericScalar(typeName))
        );
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const typeStr = info.typeName ?? info.type;
        const frameId = info.frameId;

        // ── Step 1: element count ─────────────────────────────────────────
        let count = await getContainerSize(session, varName, frameId);
        if (count <= 0 && (info.variablesReference ?? 0) > 0) {
            // cppvsdbg cannot evaluate member function calls — fall back to tree
            count = await getQContainerSize(session, info.variablesReference!);
        }
        if (count <= 0) {
            logger.warn(`QtPlotProvider: size() returned 0 for ${varName}`);
            return null;
        }
        logger.debug(`QtPlotProvider: ${varName} type="${typeStr}" count=${count}`);
        // ── Step 2: classify and determine memory layout ──────────────────
        const is2DScatter = isQVectorOf2D(typeStr) || isQPolygonF(typeStr);

        let dtype: string;
        let strideBytes: number;
        let xOffset: number;
        let yOffset: number;

        if (isQPolygonF(typeStr)) {
            // QPolygonF = QList<QPointF>; QPointF = { double x (0); double y (8); }
            dtype = "float64";
            strideBytes = 16;
            xOffset = 0;
            yOffset = 8;
        } else if (isQVectorOf2D(typeStr)) {
            // QVector2D = { float x (0); float y (4); }
            dtype = "float32";
            strideBytes = 8;
            xOffset = 0;
            yOffset = 4;
        } else {
            // QVector<T> / QList<T> — contiguous scalars
            const elemType = qVectorElementType(typeStr) ?? "float";
            dtype = qtScalarToDtype(elemType);
            strideBytes = bytesForDtype(dtype);
            xOffset = 0;
            yOffset = 0;
        }

        // ── Step 3: data pointer ──────────────────────────────────────────
        const dataPtr = await getDataPointer(session, varName, info);
        if (!dataPtr) {
            logger.warn(`QtPlotProvider: could not resolve data pointer for ${varName}`);
            return null;
        }
        logger.debug(`QtPlotProvider: ${is2DScatter ? "2D scatter" : "1D"} dtype=${dtype} stride=${strideBytes} ptr=${dataPtr}`);

        // ── Step 4: read memory ───────────────────────────────────────────
        const totalBytes = count * strideBytes;
        const buffer = await readMemoryChunked(session, dataPtr, totalBytes);
        if (!buffer) {
            logger.warn(`QtPlotProvider: readMemory failed for ${varName}`);
            return null;
        }
        logger.debug(`QtPlotProvider: read ${buffer.length} bytes`);

        // ── Step 5: parse PlotData ────────────────────────────────────────
        if (is2DScatter) {
            const xValues: number[] = new Array(count);
            const yValues: number[] = new Array(count);
            const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            const isDouble = dtype === "float64";
            for (let i = 0; i < count; i++) {
                const base = i * strideBytes;
                xValues[i] = isDouble
                    ? view.getFloat64(base + xOffset, true)
                    : view.getFloat32(base + xOffset, true);
                yValues[i] = isDouble
                    ? view.getFloat64(base + yOffset, true)
                    : view.getFloat32(base + yOffset, true);
            }
            logger.debug(`QtPlotProvider: returning 2D scatter length=${count}`);
            return {
                xValues,
                yValues,
                dtype,
                length: count,
                stats: computeStats(yValues),
                varName,
            };
        }

        // 1D scalar array
        const yValues = typedBufferToNumbers(buffer, dtype);
        logger.debug(`QtPlotProvider: returning 1D plot length=${count}`);
        return {
            yValues,
            dtype,
            length: count,
            stats: computeStats(yValues),
            varName,
        };
    }
}
