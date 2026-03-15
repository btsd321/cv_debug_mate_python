/**
 * logger.ts — Singleton logger for MatrixViewer.
 *
 * Initialised once in extension.ts `activate()`:
 *   import { logger, debug, info, warn, error } from "./log/logger";
 *   logger.init(vscode.window.createOutputChannel("MatrixViewer"));
 *
 * Usage anywhere else (import only the levels you need):
 *   import { debug, warn } from "../../log/logger";
 *   debug("something happened");
 *   warn(`unexpected value: ${x}`);
 *
 * Level filtering (default: DEBUG — all messages pass):
 *   logger.setLevel("INFO");   // suppress DEBUG output in production
 */

import * as vscode from "vscode";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Matches the injection signature used by external consumers. */
export type LogFn = (level: LogLevel, msg: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// ── Singleton ─────────────────────────────────────────────────────────────

class Logger {
    private _channel: vscode.OutputChannel | undefined;
    private _level: LogLevel = "DEBUG";

    /** Bind an OutputChannel. Must be called once inside `activate()`. */
    init(channel: vscode.OutputChannel): void {
        this._channel = channel;
    }

    /** The bound output channel (undefined before init()). */
    get channel(): vscode.OutputChannel | undefined {
        return this._channel;
    }

    setLevel(level: LogLevel): void { this._level = level; }
    getLevel(): LogLevel           { return this._level;   }

    /** Core method — only emits when `level` >= current filter level. */
    private logf(level: LogLevel, message: string): void {
        if (LEVEL_ORDER[level] >= LEVEL_ORDER[this._level]) {
            this._channel?.appendLine(`[${level}] ${message}`);
        }
    }

    debug(message: string): void { this.logf("DEBUG", message); }
    info (message: string): void { this.logf("INFO",  message); }
    warn (message: string): void { this.logf("WARN",  message); }
    error(message: string): void { this.logf("ERROR", message); }
}

export const logger = new Logger();

// ── Module-level convenience functions ───────────────────────────────────
export const log_debug = (msg: string): void => logger.debug(msg);
export const log_info  = (msg: string): void => logger.info(msg);
export const log_warn  = (msg: string): void => logger.warn(msg);
export const log_error = (msg: string): void => logger.error(msg);
