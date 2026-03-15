/**
 * cppvsdbg/debugger.ts — DAP communication layer for vsdbg (session.type = "cppvsdbg").
 *
 * Provides MSVC-specific:
 *   - Evaluate context ("repl")
 *   - Expression evaluation
 *   - Variable enumeration (scope listing)
 *   - Data-pointer expression builders (with (long long) casts)
 *   - Container size evaluation ((int)varName.size())
 *   - Vector data pointer resolution
 *
 * vsdbg (cppvsdbg) uses the same expression syntax as GDB (repl context,
 * (long long) casts), but is kept as a separate module to allow independent
 * evolution if MSVC-specific quirks require different handling in the future.
 *
 * Re-exports all shared DAP utilities from ../shared/debuggerBase so that
 * lib providers only need to import from this single file.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";

// ── Re-export shared utilities ────────────────────────────────────────────

export {
    getCurrentFrameId,
    getVariableInfo,
    detectCvMatFromChildren,
    isValidMemoryReference,
    readMemoryChunked,
    parseSizeFromValue,
} from "../shared/debuggerBase";

import {
    getCurrentFrameId,
    detectCvMatFromChildren,
    isValidMemoryReference,
} from "../shared/debuggerBase";

// ── Evaluate context ──────────────────────────────────────────────────────

/** vsdbg (cppvsdbg) uses the "repl" evaluate context. */
export function getEvaluateContext(): string {
    return "repl";
}

// ── Expression evaluation ─────────────────────────────────────────────────

const EVALUATE_TIMEOUT_MS = 10_000;

/**
 * Evaluate a C++ expression in the context of the current frame using
 * the vsdbg "repl" evaluation context.
 * Returns the result string or null on failure / timeout.
 */
export async function evaluateExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string | null> {
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));

    const inner = async (): Promise<string | null> => {
        try {
            const r = await session.customRequest("evaluate", {
                expression,
                frameId: resolvedFrame,
                context: "repl",
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

// ── Variable enumeration ─────────────────────────────────────────────────

/**
 * List all variables visible in the top frame of the first thread.
 * Returns VariableInfo objects with name, type, variablesReference, and frameId.
 *
 * vsdbg typically provides type information for all variables, but the
 * same fallback strategy as GDB is retained for robustness.
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

        const raw: { name: string; type: string; variablesReference: number }[] =
            varsResp?.variables ?? [];

        const resolved = await Promise.all(
            raw.map(async (v) => {
                let typeName = v.type ?? "";
                // Fallback: evaluate to obtain type if DAP omits it
                if (!typeName && v.variablesReference > 0) {
                    try {
                        const r = await session.customRequest("evaluate", {
                            expression: v.name,
                            frameId,
                            context: "repl",
                        });
                        typeName = r?.type ?? "";
                    } catch {
                        // keep empty string
                    }
                }
                // Last resort: detect cv::Mat by inspecting child variable names
                if (!typeName && v.variablesReference > 0) {
                    typeName = await detectCvMatFromChildren(
                        session,
                        v.variablesReference
                    );
                }
                return {
                    name: v.name,
                    type: typeName,
                    variablesReference: v.variablesReference,
                    frameId,
                };
            })
        );

        return resolved;
    } catch {
        return [];
    }
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
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));

    for (const expr of expressions) {
        try {
            const resp = await session.customRequest("evaluate", {
                expression: expr,
                frameId: resolvedFrame,
                context: "repl",
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
 * Build vsdbg-specific expressions to obtain a data pointer for a container
 * (std::vector, std::array, cv::Mat, raw pointers, etc.).
 * vsdbg uses (long long) casts to convert pointers to integers, same as GDB.
 */
export function buildDataPointerExpressions(
    varName: string,
    accessPath = ".data()"
): string[] {
    return [
        `(long long)${varName}${accessPath}`,
        `(long long)&${varName}[0]`,
        `reinterpret_cast<long long>(${varName}${accessPath})`,
    ];
}

/**
 * Build vsdbg-specific expressions to obtain the address of `varName[0][0]`.
 * Suitable for 2D C-style arrays and nested std::array types.
 */
export function build2DDataPointerExpressions(
    varName: string
): string[] {
    return [
        `(long long)&${varName}[0][0]`,
        `(long long)${varName}[0].data()`,
        `reinterpret_cast<long long>(&${varName}[0][0])`,
    ];
}

/**
 * Build vsdbg-specific expressions to obtain the address of `varName[0][0][0]`.
 * Suitable for 3D C-style arrays and triply-nested std::array types.
 */
export function build3DDataPointerExpressions(
    varName: string
): string[] {
    return [
        `(long long)&${varName}[0][0][0]`,
        `reinterpret_cast<long long>(&${varName}[0][0][0])`,
    ];
}

// ── Container size ────────────────────────────────────────────────────────

/**
 * Evaluate `.size()` on a container variable using vsdbg/cppvsdbg cast syntax.
 * Returns 0 if the evaluation fails or returns a non-positive / implausibly
 * large value (> 1 billion).
 */
export async function getContainerSize(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<number> {
    const exprs = [
        `(int)${varName}.size()`,
        `${varName}.size()`,
        `(long long)${varName}.size()`,
    ];
    for (const expr of exprs) {
        const res = await evaluateExpression(session, expr, frameId);
        const n = parseInt(res ?? "");
        if (!isNaN(n) && n >= 0 && n < 1_000_000_000) {
            return n;
        }
    }
    return 0;
}

// ── std::vector data pointer ─────────────────────────────────────────────

/**
 * Obtain the data pointer for a std::vector<T>.
 *
 * Strategy:
 *   1. Expand variablesReference and look for the `[0]` element's memoryReference
 *   2. Fall back to evaluating `.data()` with vsdbg-specific cast syntax
 */
export async function getVectorDataPointer(
    session: vscode.DebugSession,
    varName: string,
    variablesReference: number,
    frameId?: number
): Promise<string | null> {
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

    const expressions = buildDataPointerExpressions(varName);
    return tryGetDataPointer(session, expressions, frameId);
}
