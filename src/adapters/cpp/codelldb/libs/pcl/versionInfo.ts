/**
 * pcl/versionInfo.ts — Fetch PCL version via CodeLLDB (session.type = "lldb").
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version parsed from the PCL install path by the coordinator
 *      (e.g. C:\PCL 1.13.0\bin\pcl_common_debug.dll → "1.13.0"); works on
 *      Windows without any expression evaluation.
 *   2. PCL_MAJOR_VERSION / PCL_MINOR_VERSION / PCL_REVISION_VERSION macros —
 *      C preprocessor macros; available in DWARF debug info on Linux/macOS,
 *      but absent in PDB on Windows.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the PCL version string (e.g. "1.13.0") or null if PCL symbols
 * are not available in the current debug session.
 *
 * @param moduleVersion  Pre-resolved version from loaded DLL metadata (may be null).
 */
export async function fetchPclVersion(
    session: vscode.DebugSession,
    frameId: number | undefined,
    moduleVersion: string | null = null
): Promise<string | null> {
    // Short-circuit: probe major first. If it fails, fall back to moduleVersion.
    const majorRaw = await evaluateExpression(session, "(int)PCL_MAJOR_VERSION", frameId);
    const major = parseVersionNum(majorRaw);
    if (major === null) { return moduleVersion; }
    const [minorRaw, patchRaw] = await Promise.all([
        evaluateExpression(session, "(int)PCL_MINOR_VERSION", frameId),
        evaluateExpression(session, "(int)PCL_REVISION_VERSION", frameId),
    ]);
    const minor = parseVersionNum(minorRaw) ?? "?";
    const patch = parseVersionNum(patchRaw) ?? "?";
    return `${major}.${minor}.${patch}`;
}

