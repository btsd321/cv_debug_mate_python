/**
 * cppDebugger.ts — DAP communication layer for C++ debug sessions.
 *
 * Provides:
 *   - Debugger type detection (lldb / cppdbg / cppvsdbg)
 *   - Frame ID resolution (prefers user-selected stack frame)
 *   - Variable enumeration via DAP scopes/variables requests
 *   - Expression evaluation with per-debugger context ("watch" / "repl")
 *   - Chunked memory reading via DAP readMemory
 *   - cv::Mat child-variable inspection (rows, cols, flags, data)
 *   - std::vector data-pointer extraction
 *
 * This module is internal to the C++ adapter.
 * External code should use CppAdapter (cppAdapter.ts) instead.
 *
 * References:
 *   - cv_debug_mate_cpp debugger.ts / opencv.ts
 *   - DAP specification: https://microsoft.github.io/debug-adapter-protocol/
 */

import * as vscode from "vscode";
import { VariableInfo } from "../IDebugAdapter";

export { VariableInfo } from "../IDebugAdapter";

// ── Debugger type detection ────────────────────────────────────────────────

export function isUsingLLDB(session: vscode.DebugSession): boolean {
    return session.type === "lldb";
}

export function isUsingCppdbg(session: vscode.DebugSession): boolean {
    return session.type === "cppdbg";
}

export function isUsingMSVC(session: vscode.DebugSession): boolean {
    return session.type === "cppvsdbg";
}

export function isSupportedCppSession(session: vscode.DebugSession): boolean {
    return isUsingLLDB(session) || isUsingCppdbg(session) || isUsingMSVC(session);
}

/**
 * Return the evaluate context appropriate for the debugger:
 *   - CodeLLDB ("lldb") treats "repl" as command mode → use "watch"
 *   - cppdbg / cppvsdbg accept "repl" for expression evaluation
 */
export function getEvaluateContext(session: vscode.DebugSession): string {
    return isUsingLLDB(session) ? "watch" : "repl";
}

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
        // Prefer the frame the user has selected in the call stack
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
 * List all variables visible in the top frame of the first thread.
 * Returns VariableInfo objects with name, type, variablesReference, and frameId.
 */
export async function getVariablesInScope(
    session: vscode.DebugSession
): Promise<VariableInfo[]> {
    try {
        const frameId = await getCurrentFrameId(session);
        if (frameId == null) {
            return [];
        }

        const scopesResp = await session.customRequest("scopes", { frameId });
        const localScopeRef: number | undefined =
            scopesResp?.scopes?.[0]?.variablesReference;
        if (localScopeRef == null) {
            return [];
        }

        const varsResp = await session.customRequest("variables", {
            variablesReference: localScopeRef,
        });

        return (varsResp?.variables ?? []).map(
            (v: {
                name: string;
                type: string;
                variablesReference: number;
                value: string;
            }) => ({
                name: v.name,
                type: v.type ?? "",
                variablesReference: v.variablesReference,
                frameId,
            })
        );
    } catch {
        return [];
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

// ── Expression evaluation ─────────────────────────────────────────────────

const EVALUATE_TIMEOUT_MS = 10_000;

/**
 * Evaluate a C++ expression in the context of the current frame.
 * Uses "watch" context for LLDB, "repl" for all others.
 * Returns the result string or null on failure / timeout.
 */
export async function evaluateExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string | null> {
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));
    const context = getEvaluateContext(session);

    const inner = async (): Promise<string | null> => {
        try {
            const r = await session.customRequest("evaluate", {
                expression,
                frameId: resolvedFrame,
                context,
            });
            return r?.result ?? null;
        } catch {
            return null;
        }
    };
    return Promise.race([
        inner(),
        new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), EVALUATE_TIMEOUT_MS)
        ),
    ]);
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

// ── Data-pointer helpers ──────────────────────────────────────────────────

/**
 * Try each expression in sequence until one yields a valid hex pointer.
 * Checks both `.memoryReference` (DAP field) and parses `0x…` from `.result`.
 */
export async function tryGetDataPointer(
    session: vscode.DebugSession,
    expressions: string[],
    frameId?: number
): Promise<string | null> {
    const context = getEvaluateContext(session);
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));

    for (const expr of expressions) {
        try {
            const resp = await session.customRequest("evaluate", {
                expression: expr,
                frameId: resolvedFrame,
                context,
            });

            if (resp?.memoryReference && isValidMemoryReference(resp.memoryReference)) {
                return resp.memoryReference;
            }

            const ptrMatch = resp?.result?.match(/0x[0-9a-fA-F]+/);
            if (ptrMatch && isValidMemoryReference(ptrMatch[0])) {
                return ptrMatch[0];
            }
        } catch {
            // Try next expression
        }
    }

    return null;
}

/**
 * Build debugger-specific expressions to obtain a data pointer for a container.
 * Covers std::vector, std::array, cv::Mat, and raw pointers.
 */
export function buildDataPointerExpressions(
    session: vscode.DebugSession,
    varName: string,
    accessPath = ".data()"
): string[] {
    if (isUsingMSVC(session)) {
        return [
            `(long long)${varName}${accessPath}`,
            `(long long)&${varName}[0]`,
            `reinterpret_cast<long long>(${varName}${accessPath})`,
        ];
    } else if (isUsingLLDB(session)) {
        return [
            `${varName}${accessPath}`,
            `&${varName}[0]`,
            `reinterpret_cast<long long>(${varName}${accessPath})`,
        ];
    } else {
        // cppdbg / GDB
        return [
            `(long long)${varName}${accessPath}`,
            `(long long)&${varName}[0]`,
            `reinterpret_cast<long long>(${varName}${accessPath})`,
        ];
    }
}

// ── std::vector utilities ────────────────────────────────────────────────

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

/**
 * Obtain the data pointer for a std::vector<T>.
 *
 * Strategy:
 *   1. Expand variablesReference and look for the `[0]` element's memoryReference
 *   2. Fall back to evaluating `.data()` with debugger-specific cast syntax
 */
export async function getVectorDataPointer(
    session: vscode.DebugSession,
    varName: string,
    variablesReference: number,
    frameId?: number
): Promise<string | null> {
    // Prefer the variables-tree approach (reliable for both LLDB and GDB)
    if (variablesReference > 0) {
        try {
            const varsResp = await session.customRequest("variables", {
                variablesReference,
            });
            const firstElem = (varsResp?.variables ?? []).find(
                (v: { name: string }) => v.name === "[0]"
            );
            if (
                firstElem?.memoryReference &&
                isValidMemoryReference(firstElem.memoryReference)
            ) {
                return firstElem.memoryReference;
            }
        } catch {
            /* fall through to evaluate approach */
        }
    }

    const expressions = buildDataPointerExpressions(session, varName);
    return tryGetDataPointer(session, expressions, frameId);
}

// ── Container size ────────────────────────────────────────────────────────

/**
 * Evaluate `.size()` on a container variable, trying cast variants appropriate
 * for each debugger type. Returns 0 if the evaluation fails or returns
 * a non-positive / implausibly large value (> 1 billion).
 */
export async function getContainerSize(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<number> {
    const exprs = isUsingLLDB(session)
        ? [`${varName}.size()`, `(long long)${varName}.size()`]
        : [`(int)${varName}.size()`, `${varName}.size()`, `(long long)${varName}.size()`];
    for (const expr of exprs) {
        const res = await evaluateExpression(session, expr, frameId);
        const n = parseInt(res ?? "");
        if (!isNaN(n) && n >= 0 && n < 1_000_000_000) {
            return n;
        }
    }
    return 0;
}

// ── Multi-dimensional data-pointer helpers ────────────────────────────────

/**
 * Build debugger-specific expressions to obtain the address of `varName[0][0]`.
 * Suitable for 2D C-style arrays and nested std::array types.
 */
export function build2DDataPointerExpressions(
    session: vscode.DebugSession,
    varName: string
): string[] {
    if (isUsingLLDB(session)) {
        return [
            `&${varName}[0][0]`,
            `${varName}[0].data()`,
            `reinterpret_cast<long long>(&${varName}[0][0])`,
        ];
    } else if (isUsingMSVC(session)) {
        return [
            `(long long)&${varName}[0][0]`,
            `(long long)${varName}[0].data()`,
            `reinterpret_cast<long long>(&${varName}[0][0])`,
        ];
    } else {
        // cppdbg / GDB
        return [
            `(long long)&${varName}[0][0]`,
            `(long long)${varName}[0].data()`,
            `reinterpret_cast<long long>(&${varName}[0][0])`,
        ];
    }
}

/**
 * Build debugger-specific expressions to obtain the address of `varName[0][0][0]`.
 * Suitable for 3D C-style arrays and triply-nested std::array types.
 */
export function build3DDataPointerExpressions(
    session: vscode.DebugSession,
    varName: string
): string[] {
    if (isUsingLLDB(session)) {
        return [
            `&${varName}[0][0][0]`,
            `reinterpret_cast<long long>(&${varName}[0][0][0])`,
        ];
    } else if (isUsingMSVC(session)) {
        return [
            `(long long)&${varName}[0][0][0]`,
            `reinterpret_cast<long long>(&${varName}[0][0][0])`,
        ];
    } else {
        return [
            `(long long)&${varName}[0][0][0]`,
            `reinterpret_cast<long long>(&${varName}[0][0][0])`,
        ];
    }
}
