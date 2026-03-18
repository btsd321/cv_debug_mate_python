/**
 * versionUtils.ts — Shared helpers for C++ library version string parsing.
 *
 * These utilities are shared across all per-debugger versionInfo files
 * (codelldb / gdb / cppvsdbg) and their per-lib sub-files.
 */

/**
 * Parse a version component string returned by DAP evaluate.
 *
 * GDB may return error messages (e.g. "No symbol \"getVersionMajor\"") instead
 * of null when a symbol is not found.  This function rejects any non-numeric
 * result and returns null so that callers can skip missing libraries cleanly.
 *
 * @returns The integer value when the string parses as a non-negative integer
 *          in the range [0, 9999], otherwise null.
 */
export function parseVersionNum(val: string | null): number | null {
    if (val === null) { return null; }
    const n = parseInt(val.trim(), 10);
    if (!isNaN(n) && n >= 0 && n < 10_000) { return n; }
    return null;
}
