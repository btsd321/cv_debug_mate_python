/**
 * shared/debuggerBase.ts — Shared DAP utilities for all C++ debug adapters.
 *
 * Contains only functions that are fully debugger-agnostic:
 *   - No references to isUsingLLDB / isUsingMSVC / evaluate-context choices.
 *   - No expression-building (different debuggers use different cast syntax).
 *
 * Per-debugger functions (evaluate context, pointer expressions, etc.) live
 * in the respective debugger folders:
 *   cpp/gdb/debugger.ts
 *   cpp/cppvsdbg/debugger.ts
 *   cpp/codelldb/debugger.ts
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";

export { VariableInfo } from "../../IDebugAdapter";

// ── Frame & scope utilities ────────────────────────────────────────────────

/**
 * Return the frame ID to use for evaluate/variable requests.
 *
 * Priority:
 *   1. The user's actively-selected stack frame in the debug UI
 *   2. The top frame of the first thread (fallback)
 */
export async function getCurrentFrameId(
    session: vscode.DebugSession
): Promise<number | undefined> {
    try {
        const activeStackItem = vscode.debug.activeStackItem;
        if (activeStackItem && "frameId" in activeStackItem) {
            return (activeStackItem as vscode.DebugStackFrame).frameId;
        }

        const threadsResp = await session.customRequest("threads", {});
        const threadId: number = threadsResp?.threads?.[0]?.id;
        if (threadId == null) {
            return undefined;
        }

        const stackResp = await session.customRequest("stackTrace", {
            threadId,
            startFrame: 0,
            levels: 1,
        });
        return stackResp?.stackFrames?.[0]?.id;
    } catch {
        return undefined;
    }
}

/**
 * Look up a single variable by name in the current frame's local scope.
 * Returns a VariableInfo with the real DAP type string, or null if not found.
 */
export async function getVariableInfo(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<VariableInfo | null> {
    try {
        const resolvedFrame = frameId ?? (await getCurrentFrameId(session));
        if (resolvedFrame == null) {
            return null;
        }

        const scopesResp = await session.customRequest("scopes", { frameId: resolvedFrame });
        const localScopeRef: number | undefined = scopesResp?.scopes?.[0]?.variablesReference;
        if (localScopeRef == null) {
            return null;
        }

        const varsResp = await session.customRequest("variables", {
            variablesReference: localScopeRef,
        });

        const match = (varsResp?.variables ?? []).find(
            (v: { name: string }) => v.name === varName
        );
        if (!match) {
            return null;
        }

        return {
            name: match.name,
            type: match.type ?? "",
            typeName: match.type ?? "",
            variablesReference: match.variablesReference,
            frameId: resolvedFrame,
        };
    } catch {
        return null;
    }
}

// ── cv::Mat children-based type fallback ─────────────────────────────────

// Members guaranteed to exist in every cv::Mat instance.
const CV_MAT_REQUIRED_FIELDS = new Set(["flags", "dims", "rows", "cols", "data"]);

/**
 * For debuggers that don't report Variable.type for cv::Mat (e.g. CodeLLDB
 * on Windows with PDB symbols), inspect the first level of child variables
 * and check whether their names match the known cv::Mat memory layout.
 * Returns "cv::Mat" if confident, or "" otherwise.
 */
export async function detectCvMatFromChildren(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<string> {
    try {
        const resp = await session.customRequest("variables", {
            variablesReference,
        });
        const childNames: string[] = (resp?.variables ?? []).map(
            (c: { name: string }) => c.name
        );
        const matchCount = childNames.filter((n) =>
            CV_MAT_REQUIRED_FIELDS.has(n)
        ).length;
        if (matchCount >= 4) {
            return "cv::Mat";
        }
    } catch {
        // ignore
    }
    return "";
}

// ── Memory reading ────────────────────────────────────────────────────────

const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB per chunk
const CHUNK_TIMEOUT_MS = 30_000;

/**
 * Check whether a hex address string represents a plausible pointer
 * (non-null, non-zero, above the page-zero boundary).
 */
export function isValidMemoryReference(ref: string | undefined): boolean {
    if (!ref) {
        return false;
    }
    if (
        ref === "0x0" ||
        ref === "0x0000000000000000" ||
        ref === "0x00000000"
    ) {
        return false;
    }
    const addr = parseInt(ref, 16);
    return !isNaN(addr) && addr >= 0x1000;
}

/**
 * Read `totalBytes` bytes starting at `memoryReference`, fetching in 4 MB chunks
 * to stay within DAP/debugger request-size limits.
 *
 * Returns a Uint8Array on success, or null on any failure.
 */
export async function readMemoryChunked(
    session: vscode.DebugSession,
    memoryReference: string,
    totalBytes: number
): Promise<Uint8Array | null> {
    if (totalBytes <= 0 || !isValidMemoryReference(memoryReference)) {
        return null;
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;

    while (offset < totalBytes) {
        const count = Math.min(CHUNK_SIZE, totalBytes - offset);
        try {
            const resp = await Promise.race([
                session.customRequest("readMemory", {
                    memoryReference,
                    offset,
                    count,
                }),
                new Promise<null>((_, reject) =>
                    setTimeout(
                        () => reject(new Error("Memory read timeout")),
                        CHUNK_TIMEOUT_MS
                    )
                ),
            ]) as { data?: string } | null;

            if (!resp?.data) {
                return null;
            }

            const bytes = Buffer.from(resp.data, "base64");
            result.set(new Uint8Array(bytes), offset);
            offset += bytes.length;
        } catch {
            return null;
        }
    }

    return result;
}

// ── std::vector size parsing ─────────────────────────────────────────────

/**
 * Parse the element count of a std::vector / std::array from the DAP value string.
 * Different debugger front-ends format the value differently (MSVC, GDB, LLDB).
 */
export function parseSizeFromValue(value: string): number {
    if (!value) {
        return 0;
    }
    const m =
        value.match(/size\s*=\s*(\d+)/) ??
        value.match(/length\s*=\s*(\d+)/) ??
        value.match(/of length (\d+)/) ??
        value.match(/\[(\d+)\]/) ??
        value.match(/^(\d+)$/);
    if (m) {
        return parseInt(m[1]);
    }
    // Count comma-separated elements inside `{...}`
    const braceM = value.match(/\{([^}]+)\}/);
    if (braceM) {
        const content = braceM[1].trim();
        if (content && content !== "...") {
            const elems = content
                .split(",")
                .filter((s) => s.trim().length > 0 && s.trim() !== "...");
            if (elems.length > 0) {
                return elems.length;
            }
        }
    }
    return 0;
}
