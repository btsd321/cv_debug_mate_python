/**
 * pcl/versionInfo.ts — Fetch PCL version via CodeLLDB (session.type = "lldb").
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version read from the PE FILEVERSION resource of the
 *      loaded DLL via the LLDB Python API (`lldb.SBModule.GetVersion()`); works
 *      on Windows without any JIT or symbol table access.
 *      Falls back to parsing the PCL install path (e.g. C:\PCL 1.13.0\bin\...)
 *      when the Python API is unavailable.
 *   2. PCL_MAJOR/MINOR/REVISION_VERSION macros — C preprocessor macros;
 *      available in DWARF debug info on Linux/macOS, absent from PDB on Windows.
 *   3. LLDB Python source-file scan — iterates compile-unit source file paths
 *      in loaded modules, finds the PCL include directory, then reads
 *      `pcl/pcl_config.h` via Python `open()`.  Handles static-link builds on
 *      Windows where no PCL DLL is present in the loaded-modules list.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * CodeLLDB `/py` expression: scan debug-info source file paths to locate the
 * PCL include directory (any path containing `/pcl/`), then read
 * `pcl/pcl_config.h` and extract MAJOR/MINOR/REVISION version numbers.
 */
const PCL_HEADER_SCAN_EXPR = (
    `/py (lambda re,os:` +
    `(lambda path:` +
    `(lambda c:` +
    `'.'.join([m.group(1)` +
    ` for n in ['PCL_MAJOR_VERSION','PCL_MINOR_VERSION','PCL_REVISION_VERSION']` +
    ` for m in [re.search(r'#define '+n+r' +([0-9]+)',c)] if m])` +
    ` if c else '')` +
    `(open(path).read() if path and os.path.exists(path) else ''))` +
    `(next((p[:i]+'/pcl/pcl_config.h'` +
    ` for mod in lldb.target.modules` +
    ` for j in range(mod.GetNumCompileUnits())` +
    ` for cu in [mod.GetCompileUnitAtIndex(j)]` +
    ` for k in range(cu.GetNumSupportFiles())` +
    ` for p in [str(cu.GetSupportFileAtIndex(k)).replace('\\\\','/')]` +
    ` for i in [p.lower().find('/pcl/')] if i>=0),None)))` +
    `(__import__('re'),__import__('os'))`
);

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
    // Strategy 1 (passed in): PE FILEVERSION from DLL / install-path parsing.
    // If the coordinator already resolved a version, skip the expensive strategies.
    if (moduleVersion) { return moduleVersion; }

    // Strategy 2: macros — works on Linux/macOS with DWARF debug info.
    const majorRaw = await evaluateExpression(session, "(int)PCL_MAJOR_VERSION", frameId);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const [minorRaw, patchRaw] = await Promise.all([
            evaluateExpression(session, "(int)PCL_MINOR_VERSION", frameId),
            evaluateExpression(session, "(int)PCL_REVISION_VERSION", frameId),
        ]);
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }

    // Strategy 3: read from pcl/pcl_config.h via Python.
    const result = await evaluateExpression(session, PCL_HEADER_SCAN_EXPR, frameId);
    logger.debug(`[versionInfo/pcl] header scan: raw="${result}"`);
    const m = result?.match(/(\d+\.\d+(?:\.\d+)*)/);
    return m ? m[1] : null;
}

