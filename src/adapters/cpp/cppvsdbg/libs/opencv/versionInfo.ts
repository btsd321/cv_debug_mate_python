/**
 * opencv/versionInfo.ts — Fetch OpenCV runtime version via cppvsdbg (session.type = "cppvsdbg").
 *
 * cv::getVersionMajor/Minor/Revision are available in OpenCV ≥ 3.0.
 * cppvsdbg (vsdbg) uses "repl" context with (long long) casts for integer functions.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the OpenCV version string (e.g. "4.8.0") or null if OpenCV symbols
 * are not available in the current debug session.
 */
export async function fetchOpenCvVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    const [majorRaw, minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(long long)cv::getVersionMajor()", frameId),
        evaluateExpression(session, "(long long)cv::getVersionMinor()", frameId),
        evaluateExpression(session, "(long long)cv::getVersionRevision()", frameId),
    ]);
    logger.debug(`[versionInfo/opencv][cppvsdbg] major="${majorRaw}" minor="${minorRaw}" patch="${patchRaw}"`);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }
    return null;
}
