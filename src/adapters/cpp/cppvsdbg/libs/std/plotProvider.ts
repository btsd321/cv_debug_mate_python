/**
 * std/plotProvider.ts — PlotData from C++ standard library 1D containers.
 *
 * Supported types:
 *   std::vector<T>   — dynamic 1D array, T numeric
 *   std::array<T, N> — fixed-size 1D array, T numeric
 *   T [N]            — C-style 1D array, T numeric
 *
 * Data-fetch strategy:
 *   1. Determine element type and count from type string or .size() evaluate
 *   2. Obtain data pointer via DAP variables tree ([0] child) or &varName[0]
 *   3. Read raw bytes via readMemoryChunked
 *   4. Convert to number[] using dtype-aware typed array view
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PlotData } from "../../../../../viewers/viewerTypes";
import { ILibPlotProvider } from "../../../../ILibProviders";
import {
    readMemoryChunked,
    getVectorDataPointer,
    getContainerSize,
    tryGetDataPointer,
} from "../../debugger";
import { cppTypeToDtype, typedBufferToNumbers, computeStats } from "../utils";
import { is1DVector, is1DStdArray, is1DCStyleArray } from "./stdUtils";

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
            return 4;
    }
}

/**
 * Obtain the data pointer (address of first element) for a 1D container.
 * Tries the DAP variables-tree first, then falls back to evaluate &varName[0].
 */
async function getDataPointer(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<string | null> {
    // Variables-tree approach (works for vector + C-style arrays)
    if (info.variablesReference && info.variablesReference > 0) {
        const ptr = await getVectorDataPointer(
            session,
            varName,
            info.variablesReference,
            info.frameId
        );
        if (ptr) { return ptr; }
    }

    // Fallback: evaluate &varName[0] or varName.data()
    const exprs = [
        `(long long)&${varName}[0]`,
        `(long long)${varName}.data()`,
        `reinterpret_cast<long long>(&${varName}[0])`,
    ];
    return tryGetDataPointer(session, exprs, info.frameId);
}

// ── Provider ──────────────────────────────────────────────────────────────

export class StdPlotProvider implements ILibPlotProvider {
    canHandle(typeName: string): boolean {
        return (
            is1DVector(typeName).is1D ||
            is1DStdArray(typeName).is1D ||
            is1DCStyleArray(typeName).is1DArray
        );
    }

    async fetchPlotData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PlotData | null> {
        const typeStr = info.typeName ?? info.type;

        // ── Step 1: resolve element type and count ────────────────────────────
        let elementType = "";
        let size = 0;

        const vec = is1DVector(typeStr);
        if (vec.is1D) {
            elementType = vec.elementType;
            // Dynamic size: evaluate .size()
            size = await getContainerSize(session, varName, info.frameId);
        } else {
            const arr = is1DStdArray(typeStr);
            if (arr.is1D) {
                elementType = arr.elementType;
                size = arr.size; // compile-time constant
            } else {
                const ca = is1DCStyleArray(typeStr);
                if (ca.is1DArray) {
                    elementType = ca.elementType;
                    size = ca.size; // compile-time constant
                }
            }
        }

        if (size <= 0 || !elementType) {
            return null;
        }

        const dtype = cppTypeToDtype(elementType);
        const totalBytes = size * bytesPerDtype(dtype);

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

        const yValues = typedBufferToNumbers(buffer, dtype);
        const stats = computeStats(yValues);

        return {
            yValues,
            dtype,
            length: size,
            stats,
            varName,
        };
    }
}
