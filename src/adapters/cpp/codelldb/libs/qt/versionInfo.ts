import * as vscode from "vscode";
import { evaluateExpression } from "../../debugger";
import { parseVersionNum } from "../../../shared/versionUtils";

/**
 * Return the Qt version string (e.g. "5.15.2") or null if Qt symbols are not
 * available in the current debug session.
 *
 * Strategy (tried in order):
 *   1. moduleVersion — version parsed from the DLL install path by the coordinator
 *      (e.g. C:\Qt\5.15.2\...\Qt5Cored.dll → "5.15.2"); works on Windows without
 *      any expression evaluation.  Falls back to major-only from filename when
 *      the path doesn't follow the standard Qt installer layout.
 *   2. QT_VERSION_MAJOR / QT_VERSION_MINOR / QT_VERSION_PATCH macros (Qt 5+) —
 *      available in DWARF debug info on Linux/macOS.
 *   3. qt_version — exported as `Q_CORE_EXPORT const char qt_version[]` from QtCore;
 *      accessible when Qt debug symbols are loaded.
 *   4. qVersion() — returns a const char* like "5.15.2"; works when LLDB can JIT.
 *
 * @param moduleVersion  Pre-resolved version from loaded DLL metadata (may be null).
 */
export async function fetchQtVersion(
    session: vscode.DebugSession,
    frameId: number | undefined,
    moduleVersion: string | null = null
): Promise<string | null> {
    // Strategy 1: integer macros — no JIT compilation required.
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

    // Strategy 2: qt_version global — Q_CORE_EXPORT const char qt_version[].
    const qtGlobal = await evaluateExpression(session, "qt_version", frameId);
    if (qtGlobal) {
        const cleanG = qtGlobal.replace(/^['"]+|['"]+$/g, "").trim();
        if (/^\d+\.\d+/.test(cleanG)) { return cleanG; }
    }

    // Strategy 3: qVersion() returns "5.15.2" as const char*.
    const raw = await evaluateExpression(session, "qVersion()", frameId);
    if (raw) {
        const clean = raw.replace(/^['"]+|['"]+$/g, "").trim();
        if (/^\d+\.\d+/.test(clean)) { return clean; }
    }

    // Strategy 4: DLL FILEVERSION from DAP modules (pre-resolved by coordinator).
    return moduleVersion;
}

