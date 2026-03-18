/**
 * pythonDebugger.ts — DAP communication layer for Python / debugpy sessions.
 *
 * All interactions with the Python debugpy debug session (and Jupyter) go
 * through here.  Provides:
 *   - Session type checks (debugpy, Jupyter)
 *   - Variable enumeration in the current scope
 *   - Python expression evaluation with timeout
 *   - Array data extraction (small: JSON, large: Base64 binary)
 *   - Common metadata fetch (shape, dtype, length)
 *
 * This module is internal to the Python adapter.
 * External code should use PythonAdapter (pythonAdapter.ts) instead.
 */

import * as vscode from "vscode";
import { VariableInfo } from "../../IDebugAdapter";
import { receiveBytesViaTcp } from "../../../utils/tcpTransfer";
import { logger } from "../../../log/logger";

// Re-export VariableInfo so legacy imports via utils/debugger still work.
export { VariableInfo } from "../../IDebugAdapter";

// ── Python-specific internal types ────────────────────────────────────────

export interface RawArrayData {
    /** Flat byte array (from Base64 tobytes decode) */
    buffer: Uint8Array;
    dtype: string;
    shape: number[];
}

// ── Session Type Detection ─────────────────────────────────────────────────

export function isPythonSession(session: vscode.DebugSession): boolean {
    return session.type === "python" || session.type === "debugpy";
}

export function isJupyterSession(session: vscode.DebugSession): boolean {
    return session.type === "jupyter";
}

export function isSupportedSession(session: vscode.DebugSession): boolean {
    return isPythonSession(session) || isJupyterSession(session);
}

// ── Frame & Scope Utilities ────────────────────────────────────────────────

export async function getCurrentFrameId(
    session: vscode.DebugSession
): Promise<number | undefined> {
    try {
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

/** Return all variables visible in the top frame of the first thread. */
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
            (v: { name: string; type: string; variablesReference: number }) => ({
                name: v.name,
                type: v.type ?? "",
                variablesReference: v.variablesReference,
                frameId,
            })
        );
    } catch (e) {
        logger.debug(`[Python] getVariablesInScope failed: ${e}`);
        return [];
    }
}

// ── Expression Evaluation ─────────────────────────────────────────────────

const EVALUATE_TIMEOUT_MS = 10_000;

/**
 * Evaluate a Python expression in the context of the given frame.
 * Returns the `result` string from DAP, or null on failure.
 */
export async function evaluateExpression(
    session: vscode.DebugSession,
    expression: string,
    frameId?: number
): Promise<string | null> {
    const resolvedFrame = frameId ?? (await getCurrentFrameId(session));
    const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), EVALUATE_TIMEOUT_MS)
    );
    const evalPromise = Promise.resolve(
        session.customRequest("evaluate", {
            expression,
            frameId: resolvedFrame,
            context: "repl",
        })
    )
        .then((r) => r?.result ?? null)
        .catch(() => null);

    return Promise.race([evalPromise, timeoutPromise]);
}

// ── Variable Metadata ─────────────────────────────────────────────────────

/**
 * Enrich a basic VariableInfo with shape, dtype, and typeName
 * by running a single compound evaluate in the debug session.
 */
export async function getVariableInfo(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<VariableInfo | null> {
    // For list/tuple, infer inner element dimension so Layer-2 detection can
    // distinguish 1D list vs list-of-2-tuples (scatter) vs list-of-3-tuples (pointcloud).
    const expr =
        `__import__('json').dumps({` +
        `'typeName': type(${varName}).__module__ + '.' + type(${varName}).__name__,` +
        `'shape': list(${varName}.shape) if hasattr(${varName}, 'shape') else ` +
        `([len(${varName}), len(${varName}[0])] ` +
        `if isinstance(${varName}, (list, tuple)) and len(${varName}) > 0 and hasattr(${varName}[0], '__len__') ` +
        `else ([len(${varName})] if isinstance(${varName}, (list, tuple)) else None)),` +
        `'dtype': str(${varName}.dtype) if hasattr(${varName}, 'dtype') else None,` +
        `'length': len(${varName}) if hasattr(${varName}, '__len__') else None` +
        `})`;

    const raw = await evaluateExpression(session, expr, frameId);
    if (!raw) {
        logger.debug(`[Python] getVariableInfo: evaluate returned null for "${varName}"`);
        return null;
    }

    try {
        // debugpy wraps the result in quotes; strip them if present
        const jsonStr = raw.startsWith("'") ? raw.slice(1, -1) : raw;
        const parsed = JSON.parse(jsonStr);
        const result = {
            name: varName,
            type: parsed.typeName ?? "",
            typeName: parsed.typeName ?? "",
            shape: parsed.shape ?? null,
            dtype: parsed.dtype ?? null,
            length: parsed.length ?? null,
            frameId,
        };
        logger.debug(`[Python] getVariableInfo "${varName}": typeName="${result.typeName}" shape=${JSON.stringify(result.shape)} dtype=${result.dtype}`);
        return result;
    } catch (e) {
        logger.debug(`[Python] getVariableInfo: JSON parse failed for "${varName}": ${e}`);
        return null;
    }
}

// ── Array Data Extraction ─────────────────────────────────────────────────

// Threshold for the *estimated JSON character count* of an array.
// debugpy truncates evaluate() results at roughly 32 K – 64 K characters;
// we use 32 K as a conservative ceiling so JSON.parse never sees a partial string.
// Arrays whose JSON representation is estimated to exceed this limit are
// transferred via binary TCP socket instead.
const LARGE_DATA_THRESHOLD_JSON_CHARS = 32 * 1024; // 32 K chars

/**
 * Fetch the numeric data of a Python array variable.
 *
 * Strategy:
 *   Small (< threshold): evaluate `tolist()` → JSON decode
 *   Large (>= threshold): evaluate `tobytes()` → Base64 → Uint8Array
 */
export async function fetchArrayData(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo,
    thresholdJsonChars = LARGE_DATA_THRESHOLD_JSON_CHARS
): Promise<RawArrayData | null> {
    if (!info.shape || !info.dtype) {
        return null;
    }

    const { shape, dtype } = info;
    const totalElements = shape.reduce((a, b) => a * b, 1);

    // Compare estimated JSON text size against the threshold.
    // json.dumps() produces far more bytes than the raw binary:
    //   float32/float64 → ~12-18 ASCII chars per number
    //   int32           → ~6
    //   uint8           → ~3
    // Using this estimate prevents DAP string-length truncation for arrays
    // that are small in binary but large when serialised as JSON.
    const estimatedJsonBytes = totalElements * jsonCharsPerElement(dtype);

    if (estimatedJsonBytes < thresholdJsonChars) {
        return fetchArraySmall(session, varName, info);
    } else {
        return fetchArrayLarge(session, varName, info);
    }
}

/** Small arrays: JSON path via tolist() */
async function fetchArraySmall(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<RawArrayData | null> {
    const expr = buildToListExpr(varName, info);
    const result = await evaluateExpression(session, expr, info.frameId);
    if (!result) {
        return null;
    }
    try {
        const jsonStr = result.startsWith("'") ? result.slice(1, -1) : result;
        const parsed = JSON.parse(jsonStr);
        const flat = flattenNestedArray(parsed);
        const dtype = info.dtype!;
        const buffer = numbersToBytesForDtype(flat, dtype);
        return { buffer, dtype, shape: info.shape! };
    } catch (e) {
        logger.debug(`[Python] fetchArraySmall: JSON parse failed for "${varName}": ${e}`);
        return null;
    }
}

/**
 * Large arrays: loopback TCP socket transfer (bypasses DAP string-length limit).
 *
 * Delegates to receiveBytesViaTcp (src/utils/tcpTransfer.ts).
 * That module owns the server lifecycle; this function only builds the
 * Python expression and triggers it via a DAP evaluate call.
 */
async function fetchArrayLarge(
    session: vscode.DebugSession,
    varName: string,
    info: VariableInfo
): Promise<RawArrayData | null> {
    const bytesExpr = buildToBytesExpr(varName);

    const buffer = await receiveBytesViaTcp(async (port) => {
        // Pure Python expression — outer lambda binds (bytes, port),
        // inner lambda creates the socket, connects, sends, and closes.
        const sendExpr =
            `(lambda __arr, __port:` +
            ` (lambda __s: (__s.connect(('127.0.0.1', __port)), __s.sendall(__arr), __s.close()))` +
            ` (__import__('socket').socket()))` +
            `(${bytesExpr}, ${port})`;
        return evaluateExpression(session, sendExpr, info.frameId);
    });

    if (!buffer) { return null; }
    return { buffer, dtype: info.dtype!, shape: info.shape! };
}

/**
 * Build the Python expression that produces raw bytes for the array.
 * The `varName` may itself be a compound expression (e.g. the torch provider
 * passes `__import__('numpy').array(tensor.detach().cpu().float())`),
 * so we simply wrap it with ascontiguousarray to ensure C-order layout.
 */
function buildToBytesExpr(varName: string): string {
    return `__import__('numpy').ascontiguousarray(${varName}).tobytes()`;
}

// ── Pure list/tuple fetch ─────────────────────────────────────────────────

/** Fetch a Python list/tuple as a flat number array. */
export async function fetchListData(
    session: vscode.DebugSession,
    varName: string,
    frameId?: number
): Promise<number[] | null> {
    const expr = `__import__('json').dumps(list(${varName}))`;
    const result = await evaluateExpression(session, expr, frameId);
    if (!result) {
        return null;
    }
    try {
        const jsonStr = result.startsWith("'") ? result.slice(1, -1) : result;
        return JSON.parse(jsonStr) as number[];
    } catch (e) {
        logger.debug(`[Python] fetchListData: JSON parse failed for "${varName}": ${e}`);
        return null;
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildToListExpr(varName: string, info: VariableInfo): string {
    if (info.typeName?.startsWith("numpy")) {
        return `__import__('json').dumps(${varName}.tolist())`;
    }
    if (info.typeName?.startsWith("torch")) {
        return `__import__('json').dumps(${varName}.detach().cpu().tolist())`;
    }
    return `__import__('json').dumps(list(${varName}))`;
}

function flattenNestedArray(arr: unknown): number[] {
    if (!Array.isArray(arr)) {
        return [arr as number];
    }
    return arr.flatMap((x) => flattenNestedArray(x));
}

function numbersToBytesForDtype(numbers: number[], dtype: string): Uint8Array {
    switch (dtype) {
        case "uint8":
            return new Uint8Array(numbers);
        case "int8":
            return new Uint8Array(new Int8Array(numbers).buffer);
        case "uint16":
            return new Uint8Array(new Uint16Array(numbers).buffer);
        case "int16":
            return new Uint8Array(new Int16Array(numbers).buffer);
        case "uint32":
            return new Uint8Array(new Uint32Array(numbers).buffer);
        case "int32":
            return new Uint8Array(new Int32Array(numbers).buffer);
        case "float32":
            return new Uint8Array(new Float32Array(numbers).buffer);
        case "float64":
            return new Uint8Array(new Float64Array(numbers).buffer);
        default:
            return new Uint8Array(new Float64Array(numbers).buffer);
    }
}

/**
 * Conservative upper-bound estimate of ASCII characters json.dumps() produces
 * per array element for a given dtype. Used by fetchArrayData to decide JSON
 * vs binary transfer path.
 *
 * Rules:
 *   - Integer types: exact worst-case ceil(log10(max_abs_value)) + sign + comma.
 *   - Float types: numpy tolist() promotes ALL float subtypes to Python float
 *     (float64), so json.dumps always uses float64 repr regardless of original
 *     dtype.  Worst case is scientific notation e.g. "-1.7976931348623157e+308"
 *     = 24 chars.  We use 26 to include array brackets/list overhead per slot
 *     and leave a safety margin.
 */
function jsonCharsPerElement(dtype: string): number {
    switch (dtype) {
        case "uint8": return 4;   // max "255,"
        case "int8": return 5;   // max "-128,"
        case "uint16": return 6;   // max "65535,"
        case "int16": return 7;   // max "-32768,"
        case "uint32": return 11;  // max "4294967295,"
        case "int32": return 12;  // max "-2147483648,"
        case "uint64": return 21;  // max "18446744073709551615,"
        case "int64": return 21;  // max "-9223372036854775808,"
        // All float dtypes: tolist() → Python float → float64 repr, worst case
        // "-1.7976931348623157e+308," = 25 chars.  Use 26 as safe upper bound.
        case "float16":
        case "float32":
        case "float64":
        default: return 26;
    }
}
