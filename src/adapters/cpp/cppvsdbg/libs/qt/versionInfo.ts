import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";

/**
 * Return the Qt version string (e.g. "5.15.2") or null if Qt symbols are not
 * available in the current debug session.
 *
 * qVersion() returns a compile-time const char* like "5.15.2".
 */
export async function fetchQtVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    const raw = await evaluateExpression(session, "qVersion()", frameId);
    logger.debug(`[versionInfo/qt][cppvsdbg] qVersion()="${raw}"`);
    if (!raw) { return null; }
    // Strip surrounding quotes that the debugger may add
    const clean = raw.replace(/^['"]+|['"]+$/g, "").trim();
    // Validate it starts with a digit — basic sanity guard
    if (/^\d+\.\d+/.test(clean)) { return clean; }
    return null;
}
