/**
 * logger.ts — Singleton logger for MatrixViewer.
 *
 * Initialised once in extension.ts `activate()`:
 *   import { logger } from "./log/logger";
 *   logger.init(vscode.window.createOutputChannel("MatrixViewer"));
 *
 * Usage anywhere else:
 *   import { logger } from "../../log/logger";
 *   logger.debug("something happened");
 *   logger.warn(`unexpected value: ${x}`);
 *
 * Level filtering (default: DEBUG — all messages pass):
 *   logger.setLevel("INFO");   // suppress DEBUG output in production
 */

import * as vscode from "vscode";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/** Matches the injection signature used by external consumers. */
export type LogFn = (level: LogLevel, msg: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function timestamp(): string {
    const d = new Date();
    const hh  = String(d.getHours()).padStart(2, "0");
    const mm  = String(d.getMinutes()).padStart(2, "0");
    const ss  = String(d.getSeconds()).padStart(2, "0");
    const ms  = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
}

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
            this._channel?.appendLine(`[${timestamp()}] [${level}] ${message}`);
        }
    }

    debug(message: string): void { this.logf("DEBUG", message); }
    info (message: string): void { this.logf("INFO",  message); }
    warn (message: string): void { this.logf("WARN",  message); }
    error(message: string): void { this.logf("ERROR", message); }
}

export const logger = new Logger();

