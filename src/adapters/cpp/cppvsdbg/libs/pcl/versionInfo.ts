/**
 * pcl/versionInfo.ts — Fetch PCL runtime version via cppvsdbg (session.type = "cppvsdbg").
 *
 * PCL_MAJOR_VERSION / PCL_MINOR_VERSION / PCL_REVISION_VERSION are
 * preprocessor macros; availability depends on build settings.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the PCL version string (e.g. "1.13.0") or null if PCL symbols
 * are not available in the current debug session.
 */
export async function fetchPclVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    const [majorRaw, minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(long long)PCL_MAJOR_VERSION", frameId),
        evaluateExpression(session, "(long long)PCL_MINOR_VERSION", frameId),
        evaluateExpression(session, "(long long)PCL_REVISION_VERSION", frameId),
    ]);
    logger.debug(`[versionInfo/pcl][cppvsdbg] major="${majorRaw}" minor="${minorRaw}" patch="${patchRaw}"`);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }
    return null;
}
