/**
 * eigen/versionInfo.ts — Fetch Eigen runtime version via GDB (session.type = "cppdbg").
 *
 * EIGEN_WORLD_VERSION / EIGEN_MAJOR_VERSION / EIGEN_MINOR_VERSION are
 * preprocessor macros; they may be inlined and not accessible in all builds.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the Eigen version string (e.g. "3.4.0") or null if Eigen symbols
 * are not available in the current debug session.
 */
export async function fetchEigenVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    const [majorRaw, minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(int)EIGEN_WORLD_VERSION", frameId),
        evaluateExpression(session, "(int)EIGEN_MAJOR_VERSION", frameId),
        evaluateExpression(session, "(int)EIGEN_MINOR_VERSION", frameId),
    ]);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }
    return null;
}
