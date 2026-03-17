/**
 * opencv/versionInfo.ts — Fetch OpenCV runtime version via CodeLLDB (session.type = "lldb").
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version parsed from the DLL filename by the coordinator
 *      (e.g. opencv_core480d.dll → "4.8.0"); works on Windows without any
 *      expression evaluation.  CodeLLDB never populates the DAP `version` field,
 *      so parsing the filename suffix is the only reliable fallback on Windows.
 *   2. CV_VERSION_MAJOR / CV_VERSION_MINOR / CV_VERSION_REVISION macros —
 *      available in DWARF debug info on Linux/macOS (requires LLDB with DWARF).
 *   3. cv::getVersionMajor() bare function call — works when LLDB can JIT.
 *   4. (int)cv::getVersionMajor() — explicit cast form for other configurations.
 *
 * On Windows with PDB debug info strategies 2-4 all fail; strategy 1 is the
 * only working path.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the OpenCV version string (e.g. "4.8.0") or null if OpenCV symbols
 * are not available in the current debug session.
 *
 * @param moduleVersion  Pre-resolved version from loaded DLL metadata (may be null).
 */
export async function fetchOpenCvVersion(
    session: vscode.DebugSession,
    frameId: number | undefined,
    moduleVersion: string | null = null
): Promise<string | null> {
    // Try each expression in order; return the first that produces a valid integer.
    const firstInt = async (...exprs: string[]): Promise<number | null> => {
        for (const expr of exprs) {
            const n = parseVersionNum(await evaluateExpression(session, expr, frameId));
            if (n !== null) { return n; }
        }
        return null;
    };
    // Short-circuit on major: if nothing works for major, fall back to moduleVersion.
    const major = await firstInt(
        "CV_VERSION_MAJOR",           // macro — cheapest, no JIT needed
        "cv::getVersionMajor()",       // bare function call
        "(int)cv::getVersionMajor()",  // explicit cast form
    );
    if (major === null) { return moduleVersion; }
    const [minor, patch] = await Promise.all([
        firstInt("CV_VERSION_MINOR",    "cv::getVersionMinor()",    "(int)cv::getVersionMinor()"),
        firstInt("CV_VERSION_REVISION", "cv::getVersionRevision()", "(int)cv::getVersionRevision()"),
    ]);
    return `${major}.${minor ?? "?"}.${patch ?? "?"}`;
}
