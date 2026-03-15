/**
 * builtins/pointCloudProvider.ts — PointCloudData from Python built-in lists.
 *
 * Handles: list/tuple of (x, y, z) tuples or 3-element lists.
 * Each element is accessed as p[0], p[1], p[2] and cast to float.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../../../IDebugAdapter";
import { PointCloudData } from "../../../../../viewers/viewerTypes";
import { ILibPointCloudProvider } from "../../../../ILibProviders";
import { evaluateExpression } from "../../debugger";
import { computeBounds } from "../utils";

export class BuiltinsPointCloudProvider implements ILibPointCloudProvider {
    canHandle(typeName: string): boolean {
        return /^(builtins\.)?(list|tuple)$/i.test(typeName);
    }

    async fetchPointCloudData(
        session: vscode.DebugSession,
        varName: string,
        info: VariableInfo
    ): Promise<PointCloudData | null> {
        const expr =
            `__import__('json').dumps(` +
            `[[float(p[0]),float(p[1]),float(p[2])] for p in ${varName}])`;

        const result = await evaluateExpression(session, expr, info.frameId);
        if (!result) {
            return null;
        }

        let points: number[][];
        try {
            points = JSON.parse(result.replace(/^'|'$/g, "")) as number[][];
        } catch {
            return null;
        }

        if (points.length === 0) {
            return null;
        }

        const xyzValues = points.flat();
        return {
            xyzValues,
            pointCount: points.length,
            bounds: computeBounds(xyzValues),
            varName,
        };
    }
}
