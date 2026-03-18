/**
 * codelldb/debugger.ts — DAP communication layer for CodeLLDB (session.type = "lldb").
 *
 * Provides LLDB-specific:
 *   - Evaluate context ("watch") — CodeLLDB treats "repl" as command mode
 *   - Expression evaluation
 *   - Variable enumeration (scope listing)
 *   - Data-pointer expression builders (bare pointers, no (long long) casts)
 *   - Container size evaluation with STL internal-field fallbacks
 *   - Vector data pointer resolution
 *
 * Key differences from GDB / vsdbg:
 *   - Must use "watch" context; "repl" would execute debugger commands
 *   - Does NOT use (long long) casts — LLDB returns raw pointer values
 *   - getContainerSize() includes STL-internal fallback expressions for
 *     MSVC-STL, libstdc++, and libc++ layouts (since .size() may not be
 *     callable in all situations under LLDB)
 *
 * Re-exports all shared DAP utilities from ../shared/debuggerBase so that
 * lib providers only need to import from this single file.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { logger } from "../../../log/logger";

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
    parseSizeFromValue,
} from "../shared/debuggerBase";

// ── Evaluate context ──────────────────────────────────────────────────────

/**
 * CodeLLDB uses "watch" as the evaluate context.
 * Using "repl" would invoke the LLDB command interpreter instead of
 * evaluating the expression as a C++ expression.
 */
export function getEvaluateContext(): string {
    return "watch";
}

// ── Expression evaluation ─────────────────────────────────────────────────

const EVALUATE_TIMEOUT_MS = 10_000;

/**
 * Evaluate a C++ expression in the context of the current frame using
 * the CodeLLDB "watch" evaluation context.
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
                context: "watch",
            });
            return r?.result ?? null;
        } catch (e) {
            logger.debug(`[evaluateExpression] exception for "${expression}": ${e instanceof Error ? e.message : String(e)}`);
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
 * CodeLLDB may omit Variable.type for struct/class variables — a "watch"
 * evaluate fallback and cv::Mat child-fingerprint detection are used.
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

        const raw: { name: string; type: string; variablesReference: number; indexedVariables?: number; namedVariables?: number }[] =
            varsResp?.variables ?? [];

        const resolved = await Promise.all(
            raw.map(async (v) => {
                // Log raw DAP fields for Qt / STL container types to capture indexedVariables.
                if (/Q(?:List|Vector|Polygon)|std::(?:vector|array)/.test(v.type ?? "")) {
                    logger.debug(`[getVariablesInScope] raw DAP: name="${v.name}" varRef=${v.variablesReference} indexedVariables=${v.indexedVariables ?? "(none)"} namedVariables=${v.namedVariables ?? "(none)"}`);
                }
                let typeName = v.type ?? "";
                // CodeLLDB may omit type for struct/class variables.
                // First attempt: evaluate with "watch" context — r.type may carry it.
                if (!typeName && v.variablesReference > 0) {
                    try {
                        const r = await session.customRequest("evaluate", {
                            expression: v.name,
                            frameId,
                            context: "watch",
                        });
                        typeName = r?.type ?? "";
                    } catch {
                        // keep empty string
                    }
                }
                // Second attempt: detect cv::Mat by inspecting child variable names.
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
                    indexedVariables: v.indexedVariables,
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
 * Uses "watch" context for all evaluations.
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
                context: "watch",
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
 * Build LLDB-specific expressions to obtain a data pointer for a container.
 * LLDB returns raw pointer values directly — no (long long) casts needed.
 */
export function buildDataPointerExpressions(
    varName: string,
    accessPath = ".data()"
): string[] {
    return [
        `${varName}${accessPath}`,
        `&${varName}[0]`,
        `reinterpret_cast<long long>(${varName}${accessPath})`,
    ];
}

/**
 * Build LLDB-specific expressions to obtain the address of `varName[0][0]`.
 * Suitable for 2D C-style arrays and nested std::array types.
 */
export function build2DDataPointerExpressions(
    varName: string
): string[] {
    return [
        `&${varName}[0][0]`,
        `${varName}[0].data()`,
        `reinterpret_cast<long long>(&${varName}[0][0])`,
    ];
}

/**
 * Build LLDB-specific expressions to obtain the address of `varName[0][0][0]`.
 * Suitable for 3D C-style arrays and triply-nested std::array types.
 */
export function build3DDataPointerExpressions(
    varName: string
): string[] {
    return [
        `&${varName}[0][0][0]`,
        `reinterpret_cast<long long>(&${varName}[0][0][0])`,
    ];
}

// ── Container size ────────────────────────────────────────────────────────

/**
 * Parse an integer from an LLDB evaluate result.
 * CodeLLDB prepends type info to results: "(unsigned long) $0 = 100".
 * Falls back to plain `parseInt` for other formats (e.g. GDB-style "100").
 */
function parseLldbInteger(result: string | null): number {
    if (!result) { return NaN; }
    const direct = parseInt(result.trim());
    if (!isNaN(direct)) { return direct; }
    // LLDB format: "(type) $n = value" — extract the value after " = "
    const m = result.match(/=\s*(-?\d+)/);
    return m ? parseInt(m[1]) : NaN;
}

/**
 * Evaluate `.size()` on a container variable using LLDB-compatible expressions.
 * Includes STL internal-field fallbacks for cases where LLDB cannot call
 * member functions (MSVC-STL, libstdc++, libc++ layouts).
 * Returns 0 if the evaluation fails or the result is implausibly large (> 1 billion).
 */
export async function getContainerSize(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<number> {
    const exprs = [
        `${varName}.size()`,
        `(long long)${varName}.size()`,
        // MSVC STL internal layout (most common with Clang on Windows)
        `(int)(${varName}._Mypair._Myval2._Mylast - ${varName}._Mypair._Myval2._Myfirst)`,
        // libstdc++ internal layout
        `(int)(${varName}._M_impl._M_finish - ${varName}._M_impl._M_start)`,
        // libc++ internal layout
        `(int)(${varName}.__end_ - ${varName}.__begin_)`,
    ];
    // When varName is a deref expression (*ptr), LLDB can fail calling .method()
    // on parenthesised rvalue expressions. Add arrow-operator equivalents.
    const derefMatch = varName.match(/^\(\*(.+)\)$/);
    if (derefMatch) {
        const ptr = derefMatch[1];
        exprs.push(
            `${ptr}->size()`,
            `(long long)${ptr}->size()`,
            `(int)(${ptr}->_Mypair._Myval2._Mylast - ${ptr}->_Mypair._Myval2._Myfirst)`,
            `(int)(${ptr}->_M_impl._M_finish - ${ptr}->_M_impl._M_start)`,
            `(int)(${ptr}->__end_ - ${ptr}->__begin_)`,
        );
    }
    // Handle weak_ptr lock_deref (*xxx.lock()): LLDB cannot call .lock() which
    // returns a temporary shared_ptr. Use internal raw pointer fields instead.
    //   libstdc++: _M_ptr;   libc++: __ptr_;   MSVC STL: _Ptr
    const lockDerefMatch = varName.match(/^\(\*(.+)\.lock\(\)\)$/);
    if (lockDerefMatch) {
        const wpName = lockDerefMatch[1];
        for (const ptrField of ["_M_ptr", "__ptr_", "_Ptr"]) {
            exprs.push(
                `${wpName}.${ptrField}->size()`,
                `(long long)${wpName}.${ptrField}->size()`,
                `(int)(${wpName}.${ptrField}->_Mypair._Myval2._Mylast - ${wpName}.${ptrField}->_Mypair._Myval2._Myfirst)`,
                `(int)(${wpName}.${ptrField}->_M_impl._M_finish - ${wpName}.${ptrField}->_M_impl._M_start)`,
                `(int)(${wpName}.${ptrField}->__end_ - ${wpName}.${ptrField}->__begin_)`,
            );
        }
    }
    for (const expr of exprs) {
        const res = await evaluateExpression(session, expr, frameId);
        logger.debug(`[getContainerSize] expr=${expr} -> ${JSON.stringify(res)}`);
        const n = parseLldbInteger(res);
        if (!isNaN(n) && n >= 0 && n < 1_000_000_000) {
            logger.debug(`[getContainerSize] ${varName} size=${n}`);
            return n;
        }
    }
    // ── Fallback: read value string from scope variables list ────────────────
    // Expression evaluation may be unavailable (e.g. LLDB on Windows with PDB
    // symbols). The DAP variables tree still works and CodeLLDB reports the
    // vector's summary as "size=N { ... }" which parseSizeFromValue handles.
    const sizeFromValue = await getSizeFromScopeValue(session, varName, frameId);
    if (sizeFromValue > 0) {
        logger.debug(`[getContainerSize] ${varName} size from scope value=${sizeFromValue}`);
        return sizeFromValue;
    }

    logger.warn(`[getContainerSize] all exprs failed for ${varName}, returning 0`);
    return 0;
}

/**
 * Read the variable's `value` summary string from the parent scope's
 * variables list and parse the element count from it.
 *
 * Used when expression evaluation is unavailable (e.g. LLDB on Windows with
 * MSVC PDB symbols). CodeLLDB reports std::vector as "size=N { ... }".
 */
async function getSizeFromScopeValue(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<number> {
    try {
        const resolvedFrame = frameId ?? (await getCurrentFrameId(session));
        const scopesResp = await session.customRequest("scopes", { frameId: resolvedFrame });
        const localScopeRef: number | undefined =
            scopesResp?.scopes?.[0]?.variablesReference;
        if (localScopeRef == null) { return 0; }

        const varsResp = await session.customRequest("variables", {
            variablesReference: localScopeRef,
        });
        // If varName is a deref expression (*ptr), look up the pointer variable instead.
        // For (*xxx.lock()), extract just xxx (the weak_ptr name) not xxx.lock().
        let lookupName = varName;
        const lockDerefMatch2 = varName.match(/^\(\*(.+)\.lock\(\)\)$/);
        const derefMatch2 = varName.match(/^\(\*(.+)\)$/);
        if (lockDerefMatch2) {
            lookupName = lockDerefMatch2[1];
        } else if (derefMatch2) {
            lookupName = derefMatch2[1];
        }
        const match = (varsResp?.variables ?? []).find(
            (v: { name: string }) => v.name === lookupName
        );
        if (!match?.value) { return 0; }

        logger.debug(`[getSizeFromScopeValue] ${varName} value="${match.value}"`);
        return parseSizeFromValue(match.value);
    } catch {
        return 0;
    }
}

// ── std::vector data pointer ─────────────────────────────────────────────

/**
 * Obtain the data pointer for a std::vector<T>.
 *
 * Strategy:
 *   1. Expand variablesReference and look for the `[0]` element's memoryReference
 *   2. Fall back to evaluating `.data()` with LLDB-specific (bare pointer) expressions
 */
export async function getVectorDataPointer(
    session: vscode.DebugSession,
    varName: string,
    variablesReference: number,
    frameId?: number
): Promise<string | null> {
    // Saved when Strategy A finds a "pointer" synthetic child (weak_ptr/shared_ptr).
    // Used as a fallback for resolveMsvcVectorPtrs at the end of the function.
    let ptrChildVr = 0;
    if (variablesReference > 0) {
        try {
            const varsResp = await session.customRequest("variables", {
                variablesReference,
            });
            let children: { name: string; memoryReference?: string; variablesReference?: number }[] =
                varsResp?.variables ?? [];
            logger.debug(
                `[getVectorDataPointer] ${varName} variablesRef=${variablesReference} ` +
                `children=[${children.map(c => `${c.name}(mr=${c.memoryReference ?? "none"} vr=${c.variablesReference ?? 0})`).join(", ")}]`
            );

            // Strategy A: expand the synthetic "pointer" child emitted by
            // CodeLLDB's smart-ptr / weak_ptr formatter.  The "pointer" child
            // represents the pointed-to object (e.g. std::vector<T>), so
            // expanding it gives [0], [1], … directly.
            const ptrChild = children.find(
                (c) => c.name === "pointer" && (c.variablesReference ?? 0) > 0
            );
            if (ptrChild) {
                ptrChildVr = ptrChild.variablesReference!;
                const ptrResp = await session.customRequest("variables", {
                    variablesReference: ptrChild.variablesReference!,
                });
                const ptrChildren: { name: string; memoryReference?: string; variablesReference?: number }[] =
                    ptrResp?.variables ?? [];
                logger.debug(
                    `[getVectorDataPointer] ${varName} pointer children=[` +
                    `${ptrChildren.slice(0, 5).map(c => `${c.name}(mr=${c.memoryReference ?? "none"})`).join(", ")}` +
                    `${ptrChildren.length > 5 ? ` ... (${ptrChildren.length} total)` : ""}]`
                );
                // First check if [0] is directly in ptrChildren (CodeLLDB weak_ptr/shared_ptr
                // formatter exposes vector elements at this level alongside a synthetic [raw]).
                let firstVec = ptrChildren.find(
                    (v) => v.name === "[0]" || v.name === "_Elems" || v.name === "_M_elems" || v.name === "__elems_"
                ) as { name: string; memoryReference?: string } | undefined;
                if (!firstVec) {
                    // Fallback: expand a nested [raw] if present
                    const innerRaw = ptrChildren.find(
                        (c) => c.name === "[raw]" && (c.variablesReference ?? 0) > 0
                    );
                    if (innerRaw) {
                        const rawChildren: { name: string; memoryReference?: string }[] =
                            (await session.customRequest("variables", { variablesReference: innerRaw.variablesReference! }))?.variables ?? [];
                        firstVec = rawChildren.find(
                            (v) => v.name === "[0]" || v.name === "_Elems" || v.name === "_M_elems" || v.name === "__elems_"
                        );
                    }
                }
                if (firstVec?.memoryReference && isValidMemoryReference(firstVec.memoryReference)) {
                    logger.debug(`[getVectorDataPointer] ${varName} via pointer->${firstVec.name}.mr=${firstVec.memoryReference}`);
                    return firstVec.memoryReference;
                }
            }

            // Strategy B: CodeLLDB wraps elements inside a synthetic "[raw]" child.
            // This occurs both when [raw] is the sole child (plain vector) and
            // when it coexists with a "pointer" sibling (smart-ptr / weak_ptr).
            const rawChild = children.find(
                (c) => c.name === "[raw]" && (c.variablesReference ?? 0) > 0
            );
            if (rawChild) {
                const rawResp = await session.customRequest("variables", {
                    variablesReference: rawChild.variablesReference!,
                });
                children = rawResp?.variables ?? [];
                logger.debug(
                    `[getVectorDataPointer] ${varName} [raw] children=[` +
                    `${children.map(c => `${c.name}(mr=${c.memoryReference ?? "none"} vr=${c.variablesReference ?? 0})`).join(", ")}]`
                );
            }

            // "[0]" — vector/C-array first element (most debuggers)
            // "_Elems"   — MSVC STL std::array<T,N> internal storage field
            // "_M_elems" — libstdc++ std::array<T,N> internal storage field
            // "__elems_" — libc++ std::array<T,N> internal storage field
            const firstElem = children.find(
                (v) => v.name === "[0]" || v.name === "_Elems" || v.name === "_M_elems" || v.name === "__elems_"
            );
            if (
                firstElem?.memoryReference &&
                isValidMemoryReference(firstElem.memoryReference)
            ) {
                logger.debug(`[getVectorDataPointer] ${varName} using ${firstElem.name}.memoryReference=${firstElem.memoryReference}`);
                return firstElem.memoryReference;
            }
        } catch {
            /* fall through to evaluate approach */
        }
    }

    const expressions = buildDataPointerExpressions(varName);
    // For weak_ptr lock_deref (*xxx.lock()): .lock() fails in LLDB; use the
    // internal raw pointer (_M_ptr for libstdc++, __ptr_ for libc++) directly.
    const lockDerefM = varName.match(/^\(\*(.+)\.lock\(\)\)$/);
    if (lockDerefM) {
        const wpName = lockDerefM[1];
        for (const ptrField of ["_M_ptr", "__ptr_", "_Ptr"]) {
            expressions.push(
                `${wpName}.${ptrField}->data()`,
                `${wpName}.${ptrField}[0]`,
            );
        }
    }
    const ptrFromEval = await tryGetDataPointer(session, expressions, frameId);
    logger.debug(`[getVectorDataPointer] ${varName} fallback evaluate -> ${ptrFromEval}`);
    if (ptrFromEval) { return ptrFromEval; }

    // Last resort: MSVC STL internal layout via variables tree
    // ([raw] → _Mypair → _Myval2 → _Myfirst)
    const msvc = await resolveMsvcVectorPtrs(session, variablesReference);
    logger.debug(`[getVectorDataPointer] ${varName} MSVC layout -> firstPtr=${msvc?.firstPtr ?? "null"}`);
    if (msvc?.firstPtr) { return msvc.firstPtr; }

    // For weak_ptr/shared_ptr: variablesReference points to the wrapper object
    // whose [raw] is _Ptr_base (no _Mypair). The "pointer" synthetic child
    // (ptrChildVr, saved from Strategy A) represents the pointed-to vector;
    // apply resolveMsvcVectorPtrs on it to get the vector's _Myfirst.
    if (ptrChildVr > 0) {
        const msvcViaPtr = await resolveMsvcVectorPtrs(session, ptrChildVr);
        logger.debug(`[getVectorDataPointer] ${varName} MSVC via pointer child -> firstPtr=${msvcViaPtr?.firstPtr ?? "null"}`);
        if (msvcViaPtr?.firstPtr) { return msvcViaPtr.firstPtr; }
    }
    return null;
}

// ── MSVC STL internal layout helper ─────────────────────────────────────

type MsvcVectorPtrs = { firstPtr: string; lastPtr: string };

/**
 * Navigate the DAP variables tree along the MSVC STL std::vector layout:
 *   variablesReference → [raw] → _Mypair → _Myval2 → { _Myfirst, _Mylast }
 *
 * Returns the hex pointer strings from `_Myfirst` and `_Mylast` value fields,
 * or null if the layout is not recognised.
 *
 * Used when expression evaluation is unavailable (LLDB on Windows + MSVC PDB).
 */
async function resolveMsvcVectorPtrs(
    session: vscode.DebugSession,
    variablesReference: number
): Promise<MsvcVectorPtrs | null> {
    const expand = async (ref: number) => {
        const r = await session.customRequest("variables", { variablesReference: ref });
        return (r?.variables ?? []) as { name: string; value?: string; variablesReference?: number }[];
    };

    try {
        const top = await expand(variablesReference);
        const rawChild = top.find((c) => c.name === "[raw]");
        if (!rawChild?.variablesReference) { return null; }

        const rawChildren = await expand(rawChild.variablesReference);
        const mypair = rawChildren.find((c) => c.name === "_Mypair");
        if (!mypair?.variablesReference) { return null; }

        const mypairChildren = await expand(mypair.variablesReference);
        const myval2 = mypairChildren.find((c) => c.name === "_Myval2");
        if (!myval2?.variablesReference) { return null; }

        const myval2Children = await expand(myval2.variablesReference);
        logger.debug(
            `[resolveMsvcVectorPtrs] _Myval2 children: ` +
            myval2Children.map((c) => `${c.name}=${c.value ?? "?"}`).join(", ")
        );

        const myfirst = myval2Children.find((c) => c.name === "_Myfirst");
        const mylast  = myval2Children.find((c) => c.name === "_Mylast");
        if (!myfirst?.value || !mylast?.value) { return null; }

        const firstHex = myfirst.value.match(/0x[0-9a-fA-F]+/)?.[0];
        const lastHex  = mylast.value.match(/0x[0-9a-fA-F]+/)?.[0];
        if (!firstHex || !lastHex) { return null; }

        return { firstPtr: firstHex, lastPtr: lastHex };
    } catch {
        return null;
    }
}

// ── Vector size from children ────────────────────────────────────────────

/**
 * Determine the element count of a std::vector via the DAP variables tree.
 *
 * Strategy (in order):
 *   1. If the top-level children contain `[N]`-named entries → count them
 *      (or use DAP `totalCount` if available).
 *   2. If the only child is `[raw]` → expand it and try the same.
 *   3. If `[raw]` contains `_Mypair` (MSVC STL internal layout) → navigate
 *      to `_Myval2._Myfirst` / `_Mylast` and compute size from pointer diff.
 *
 * `elementByteSize` is required for strategy 3 (pointer-difference division).
 */
export async function getVectorSizeFromChildren(
    session: vscode.DebugSession,
    variablesReference: number,
    elementByteSize = 1
): Promise<number> {
    try {
        const resp = await session.customRequest("variables", {
            variablesReference,
        });
        let children: { name: string; variablesReference?: number }[] = resp?.variables ?? [];
        logger.debug(
            `[getVectorSizeFromChildren] variablesRef=${variablesReference} ` +
            `totalCount=${resp?.totalCount ?? "n/a"} ` +
            `firstPageCount=${children.length} ` +
            `names=[${children.slice(0, 10).map((c) => c.name).join(", ")}${children.length > 10 ? ", ..." : ""}]`
        );

        // ── Strategy 1: direct [N] children ──────────────────────────────────
        if (typeof resp?.totalCount === "number" && resp.totalCount > 0) {
            return resp.totalCount;
        }
        const direct = children.filter((c) => /^\[\d+\]$/.test(c.name)).length;
        if (direct > 0) { return direct; }

        // ── Strategy 2 / 3: expand [raw] ─────────────────────────────────────
        // [raw] may coexist with other siblings (e.g. "pointer" for weak_ptr),
        // so we search for it rather than requiring it to be the only child.
        const rawChild = children.find(
            (c) => c.name === "[raw]" && (c.variablesReference ?? 0) > 0
        );
        if (rawChild) {
            const rawRef = rawChild.variablesReference!;
            const rawResp = await session.customRequest("variables", {
                variablesReference: rawRef,
            });
            children = rawResp?.variables ?? [];
            logger.debug(
                `[getVectorSizeFromChildren] [raw] totalCount=${rawResp?.totalCount ?? "n/a"} ` +
                `firstPageCount=${children.length} ` +
                `names=[${children.slice(0, 10).map((c) => c.name).join(", ")}${children.length > 10 ? ", ..." : ""}]`
            );

            if (typeof rawResp?.totalCount === "number" && rawResp.totalCount > 0) {
                return rawResp.totalCount;
            }
            const indexed = children.filter((c) => /^\[\d+\]$/.test(c.name)).length;
            if (indexed > 0) { return indexed; }

            // Strategy 3: _Mypair layout (MSVC STL) — first try the vector's own
            // variablesRef, then fall back to following the "pointer" child
            // (present for weak_ptr/shared_ptr where [raw] → _Ptr_base, not _Mypair).
            const msvc = await resolveMsvcVectorPtrs(session, variablesReference);
            if (msvc) {
                const first = BigInt(msvc.firstPtr);
                const last  = BigInt(msvc.lastPtr);
                const count = Number(last >= first ? (last - first) / BigInt(elementByteSize) : 0n);
                logger.debug(
                    `[getVectorSizeFromChildren] MSVC ptrs first=${msvc.firstPtr} ` +
                    `last=${msvc.lastPtr} elementByteSize=${elementByteSize} -> count=${count}`
                );
                return count;
            }

            // Strategy 3b: MSVC STL weak_ptr — [raw] leads to _Ptr_base, not _Mypair.
            // Follow the top-level "pointer" synthetic child (the pointed-to vector)
            // and apply resolveMsvcVectorPtrs on its variablesRef instead.
            const ptrSynthChild = (resp?.variables ?? []).find(
                (c: { name: string; variablesReference?: number }) =>
                    c.name === "pointer" && (c.variablesReference ?? 0) > 0
            );
            if (ptrSynthChild) {
                const msvcViaPtr = await resolveMsvcVectorPtrs(session, ptrSynthChild.variablesReference!);
                if (msvcViaPtr) {
                    const first = BigInt(msvcViaPtr.firstPtr);
                    const last  = BigInt(msvcViaPtr.lastPtr);
                    const count = Number(last >= first ? (last - first) / BigInt(elementByteSize) : 0n);
                    logger.debug(
                        `[getVectorSizeFromChildren] MSVC via pointer child: first=${msvcViaPtr.firstPtr} ` +
                        `last=${msvcViaPtr.lastPtr} elementByteSize=${elementByteSize} -> count=${count}`
                    );
                    return count;
                }
            }
        }

        return 0;
    } catch {
        return 0;
    }
}
