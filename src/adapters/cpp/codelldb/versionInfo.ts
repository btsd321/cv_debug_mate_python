/**
 * codelldb/versionInfo.ts — C++ library version coordinator for CodeLLDB sessions.
 *
 * Aggregates version strings from all supported libraries and logs them.
 * Each library's fetch logic lives in its own libs/<libName>/versionInfo.ts.
 *
 * Version detection order:
 *   1. DAP `modules` request — parses version from the loaded DLL's filename or
 *      install-directory path (CodeLLDB never populates the DAP `version` field,
 *      so we extract version from the module `name` / `path` strings instead).
 *   2. Per-library expression-based strategies (macros, function calls, globals).
 */

import * as vscode from "vscode";
import { getCurrentFrameId } from "./debugger";
import { logger } from "../../../log/logger";
import { fetchOpenCvVersion } from "./libs/opencv/versionInfo";
import { fetchEigenVersion } from "./libs/eigen/versionInfo";
import { fetchPclVersion } from "./libs/pcl/versionInfo";
import { fetchQtVersion } from "./libs/qt/versionInfo";

// ── DAP module helpers ────────────────────────────────────────────────────

type DapModule = { name?: string; path?: string; version?: string };

/**
 * Extract OpenCV version from a loaded DLL filename.
 *
 * OpenCV encodes the version as a compact decimal suffix on the DLL name:
 *   opencv_core480d.dll  →  4.8.0
 *   opencv_world4100.dll →  4.10.0
 *
 * Pattern: <libname><major><minor1-2><patch>[d].dll
 */
function cvVersionFromModules(mods: DapModule[]): string | null {
    const mod = mods.find((m) =>
        /opencv_(?:world|core|videoio|imgproc)\d*d?\.(?:dll|so)/i.test(m.name ?? "")
    );
    if (!mod) { return null; }
    const m = (mod.name ?? "").match(
        /opencv_(?:world|core|videoio|imgproc)(\d)(\d{1,2})(\d)d?\.(?:dll|so)/i
    );
    if (m) { return `${m[1]}.${m[2]}.${m[3]}`; }
    return null;
}

/**
 * Extract Qt version from a loaded DLL path or filename.
 *
 * Standard Qt installer places DLLs under  …\Qt\<version>\<platform>\bin\
 * so the full version can be read from the path:
 *   C:\Qt\5.15.2\msvc2019_64\bin\Qt5Cored.dll  →  "5.15.2"
 *
 * When the path doesn't contain the version directory layout, fall back to
 * the major version extracted from the DLL filename:
 *   Qt5Cored.dll  →  "5"
 */
function qtVersionFromModules(mods: DapModule[]): string | null {
    const mod = mods.find((m) => /Qt[56]Core(?:d)?\.dll/i.test(m.name ?? ""));
    if (!mod) { return null; }
    // Normalise path separators for consistent matching.
    const fullPath = (mod.path ?? mod.name ?? "").replace(/\\/g, "/");
    // Standard Qt installer layout: "/Qt/5.15.2/" or "/Qt/6.7.0/"
    const pathM = fullPath.match(/\/Qt\/(\d+\.\d+(?:\.\d+)*)\//i);
    if (pathM) { return pathM[1]; }
    // Fallback: major version only from filename ("Qt5Core.dll" → "5")
    const nameM = (mod.name ?? "").match(/Qt(\d)Core/i);
    if (nameM) { return nameM[1]; }
    return null;
}

/**
 * Extract PCL version from a loaded DLL path.
 *
 * Standard PCL installer places files under  …\PCL <version>\bin\
 *   C:\PCL 1.13.0\bin\pcl_common_debug.dll  →  "1.13.0"
 *   C:\Program Files\PCL\1.13.0\bin\...     →  "1.13.0"
 */
function pclVersionFromModules(mods: DapModule[]): string | null {
    const mod = mods.find((m) => /pcl_common/i.test(m.name ?? ""));
    if (!mod) { return null; }
    const fullPath = (mod.path ?? mod.name ?? "").replace(/\\/g, "/");
    // Matches "PCL 1.13.0" or "PCL/1.13.0" in the path
    const pathM = fullPath.match(/PCL[\s/](\d+\.\d+(?:\.\d+)*)/i);
    if (pathM) { return pathM[1]; }
    return null;
}

/**
 * Fetch and log available C++ library versions for a CodeLLDB session.
 * Failures for individual libraries are silently ignored.
 */
export async function logCppLibVersions(session: vscode.DebugSession): Promise<void> {
    const [frameId, modulesResp] = await Promise.all([
        getCurrentFrameId(session),
        (async () => {
            try { return await session.customRequest("modules", { startModule: 0, moduleCount: 500 }); }
            catch { return null; }
        })(),
    ]);
    const mods: DapModule[] = modulesResp?.modules ?? [];
    logger.debug(
        `[versionInfo] loaded modules (${mods.length}): ` +
        mods.slice(0, 20).map((m) => m.name ?? m.path ?? "?").join(", ") +
        (mods.length > 20 ? ` … (${mods.length} total)` : "")
    );

    // Extract per-library version hints from the modules list.
    // Passed to each fetcher as a pre-resolved string (last-resort fallback).
    const cvModVer  = cvVersionFromModules(mods);
    const qtModVer  = qtVersionFromModules(mods);
    const pclModVer = pclVersionFromModules(mods);

    const [cvVer, eigenVer, pclVer, qtVer] = await Promise.all([
        fetchOpenCvVersion(session, frameId, cvModVer),
        fetchEigenVersion(session, frameId),
        fetchPclVersion(session, frameId, pclModVer),
        fetchQtVersion(session, frameId, qtModVer),
    ]);
    if (cvVer)    { logger.info(`[C++] OpenCV: ${cvVer}`); }
    if (eigenVer) { logger.info(`[C++] Eigen:  ${eigenVer}`); }
    if (pclVer)   { logger.info(`[C++] PCL:    ${pclVer}`); }
    if (qtVer)    { logger.info(`[C++] Qt:     ${qtVer}`); }
}
