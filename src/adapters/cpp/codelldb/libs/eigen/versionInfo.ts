/**
 * eigen/versionInfo.ts — Fetch Eigen version via CodeLLDB (session.type = "lldb").
 *
 * Strategy (tried in order):
 *   1. EIGEN_WORLD/MAJOR/MINOR_VERSION macros — available in DWARF debug info
 *      on Linux/macOS; absent from PDB on Windows.
 *   2. Find Eigen3 install base from debug-info support files, then:
 *      a. Read the cmake config version file (vcpkg: share/eigen3/*.cmake).
 *         This gives the full version string for ALL vcpkg-installed Eigen
 *         regardless of which headers contain `#define` lines.
 *      b. Grep known header files (Macros.h, Version.h) for version defines
 *         as a fallback for non-vcpkg / system installations.
 */

import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { logger } from "../../../../../log/logger";
import { parseVersionNum } from "../../../shared/versionUtils";

// ── Step A: locate eigen3 base directory ─────────────────────────────────

/**
 * Return the Eigen3 include base directory (e.g.
 * `D:/Library/vcpkg/installed/x64-windows/include/eigen3`)
 * by scanning LLDB debug-info support files for any path containing `/eigen/`.
 */
async function findEigenBase(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    const raw = await evaluateExpression(session,
        `/py next((nfp[:nfp.lower().rfind('/eigen/')]` +
        ` for nfp in [str(cu.GetSupportFileAtIndex(k)).replace('\\\\','/')` +
        `  for mod in lldb.target.modules` +
        `  for j in range(mod.GetNumCompileUnits())` +
        `  for cu in [mod.GetCompileUnitAtIndex(j)]` +
        `  for k in range(cu.GetNumSupportFiles())]` +
        ` if '/eigen/' in nfp.lower()),'')`,
        frameId);
    if (!raw) { return null; }
    const dir = raw.replace(/^["'`\s]+|["'`\s]+$/g, "").replace(/\\/g, "/");
    return dir || null;
}

/**
 * Return the Eigen version string (e.g. "3.4.0") or null if Eigen symbols
 * are not available in the current debug session.
 */
export async function fetchEigenVersion(
    session: vscode.DebugSession,
    frameId: number | undefined
): Promise<string | null> {
    // Strategy 1: macros — works on Linux/macOS with DWARF debug info.
    const majorRaw = await evaluateExpression(session, "(int)EIGEN_WORLD_VERSION", frameId);
    const major = parseVersionNum(majorRaw);
    if (major !== null) {
        const [minorRaw, patchRaw] = await Promise.all([
            evaluateExpression(session, "(int)EIGEN_MAJOR_VERSION", frameId),
            evaluateExpression(session, "(int)EIGEN_MINOR_VERSION", frameId),
        ]);
        return `${major}.${parseVersionNum(minorRaw) ?? "?"}.${parseVersionNum(patchRaw) ?? "?"}`;
    }

    // Strategy 2a: locate eigen3 base from LLDB support files.
    const eigenBase = await findEigenBase(session, frameId);
    logger.debug(`[versionInfo/eigen] base="${eigenBase}"`);
    if (!eigenBase) { return null; }

    // Strategy 2b: cmake config version file (most reliable for vcpkg).
    // vcpkg layout: include/eigen3 → ../../../share/eigen3/*.cmake
    // e.g. D:/.../include/eigen3 → D:/.../share/eigen3/Eigen3ConfigVersion.cmake
    const shareDir = eigenBase.replace(/\/include\/eigen3$/i, "/share/eigen3");
    if (shareDir !== eigenBase) {
        const cmakeRaw = await evaluateExpression(session,
            `/py next((m.group(1)` +
            ` for f in __import__('glob').glob('${shareDir}/*.cmake')` +
            ` for c in [open(f).read()]` +
            ` for m in [__import__('re').search(r'PACKAGE_VERSION\\s+"([^"]+)"',c)` +
            `           or __import__('re').search(r'PACKAGE_VERSION\\s+(\\d[\\d.]+)',c)]` +
            ` if m),'')`,
            frameId);
        logger.debug(`[versionInfo/eigen] cmake="${cmakeRaw}"`);
        const cmakeMatch = cmakeRaw?.match(/(\d+\.\d+(?:\.\d+)*)/);
        if (cmakeMatch) { return cmakeMatch[1]; }
    }

    // Strategy 2c: grep known header files (non-vcpkg / system installations).
    for (const rel of ["Eigen/src/Core/util/Macros.h", "Eigen/src/Core/util/Version.h"]) {
        const hp = `${eigenBase}/${rel}`;
        const headerRaw = await evaluateExpression(session,
            `/py (lambda os,re,p:` +
            `'.'.join(m.group(1) for n in ['EIGEN_WORLD_VERSION','EIGEN_MAJOR_VERSION','EIGEN_MINOR_VERSION']` +
            ` for m in [re.search('#define '+n+r' +([0-9]+)',open(p).read())] if m)` +
            ` if os.path.exists(p) else '')(__import__('os'),__import__('re'),'${hp}')`,
            frameId);
        logger.debug(`[versionInfo/eigen] header "${rel}": "${headerRaw}"`);
        const headerMatch = headerRaw?.match(/(\d+\.\d+(?:\.\d+)*)/);
        if (headerMatch) { return headerMatch[1]; }
    }

    return null;
}
