/**
 * cppvsdbg/versionInfo.ts — C++ library version coordinator for cppvsdbg sessions.
 *
 * cppvsdbg (vsdbg) cannot evaluate preprocessor macros or call arbitrary C++
 * functions via the DAP evaluate request (returns "identifier is undefined").
 * Therefore ALL version detection avoids expression evaluation entirely:
 *
 *   1. DAP `modules` response — vsdbg already populates the `version` field for
 *      every loaded DLL from its PE FILEVERSION resource. We use this directly:
 *        opencv_core4d.dll  → version "4.12.0.0" → "4.12.0"
 *        Qt5Cored.dll       → version "5.15.18.0" → "5.15.18"
 *        pcl_common_debug.dll → version "1.x.y.0" → "1.x.y"  (if DLL is present)
 *
 *   2. CMakeCache.txt (extension host fs) — for header-only / statically-linked
 *      libraries whose DLLs never appear in the modules list (Eigen, static PCL).
 *      Walk up from the exe directory to find CMakeCache.txt, extract any vcpkg
 *      installed-root path (pattern: …/installed/<triplet>/), then read
 *      share/<lib>/*.cmake for PACKAGE_VERSION.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { logger } from "../../../log/logger";

type DapModule = { name?: string; path?: string; version?: string };

// ── Helpers ───────────────────────────────────────────────────────────────

function normPath(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * Trim the 4th (build) component from a PE FILEVERSION string.
 * PE FILEVERSION is always MAJOR.MINOR.PATCH.BUILD.
 * "4.12.0.0" → "4.12.0"   "5.15.18.0" → "5.15.18"   "1.15.1.0" → "1.15.1"
 * Only strips when exactly 4 parts and the 4th is "0" — never shortens further.
 */
function trimFileVersion(ver: string): string {
    const base = ver.split(" ")[0];          // strip " (WinBuild…)" suffix
    const parts = base.split(".");
    if (parts.length === 4 && parts[3] === "0") {
        return parts.slice(0, 3).join(".");
    }
    return base;
}

/**
 * Return the version string for the first loaded module whose name matches
 * `pattern`, using the `version` field already provided by vsdbg in the DAP
 * modules response (populated from the DLL's PE FILEVERSION resource).
 */
function moduleVersion(mods: DapModule[], pattern: RegExp): string | null {
    const mod = mods.find(
        (m) => pattern.test(m.name ?? "") && m.version && m.version !== "undefined"
    );
    if (!mod?.version) { return null; }
    const v = trimFileVersion(mod.version);
    return /^\d+\.\d+/.test(v) ? v : null;
}

/**
 * Walk up from the .exe module's directory (up to 4 levels) looking for a
 * CMakeCache.txt, then extract the vcpkg installed-root from any entry whose
 * value contains …/installed/<triplet>/.
 *
 * Example: "D:/Library/vcpkg/installed/x64-windows"
 */
function vcpkgRootFromCmakeCache(mods: DapModule[]): string | null {
    const exeMod = mods.find((m) => /\.exe$/i.test(m.name ?? ""));
    if (!exeMod?.path) { return null; }

    let dir = path.dirname(normPath(exeMod.path));
    for (let i = 0; i < 4; i++) {
        const cacheFile = `${dir}/CMakeCache.txt`;
        try {
            if (fs.existsSync(cacheFile)) {
                const content = fs.readFileSync(cacheFile, "utf8");
                // Match any value that contains a vcpkg installed/<triplet>/ segment.
                const m = content.match(/=([^\r\n]*\/installed\/([^/\\\r\n]+))[\\/]/i);
                if (m) { return normPath(m[1]); }  // "…/installed/<triplet>"
            }
        } catch { /* unreadable */ }
        const parent = path.dirname(dir);
        if (parent === dir) { break; }
        dir = parent;
    }
    return null;
}

/**
 * Read PACKAGE_VERSION from any *.cmake file in `<vcpkgRoot>/share/<shareLib>/`.
 */
function readCmakeVersion(vcpkgRoot: string, shareLib: string): string | null {
    const shareDir = `${vcpkgRoot}/share/${shareLib}`;
    try {
        if (!fs.existsSync(shareDir)) {
            logger.debug(`[versionInfo][cppvsdbg] cmake: shareDir not found: ${shareDir}`);
            return null;
        }
        const all = fs.readdirSync(shareDir).filter((f) => f.endsWith(".cmake"));
        // Prioritise *ConfigVersion.cmake — the canonical cmake version file.
        const ordered = [
            ...all.filter((f) => /configversion\.cmake$/i.test(f)),
            ...all.filter((f) => !/configversion\.cmake$/i.test(f)),
        ];
        for (const f of ordered) {
            const content = fs.readFileSync(`${shareDir}/${f}`, "utf8");
            const m = content.match(/PACKAGE_VERSION\s+"([^"]+)"/)
                    ?? content.match(/PACKAGE_VERSION\s+(\d[\d.]+)/);
            if (m) {
                logger.debug(`[versionInfo][cppvsdbg] cmake ${shareLib}: file="${f}" version="${m[1]}"`);
                return m[1];
            }
        }
        logger.debug(`[versionInfo][cppvsdbg] cmake ${shareLib}: no PACKAGE_VERSION found in [${ordered.join(", ")}]`);
    } catch (e) { logger.debug(`[versionInfo][cppvsdbg] cmake ${shareLib}: error ${e}`); }
    return null;
}

// ── Coordinator ───────────────────────────────────────────────────────────

/**
 * Fetch and log available C++ library versions for a cppvsdbg session.
 * Does NOT use expression evaluation — all detection is from DAP module
 * version fields and cmake config files read by the extension host.
 */
export async function logCppLibVersions(session: vscode.DebugSession): Promise<void> {
    let mods: DapModule[] = [];
    try {
        const resp = await session.customRequest("modules", { startModule: 0, moduleCount: 500 });
        mods = resp?.modules ?? [];
    } catch { /* modules request not supported */ }

    logger.debug(
        `[versionInfo][cppvsdbg] modules=${mods.length}: ` +
        mods.slice(0, 15).map((m) => m.name ?? "?").join(", ") +
        (mods.length > 15 ? ` … (${mods.length} total)` : "")
    );

    // Step 1: version from PE FILEVERSION via vsdbg DAP modules response
    const cvVer  = moduleVersion(mods, /opencv_(?:world|core|videoio|imgproc)\d*d?\.dll/i);
    const qtVer  = moduleVersion(mods, /Qt[56]Core(?:d)?\.dll/i);
    const pclVer = moduleVersion(mods, /pcl_common/i);

    // Step 2: vcpkg cmake config for header-only / statically-linked libs
    const vcpkgRoot = vcpkgRootFromCmakeCache(mods);
    logger.debug(`[versionInfo][cppvsdbg] vcpkgRoot="${vcpkgRoot}"`);

    const eigenVer    = vcpkgRoot ? readCmakeVersion(vcpkgRoot, "eigen3") : null;
    const pclFallback = (!pclVer && vcpkgRoot) ? readCmakeVersion(vcpkgRoot, "pcl") : null;
    const qtFallback  = (!qtVer  && vcpkgRoot)
        ? (readCmakeVersion(vcpkgRoot, "Qt5") ?? readCmakeVersion(vcpkgRoot, "Qt6"))
        : null;

    const finalQt  = qtVer  ?? qtFallback;
    const finalPcl = pclVer ?? pclFallback;

    logger.debug(`[versionInfo][cppvsdbg] cv="${cvVer}" eigen="${eigenVer}" pcl="${finalPcl}" qt="${finalQt}"`);

    if (cvVer)    { logger.info(`[C++] OpenCV: ${cvVer}`); }
    if (eigenVer) { logger.info(`[C++] Eigen:  ${eigenVer}`); }
    if (finalPcl) { logger.info(`[C++] PCL:    ${finalPcl}`); }
    if (finalQt)  { logger.info(`[C++] Qt:     ${finalQt}`); }
}
