import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";
import { logger } from "../../../../../log/logger";

/**
 * LLDB /py expression: scan debug-info support file paths for any path
 * containing "/QtCore/" (case-insensitive), extract the Qt include root,
 * then try reading QtCore/qconfig.h and QtCore/qglobal.h for QT_VERSION_STR.
 *
 * qconfig.h is a generated platform-specific file that reliably defines
 * QT_VERSION_STR in all Qt5/Qt6 installations.
 */
const QT_HEADER_SCAN_EXPR = (
    `/py (lambda re,os:` +
    `(lambda base:` +
    `next((` +
    `ver` +
    ` for name in ['qconfig.h','qglobal.h']` +
    ` for path in [base+'/QtCore/'+name]` +
    ` if os.path.exists(path)` +
    ` for c in [open(path).read()]` +
    ` for m in [re.search(r'QT_VERSION_STR +"' + r'([0-9][^"]+)"',c)]` +
    ` if m` +
    ` for ver in [m.group(1)]` +
    `),'') if base else '')` +
    `(next((p[:i]` +
    ` for mod in lldb.target.modules` +
    ` for j in range(mod.GetNumCompileUnits())` +
    ` for cu in [mod.GetCompileUnitAtIndex(j)]` +
    ` for k in range(cu.GetNumSupportFiles())` +
    ` for p in [str(cu.GetSupportFileAtIndex(k)).replace('\\\\','/')]` +
    ` for i in [p.lower().find('/qtcore/')] if i>=0),''))` +
    `)(__import__('re'),__import__('os'))`
);

/**
 * Return the Qt version string (e.g. "5.15.2") or null if Qt symbols are not
 * available in the current debug session.
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version read from the PE FILEVERSION resource of the
 *      loaded DLL (Windows) or SO filename suffix (Linux: libQt5Core.so.5.15.2).
 *   2. QT_VERSION_MAJOR / QT_VERSION_MINOR / QT_VERSION_PATCH macros (Qt 5+) —
 *      available in DWARF debug info on Linux/macOS.
 *   3. qt_version — exported as \`Q_CORE_EXPORT const char qt_version[]\` from QtCore;
 *      accessible when Qt debug symbols are loaded.
 *   4. qVersion() — returns a const char* like "5.15.2"; works when LLDB can JIT.
 *   5. Header scan via LLDB /py — reads QtCore/qconfig.h from the include path
 *      found in debug-info support files; works when JIT and macros are unavailable.
 *
 * @param moduleVersion  Pre-resolved version from loaded module metadata (may be null).
 */
export async function fetchQtVersion(
    session: vscode.DebugSession,
    frameId: number | undefined,
    moduleVersion: string | null = null
): Promise<string | null> {
    // Strategy 2: integer macros — no JIT compilation required.
    const major = parseVersionNum(await evaluateExpression(session, "QT_VERSION_MAJOR", frameId));
    if (major !== null) {
        const [minorRaw, patchRaw] = await Promise.all([
            evaluateExpression(session, "QT_VERSION_MINOR", frameId),
            evaluateExpression(session, "QT_VERSION_PATCH", frameId),
        ]);
        const minor = parseVersionNum(minorRaw) ?? "?";
        const patch = parseVersionNum(patchRaw) ?? "?";
        return `${major}.${minor}.${patch}`;
    }

    // Strategy 3: qt_version global — Q_CORE_EXPORT const char qt_version[].
    const qtGlobal = await evaluateExpression(session, "qt_version", frameId);
    if (qtGlobal) {
        const cleanG = qtGlobal.replace(/^['"]+|['"]+$/g, "").trim();
        if (/^\d+\.\d+/.test(cleanG)) { return cleanG; }
    }

    // Strategy 4: qVersion() returns "5.15.2" as const char*.
    const raw = await evaluateExpression(session, "qVersion()", frameId);
    if (raw) {
        const clean = raw.replace(/^['"]+|['"]+$/g, "").trim();
        if (/^\d+\.\d+/.test(clean)) { return clean; }
    }

    // Strategy 5: header scan via LLDB Python (Linux/macOS, no JIT or macros needed).
    const headerResult = await evaluateExpression(session, QT_HEADER_SCAN_EXPR, frameId);
    logger.debug(`[versionInfo/qt] header scan: raw="${headerResult}"`);
    if (headerResult) {
        const clean = headerResult.replace(/^['"]+|['"]+$/g, "").trim();
        if (/^\d+\.\d+/.test(clean)) { return clean; }
    }

    // Strategy 1 (passed in): module version from SO/DLL metadata.
    return moduleVersion;
}
