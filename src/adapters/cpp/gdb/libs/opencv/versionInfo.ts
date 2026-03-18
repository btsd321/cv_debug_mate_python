/**
 * opencv/versionInfo.ts — Fetch OpenCV version via GDB (session.type = "cppdbg").
 *
 * GDB compiles the test binary with -g3, which stores preprocessor macro
 * definitions in DWARF debug info.  Reading CV_VERSION_MAJOR / MINOR /
 * REVISION as constants is therefore reliable and requires no inferior call.
 *
 * Falls back to cv::getVersionMajor() / cv::getVersionString().c_str() for
 * binaries compiled without -g3 macro info.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";
import { logger } from "../../../../../log/logger";

/**
 * Return the OpenCV version string (e.g. "4.8.0") or null if OpenCV symbols
 * are not available in the current debug session.
 */
export async function fetchOpenCvVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    logger.debug(`[C++/gdb/opencv] fetchOpenCvVersion frameId=${frameId}`);

    // ── Primary: read compile-time macros (requires -g3; no inferior call) ──
    const [majorRaw, minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(int)CV_VERSION_MAJOR", frameId),
        evaluateExpression(session, "(int)CV_VERSION_MINOR", frameId),
        evaluateExpression(session, "(int)CV_VERSION_REVISION", frameId),
    ]);
    logger.debug(`[C++/gdb/opencv] macro: major=${JSON.stringify(majorRaw)} minor=${JSON.stringify(minorRaw)} patch=${JSON.stringify(patchRaw)}`);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }

    // ── Fallback A: function call (works when -g3 macro info is absent) ─────
    const [fMajRaw, fMinRaw, fPatchRaw] = await Promise.all([
        evaluateExpression(session, "(int)cv::getVersionMajor()", frameId),
        evaluateExpression(session, "(int)cv::getVersionMinor()", frameId),
        evaluateExpression(session, "(int)cv::getVersionRevision()", frameId),
    ]);
    logger.debug(`[C++/gdb/opencv] func: major=${JSON.stringify(fMajRaw)} minor=${JSON.stringify(fMinRaw)} patch=${JSON.stringify(fPatchRaw)}`);
    const fMaj = parseVersionNum(fMajRaw);
    if (fMaj !== null) {
        const fMin = parseVersionNum(fMinRaw) ?? "?";
        const fPat = parseVersionNum(fPatchRaw) ?? "?";
        return `${fMaj}.${fMin}.${fPat}`;
    }

    // ── Fallback B: getVersionString() returns std::string via .c_str() ─────
    const str = await evaluateExpression(session, "cv::getVersionString().c_str()", frameId);
    logger.debug(`[C++/gdb/opencv] getVersionString raw=${JSON.stringify(str)}`);
    if (str) {
        // GDB may return: 0x... "4.8.0"  — extract quoted content
        const match = str.match(/"([^"]+)"/);
        const clean = match ? match[1] : str.replace(/^["']|["']$/g, "").trim();
        if (clean && /^\d/.test(clean)) { return clean; }
    }
    return null;
}
