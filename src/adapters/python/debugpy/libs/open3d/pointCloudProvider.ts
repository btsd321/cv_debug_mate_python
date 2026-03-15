/**
 * open3d/pointCloudProvider.ts — PointCloudData extraction from open3d.geometry.PointCloud.
 *
 * Handles: open3d.geometry.PointCloud (and the C++ binding alias
 *          open3d.cpu.pybind.geometry.PointCloud)
 *
 * Strategy:
 *   1. Evaluate metadata: number of points + whether colors are set.
 *   2. Fetch XYZ data via np.asarray(pcd.points) — float64 (N, 3).
 *   3. Optionally fetch RGB data via np.asarray(pcd.colors) — float64 (N, 3) in [0, 1].
 *
 * The existing fetchArrayData path (Base64 socket transfer) is reused so
 * large point clouds transfer efficiently.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PointCloudData } from "../../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../../ILibProviders";
import { evaluateExpression, fetchArrayData } from "../../debugger";
import { computeBounds } from "../utils";

export class Open3DPointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        // Matches both:
        //   open3d.geometry.PointCloud
        //   open3d.cpu.pybind.geometry.PointCloud
        return /open3d.*PointCloud/i.test(typeName);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        // ── Step 1: metadata ─────────────────────────────────────────────────
        const metaExpr =
            `__import__('json').dumps({` +
            `'n': len(${varName}.points),` +
            `'hasColors': len(${varName}.colors) > 0` +
            `})`;
        const metaResult = await evaluateExpression(session, metaExpr, info.frameId);
        if (!metaResult) { return null; }

        let meta: { n: number; hasColors: boolean };
        try {
            const jsonStr = metaResult.startsWith("'") ? metaResult.slice(1, -1) : metaResult;
            meta = JSON.parse(jsonStr) as { n: number; hasColors: boolean };
        } catch {
            return null;
        }

        if (meta.n === 0) { return null; }

        // ── Step 2: XYZ points ───────────────────────────────────────────────
        const xyzInfo: VariableInfo = {
            name: varName,
            type: info.type,
            typeName: "numpy.ndarray",
            shape: [meta.n, 3],
            dtype: "float64",
            frameId: info.frameId,
        };
        // Force binary socket transfer (thresholdBytes=0) — same DAP string-length
        // concern as NumpyPointCloudProvider: Nx3 float64 JSON >> 1 DAP packet.
        const xyzRaw = await fetchArrayData(
            session,
            `__import__('numpy').asarray(${varName}.points)`,
            xyzInfo
        );
        if (!xyzRaw) { return null; }

        const xyzF64 = new Float64Array(
            xyzRaw.buffer.buffer,
            xyzRaw.buffer.byteOffset,
            meta.n * 3
        );
        const xyzValues = Array.from(xyzF64);

        // ── Step 3: RGB colors (optional) ────────────────────────────────────
        let rgbValues: number[] | undefined;
        if (meta.hasColors) {
            const colorInfo: VariableInfo = {
                name: varName,
                type: info.type,
                typeName: "numpy.ndarray",
                shape: [meta.n, 3],
                dtype: "float64",
                frameId: info.frameId,
            };
            const colorRaw = await fetchArrayData(
                session,
                `__import__('numpy').asarray(${varName}.colors)`,
                colorInfo
            );
            if (colorRaw) {
                const colorF64 = new Float64Array(
                    colorRaw.buffer.buffer,
                    colorRaw.buffer.byteOffset,
                    meta.n * 3
                );
                rgbValues = Array.from(colorF64);
            }
        }

        return {
            xyzValues,
            rgbValues,
            pointCount: meta.n,
            bounds: computeBounds(xyzValues),
            varName,
        };
    }
}
