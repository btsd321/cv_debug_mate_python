/**
 * opencv/versionInfo.ts — Fetch OpenCV runtime version via CodeLLDB (session.type = "lldb").
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version read from the PE FILEVERSION resource of the
 *      loaded DLL via the LLDB Python API; works on Windows without JIT.
 *      On Linux, resolved from the SO filename (e.g. libopencv_core.so.4.8.0).
 *   2. CV_VERSION_MAJOR / CV_VERSION_MINOR / CV_VERSION_REVISION macros —
 *      available in DWARF debug info on Linux/macOS (requires LLDB with DWARF).
 *   3. cv::getVersionMajor() bare function call — works when LLDB can JIT.
 *   4. (int)cv::getVersionMajor() — explicit cast form for other configurations.
 *   5. Header scan via LLDB /py — reads opencv2/core/version.hpp from the
 *      include path found in debug-info support files; works when JIT and macros
 *      are both unavailable (e.g. CodeLLDB on Linux without -g3, no function JIT).
 *
 * On Windows with PDB debug info strategies 2-5 all fail; strategy 1 is the
 * only working path.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";
import { logger } from "../../../../../log/logger";

/**
 * LLDB /py expression: scan debug-info support file paths for any path
 * containing "/opencv2/", extract the include root, then read
 * opencv2/core/version.hpp and grep CV_VERSION_MAJOR/MINOR/REVISION.
 */
const CV_HEADER_SCAN_EXPR = (
    `/py (lambda re,os:` +
    `(lambda path:` +
    `(lambda c:` +
    `'.'.join([m.group(1)` +
    ` for n in ['CV_VERSION_MAJOR','CV_VERSION_MINOR','CV_VERSION_REVISION']` +
    ` for m in [re.search(r'#define '+n+r' +([0-9]+)',c)] if m])` +
    ` if c else '')` +
    `(open(path).read() if path and os.path.exists(path) else ''))` +
    `(next((p[:i]+'/opencv2/core/version.hpp'` +
    ` for mod in lldb.target.modules` +
    ` for j in range(mod.GetNumCompileUnits())` +
    ` for cu in [mod.GetCompileUnitAtIndex(j)]` +
    ` for k in range(cu.GetNumSupportFiles())` +
    ` for p in [str(cu.GetSupportFileAtIndex(k)).replace('\\\\','/')]` +
    ` for i in [p.lower().find('/opencv2/')] if i>=0),None)))` +
    `(__import__('re'),__import__('os'))`
);

/**
 * Return the OpenCV version string (e.g. "4.8.0") or null if OpenCV symbols
 * are not available in the current debug session.
 *
 * @param moduleVersion  Pre-resolved version from loaded module metadata (may be null).
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
    // Short-circuit on major: if nothing works for major, fall back to other strategies.
    const major = await firstInt(
        "CV_VERSION_MAJOR",           // macro — cheapest, no JIT needed
        "cv::getVersionMajor()",       // bare function call
        "(int)cv::getVersionMajor()",  // explicit cast form
    );
    if (major === null) {
        // Strategy 5: header scan via LLDB Python (works on Linux without JIT or macros)
        const result = await evaluateExpression(session, CV_HEADER_SCAN_EXPR, frameId);
        logger.debug(`[versionInfo/opencv] header scan: raw="${result}"`);
        const m = result?.match(/(\d+\.\d+(?:\.\d+)*)/);
        if (m) { return m[1]; }
        return moduleVersion;
    }
    const [minor, patch] = await Promise.all([
        firstInt("CV_VERSION_MINOR",    "cv::getVersionMinor()",    "(int)cv::getVersionMinor()"),
        firstInt("CV_VERSION_REVISION", "cv::getVersionRevision()", "(int)cv::getVersionRevision()"),
    ]);
    return `${major}.${minor ?? "?"}.${patch ?? "?"}`;
}
