/**
 * numpy/pointCloudProvider.ts — PointCloudData extraction from numpy.ndarray.
 *
 * Handles:
 *   - ndarray shape (N, 3)  → XYZ
 *   - ndarray shape (N, 6)  → XYZ + RGB
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PointCloudData } from "../../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../../ILibProviders";
import { fetchArrayData } from "../../debugger";
import { computeBounds } from "../utils";

export class NumpyPointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        return /numpy\.|ndarray/i.test(typeName);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        const shape = info.shape;
        if (!shape || shape.length !== 2) {
            return null;
        }

        const [n, cols] = shape;
        if (cols !== 3 && cols !== 6) {
            return null;
        }

        const raw = await fetchArrayData(
            session,
            `${varName}.astype('float32')`,
            { ...info, dtype: "float32" }
        );
        if (!raw) {
            return null;
        }

        const floats = new Float32Array(
            raw.buffer.buffer,
            raw.buffer.byteOffset,
            n * cols
        );
        const xyzValues: number[] = [];
        const rgbValues: number[] | undefined = cols === 6 ? [] : undefined;

        for (let i = 0; i < n; i++) {
            xyzValues.push(
                floats[i * cols],
                floats[i * cols + 1],
                floats[i * cols + 2]
            );
            if (rgbValues) {
                rgbValues.push(
                    floats[i * cols + 3],
                    floats[i * cols + 4],
                    floats[i * cols + 5]
                );
            }
        }

        return {
            xyzValues,
            rgbValues,
            pointCount: n,
            bounds: computeBounds(xyzValues),
            varName,
        };
    }
}
