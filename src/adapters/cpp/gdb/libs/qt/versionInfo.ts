import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";
import { logger } from "../../../../../log/logger";

/**
 * Return the Qt version string (e.g. "6.5.2") or null if Qt symbols are not
 * available in the current debug session.
 *
 * GDB with -g3 stores preprocessor macros in DWARF info, so we read
 * QT_VERSION_MAJOR / MINOR / PATCH as constants (same strategy as Eigen/PCL).
 * Falls back to qVersion() inferior call for binaries without -g3 macro info.
 */
export async function fetchQtVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    logger.debug(`[C++/gdb/qt] fetchQtVersion frameId=${frameId}`);

    // ── Primary: read compile-time macros (requires -g3; no inferior call) ──
    const [majorRaw, minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(int)QT_VERSION_MAJOR", frameId),
        evaluateExpression(session, "(int)QT_VERSION_MINOR", frameId),
        evaluateExpression(session, "(int)QT_VERSION_PATCH", frameId),
    ]);
    logger.debug(`[C++/gdb/qt] macro: major=${JSON.stringify(majorRaw)} minor=${JSON.stringify(minorRaw)} patch=${JSON.stringify(patchRaw)}`);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }

    // ── Fallback: qVersion() returns const char* like "6.5.2" ───────────────
    const raw = await evaluateExpression(session, "qVersion()", frameId);
    logger.debug(`[C++/gdb/qt] qVersion() raw=${JSON.stringify(raw)}`);
    if (!raw) { return null; }
    // GDB may return: 0x... "6.5.2"  — extract quoted content
    const match = raw.match(/"([^"]+)"/);
    const clean = match ? match[1] : raw.trim();
    if (/^\d+\.\d+/.test(clean)) { return clean; }
    return null;
}
