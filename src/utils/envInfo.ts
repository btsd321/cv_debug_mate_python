/**
 * envInfo.ts — Environment / runtime diagnostic logging for MatrixViewer.
 *
 * Provides three categories of information:
 *   1. Static host info (OS, Node.js, VS Code, extension version) — logged once at activation.
 *   2. Debug session info (type, name, launch config) — logged when each session starts.
 *   3. Runtime library versions:
 *      - Python: interpreter + imported libs (numpy, cv2, PIL, torch, open3d)
 *      - C++: routes to the per-debugger versionInfo coordinator, which in turn
 *             delegates to per-lib versionInfo files in libs/<libName>/versionInfo.ts
 *
 * C++ lib version logic lives in:
 *   src/adapters/cpp/{codelldb,gdb,cppvsdbg}/libs/{opencv,eigen,pcl}/versionInfo.ts
 * Per-debugger coordinators:
 *   src/adapters/cpp/{codelldb,gdb,cppvsdbg}/versionInfo.ts
 *
 * All logging goes through the shared `logger` singleton.
 */

import * as os from "os";
import * as vscode from "vscode";
import { logger } from "../log/logger";
import { logCppLibVersions as logLldbLibVersions } from "../adapters/cpp/codelldb/versionInfo";
import { logCppLibVersions as logGdbLibVersions } from "../adapters/cpp/gdb/versionInfo";
import { logCppLibVersions as logMsvcLibVersions } from "../adapters/cpp/cppvsdbg/versionInfo";

// ── Session deduplication ─────────────────────────────────────────────────

/** Session IDs whose lib-version lines have already been emitted. */
const _loggedSessions = new Set<string>();

// ── Static environment info ───────────────────────────────────────────────

/**
 * Log host environment facts once at extension activation.
 * @param extVersion The version string from `package.json`.
 */
export function logEnvironmentInfo(extVersion: string): void {
    logger.info("=== MatrixViewer Environment ===");
    logger.info(`OS:        ${os.type()} ${os.release()} (${os.arch()})`);
    logger.info(`OS ver:    ${os.version()}`);
    logger.info(`Node.js:   ${process.version}`);
    logger.info(`VS Code:   ${vscode.version}`);
    logger.info(`Extension: v${extVersion}`);
    logger.info("================================");
}

// ── Debug session info ────────────────────────────────────────────────────

/**
 * Log the identity and key configuration fields of a debug session.
 * Called from `onDidStartDebugSession`.
 */
export function logDebugSessionStarted(session: vscode.DebugSession): void {
    const cfg = session.configuration as Record<string, unknown>;
    logger.info(`[Session] type="${session.type}"  name="${session.name}"`);

    // C++ (cppdbg): MIMode tells us GDB vs LLDB vs MSVC
    if (cfg["MIMode"])         { logger.info(`[Session] MIMode: ${cfg["MIMode"]}`); }
    if (cfg["miDebuggerPath"]) { logger.info(`[Session] debugger path: ${cfg["miDebuggerPath"]}`); }
    if (cfg["program"])        { logger.info(`[Session] program: ${cfg["program"]}`); }

    // Python / Jupyter
    const pyPath = cfg["python"] ?? cfg["pythonPath"];
    if (pyPath)                { logger.info(`[Session] python: ${pyPath}`); }
}

// ── Shared DAP helper ─────────────────────────────────────────────────────

/** Resolve the top-most frame ID for the first thread. */
async function _getFrameId(session: vscode.DebugSession): Promise<number | undefined> {
    try {
        const threads = await session.customRequest("threads", {});
        const threadId: number | undefined = threads?.threads?.[0]?.id;
        if (threadId == null) { return undefined; }
        const stack = await session.customRequest("stackTrace", {
            threadId,
            startFrame: 0,
            levels: 1,
        });
        return stack?.stackFrames?.[0]?.id;
    } catch {
        return undefined;
    }
}

// ── Python runtime versions ───────────────────────────────────────────────

/**
 * Evaluate `sys.version` and the versions of already-imported libraries
 * (numpy, cv2, PIL, torch, open3d) in the active Python debug session.
 * Safe to call multiple times for the same session — only runs once.
 */
export async function logPythonRuntimeVersions(session: vscode.DebugSession): Promise<void> {
    if (_loggedSessions.has(session.id)) { return; }
    _loggedSessions.add(session.id);

    const frameId = await _getFrameId(session);

    const evalPy = async (expr: string): Promise<string | null> => {
        try {
            const r = await session.customRequest("evaluate", { expression: expr, frameId, context: "repl" });
            let v: string = (r?.result ?? "").trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1);
            }
            return v && v !== "None" && !v.startsWith("<") ? v : null;
        } catch { return null; }
    };

    const pyVer = await evalPy("__import__('sys').version.split('\\n')[0].strip()");
    if (pyVer) { logger.info(`[Python] interpreter: ${pyVer}`); }

    // Query versions of libs that are already imported (does NOT force-load them)
    const libJson = await evalPy(
        "__import__('json').dumps(" +
        "{k: v.__version__ for k, v in __import__('sys').modules.items() " +
        "if k in ('numpy', 'cv2', 'PIL', 'torch', 'open3d') and hasattr(v, '__version__')})"
    );
    if (libJson) {
        try {
            const libs = JSON.parse(libJson) as Record<string, string>;
            for (const [name, ver] of Object.entries(libs)) {
                logger.info(`[Python] ${name}: ${ver}`);
            }
        } catch { /* ignore */ }
    }
}

// ── C++ runtime library versions ─────────────────────────────────────────

/**
 * Route to the per-debugger C++ library version coordinator.
 * Each coordinator delegates to per-lib versionInfo files in
 * libs/<libName>/versionInfo.ts — no library-specific logic here.
 * Safe to call multiple times for the same session — only runs once.
 */
export async function logCppRuntimeVersions(session: vscode.DebugSession): Promise<void> {
    if (_loggedSessions.has(session.id)) { return; }
    _loggedSessions.add(session.id);

    if (session.type === "lldb") {
        await logLldbLibVersions(session);
    } else if (session.type === "cppvsdbg") {
        await logMsvcLibVersions(session);
    } else {
        // cppdbg (GDB / MI-based debuggers)
        await logGdbLibVersions(session);
    }
}
