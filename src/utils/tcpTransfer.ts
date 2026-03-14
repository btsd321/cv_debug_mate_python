/**
 * tcpTransfer.ts — One-shot localhost TCP byte-stream receiver.
 *
 * Provides a single function `receiveBytesViaTcp` that:
 *   1. Opens a TCP server on a kernel-assigned localhost port.
 *   2. Calls the supplied `trigger(port)` callback so the remote side can
 *      connect and push raw bytes.
 *   3. Buffers all incoming bytes from the first (and only) connection.
 *   4. Resolves with a Uint8Array when the remote side closes the socket,
 *      or with null on timeout / error.
 *
 * This module has no dependency on VS Code or DAP — the caller owns the
 * trigger logic (e.g. a DAP evaluate call that runs Python's socket.sendall).
 *
 * Usage example (Python adapter):
 *
 *   const bytes = await receiveBytesViaTcp(async (port) => {
 *       await evaluateExpression(session,
 *           `(lambda s: (s.connect(('127.0.0.1', ${port})), s.sendall(arr.tobytes()), s.close()))` +
 *           `(__import__('socket').socket())`,
 *           frameId);
 *   });
 */

import * as net from "net";

// Default timeout: give the remote side 20 s to connect and finish sending.
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Open a one-shot localhost TCP server, call `trigger(port)` so the remote
 * sends raw bytes, then return the received bytes as a Uint8Array.
 *
 * @param trigger  Async callback that receives the server port number.
 *                 Must cause the remote end to connect, sendall, and close.
 *                 If it returns null or throws, the transfer is aborted.
 * @param timeoutMs  Hard deadline in milliseconds (default 20 000).
 * @returns Uint8Array with the received bytes, or null on failure.
 */
export function receiveBytesViaTcp(
    trigger: (port: number) => Promise<unknown>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve) => {
        const server = net.createServer();
        const chunks: Buffer[] = [];
        let settled = false;

        function settle(result: Uint8Array | null): void {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            server.close(); // idempotent
            resolve(result);
        }

        const timer = setTimeout(() => settle(null), timeoutMs);

        server.once("error", () => settle(null));

        server.once("connection", (socket) => {
            socket.on("data", (chunk: Buffer) => chunks.push(chunk));
            socket.once("end", () => {
                const buf = Buffer.concat(chunks);
                settle(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            });
            socket.once("error", () => settle(null));
        });

        server.listen(0, "127.0.0.1", async () => {
            const port = (server.address() as net.AddressInfo).port;
            try {
                const result = await trigger(port);
                // If trigger explicitly signals failure (returns null), abort.
                if (result === null) {
                    settle(null);
                }
                // Otherwise wait for the socket 'end' event to deliver the data.
            } catch {
                settle(null);
            }
        });
    });
}
