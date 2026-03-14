/**
 * adapterRegistry.ts — Maps active debug session types to adapters.
 *
 * The registry is a simple ordered list; the first adapter whose
 * isSupportedSession() returns true for a given session is used.
 *
 * To add support for a new language:
 *   1. Implement IDebugAdapter in src/adapters/<lang>/<lang>Adapter.ts
 *   2. Import the class here and add an instance to ADAPTERS below.
 */

import * as vscode from "vscode";
import { IDebugAdapter } from "./IDebugAdapter";
import { PythonAdapter } from "./python/pythonAdapter";
import { CppAdapter } from "./cpp/cppAdapter";

// ── Registered adapters (first match wins) ────────────────────────────────

const ADAPTERS: IDebugAdapter[] = [
    new PythonAdapter(),
    new CppAdapter(),
];

/**
 * Return the adapter that handles the given session, or null if none
 * of the registered adapters support it.
 */
export function getAdapter(
    session: vscode.DebugSession
): IDebugAdapter | null {
    return ADAPTERS.find((a) => a.isSupportedSession(session)) ?? null;
}
