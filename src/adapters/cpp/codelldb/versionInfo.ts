/**
 * codelldb/versionInfo.ts — C++ library version coordinator for CodeLLDB sessions.
 *
 * Aggregates version strings from all supported libraries and logs them.
 * Each library's fetch logic lives in its own libs/<libName>/versionInfo.ts.
 *
 * Version detection order:
 *   1. LLDB Python API via CodeLLDB `/py` prefix — `lldb.SBModule.GetVersion()`
 *      reads the PE VS_VERSIONINFO FILEVERSION resource directly from the DLL
 *      binary (no JIT, no symbols, no macros needed).
 *   2. DAP `modules` request — parse version from loaded DLL's filename or
 *      install-directory path as a fallback when Python API is unavailable.
 *   3. Per-library expression-based strategies (macros, function calls, globals).
 */

import * as vscode from "vscode";
import { getCurrentFrameId, evaluateExpression } from "./debugger";
import { logger } from "../../../log/logger";
import { fetchOpenCvVersion } from "./libs/opencv/versionInfo";
import { fetchEigenVersion } from "./libs/eigen/versionInfo";
import { fetchPclVersion } from "./libs/pcl/versionInfo";
import { fetchQtVersion } from "./libs/qt/versionInfo";

// ── DAP module helpers ────────────────────────────────────────────────────

type DapModule = { name?: string; path?: string; version?: string };

/**
 * Return the basename of the first loaded module whose name matches `pattern`.
 */
function findModuleBasename(mods: DapModule[], pattern: RegExp): string | null {
    const mod = mods.find((m) => pattern.test(m.name ?? ""));
    return mod?.name ?? null;
}

/**
 * Query a module's PE FILEVERSION via Win32 ctypes in CodeLLDB's Python context.
 *
 * CodeLLDB exposes the `/py` prefix to run Python expressions in its embedded
 * LLDB Python interpreter (documented in MANUAL.md).
 * Uses `GetFileVersionInfoW` + `VerQueryValueW` (Win32 version.dll) via Python
 * ctypes to read the PE VS_VERSIONINFO FILEVERSION resource directly —
 * no JIT, no macros, no symbol table needed.
 *
 * `m.file.GetFilename()` is used instead of `m.file.basename` because
 * `GetFilename()` is a method available in all LLDB Python binding versions.
 *
 *   moduleVersionFromPy(session, frameId, "opencv_core4d.dll") → "4.8.3"
 *   moduleVersionFromPy(session, frameId, "Qt5Cored.dll")      → "5.15.2"
 */
async function moduleVersionFromPy(
    session: vscode.DebugSession,
    frameId: number | undefined,
    basename: string
): Promise<string | null> {
    const lower = basename.toLowerCase();
    // VS_FIXEDFILEINFO DWORD layout (offset from struct start):
    //   [0] dwSignature, [1] dwStrucVersion,
    //   [2] dwFileVersionMS → major = >>16, minor = &0xFFFF
    //   [3] dwFileVersionLS → patch = >>16
    // The Python expression is a single lambda chain (no statements allowed in /py):
    //   1. Find the module's full path via m.file.GetPath() / m.file.GetFilename()
    //   2. Call GetFileVersionInfoSizeW to get buffer size
    //   3. Allocate buffer, call GetFileVersionInfoW to populate it
    //   4. Call VerQueryValueW(buf, '\\', ...) to get pointer to VS_FIXEDFILEINFO
    //   5. Cast + slice to read dwFileVersionMS and dwFileVersionLS
    const expr = (
        `/py (lambda ct,path:` +
        `(lambda sz:(lambda buf:` +
        `(lambda pv,n:` +
        `(lambda fi:'.'.join(map(str,[fi[2]>>16,fi[2]&0xffff,fi[3]>>16]))` +
        ` if fi and fi[2]>>16>0 else '')` +
        `(ct.cast(pv.value,ct.POINTER(ct.c_uint32*13)).contents if pv.value else None)` +
        ` if ct.windll.version.VerQueryValueW(buf,'\\\\',ct.byref(pv),ct.byref(n)) else '')` +
        `(ct.c_void_p(),ct.c_uint())` +
        ` if ct.windll.version.GetFileVersionInfoW(path,0,sz,buf) else '')` +
        `(ct.create_string_buffer(sz)) if sz else '')` +
        `(ct.windll.version.GetFileVersionInfoSizeW(path,None)) if path else '')` +
        `(__import__('ctypes'),next((str(m.file) for m in lldb.target.modules if m.file.GetFilename().lower()=='${lower}'),''))`
    );
    const result = await evaluateExpression(session, expr, frameId);
    logger.debug(`[versionInfo] moduleVersionFromPy("${basename}"): raw="${result}"`);
    if (!result) { return null; }
    const m = result.match(/(\d+\.\d+(?:\.\d+)*)/);
    return m ? m[1] : null;
}

// ── Filename / path fallbacks ─────────────────────────────────────────────

/**
 * Extract OpenCV version from a loaded module filename.
 *
 * Windows DLL: opencv_core480d.dll  →  4.8.0
 * Linux SO:    libopencv_core.so.4.8.0  →  4.8.0
 */
function cvVersionFromModules(mods: DapModule[]): string | null {
    const mod = mods.find((m) =>
        /opencv_(?:world|core|videoio|imgproc)/i.test(m.name ?? "")
    );
    if (!mod) { return null; }
    const name = mod.name ?? "";
    // Windows: opencv_core480d.dll → 4.8.0
    const winM = name.match(
        /opencv_(?:world|core|videoio|imgproc)(\d)(\d{1,2})(\d)d?\.dll/i
    );
    if (winM) { return `${winM[1]}.${winM[2]}.${winM[3]}`; }
    // Linux: libopencv_core.so.4.8.0
    const linuxM = name.match(/\.so\.(\d+\.\d+\.\d+)$/);
    if (linuxM) { return linuxM[1]; }
    return null;
}

/**
 * Extract Qt version from a loaded module path or filename.
 *
 * Windows DLL: Qt5Cored.dll under C:\Qt\5.15.2\...  →  "5.15.2"
 * Linux SO:    libQt5Core.so.5.15.2  →  "5.15.2"
 */
function qtVersionFromModules(mods: DapModule[]): string | null {
    // Windows: Qt5Cored.dll, Qt6Core.dll
    const winMod = mods.find((m) => /Qt[56]Core(?:d)?\.dll/i.test(m.name ?? ""));
    if (winMod) {
        const fullPath = (winMod.path ?? winMod.name ?? "").replace(/\\/g, "/");
        // Standard Qt installer layout: "/Qt/5.15.2/" or "/Qt/6.7.0/"
        const pathM = fullPath.match(/\/Qt\/(\d+\.\d+(?:\.\d+)*)\//);
        if (pathM) { return pathM[1]; }
        // Fallback: major version only from filename
        const nameM = (winMod.name ?? "").match(/Qt(\d)Core/i);
        if (nameM) { return nameM[1]; }
    }
    // Linux: libQt5Core.so.5.15.2, libQt6Core.so.6.7.0
    const linuxMod = mods.find((m) => /libQt[56]Core\.so/i.test(m.name ?? ""));
    if (linuxMod) {
        const soM = (linuxMod.name ?? "").match(/\.so\.(\d+\.\d+(?:\.\d+)*)/);
        if (soM) { return soM[1]; }
    }
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

    // ── Step 1: LLDB Python API — reads PE FILEVERSION directly ──────────
    const cvBasename  = findModuleBasename(mods, /opencv_(?:world|core|videoio|imgproc)/i);
    const qtBasename  = findModuleBasename(mods, /Qt[56]Core(?:d)?\.dll/i);
    const pclBasename = findModuleBasename(mods, /pcl_common/i);

    const [cvPyVer, qtPyVer, pclPyVer] = await Promise.all([
        cvBasename  ? moduleVersionFromPy(session, frameId, cvBasename)  : Promise.resolve(null),
        qtBasename  ? moduleVersionFromPy(session, frameId, qtBasename)  : Promise.resolve(null),
        pclBasename ? moduleVersionFromPy(session, frameId, pclBasename) : Promise.resolve(null),
    ]);

    // ── Step 2: Filename/path fallbacks ───────────────────────────────────
    const cvModVer  = cvPyVer  ?? cvVersionFromModules(mods);
    const qtModVer  = qtPyVer  ?? qtVersionFromModules(mods);
    const pclModVer = pclPyVer ?? pclVersionFromModules(mods);
    logger.debug(`[versionInfo] module ver: cv="${cvModVer ?? ""}" qt="${qtModVer ?? ""}" pcl="${pclModVer ?? ""}"`);

    // ── Step 3: Per-library expression strategies ─────────────────────────
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
