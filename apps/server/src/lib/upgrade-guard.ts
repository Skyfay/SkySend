import { EventEmitter } from "node:events";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { describeError } from "./log-error.js";

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => unknown;

/** The only routes that accept a WebSocket: an upload, and an upload into a file request. */
const WEBSOCKET_PATHS = [/^\/api\/upload\/ws$/, /^\/api\/request\/[^/]+\/upload\/ws$/];

/**
 * Whether an upgrade request asks for a WebSocket on one of the two upload routes. The target
 * has to be a plain path: "//" or "http://[" made the listener of @hono/node-ws throw in
 * `new URL` before any route ran.
 */
export function isWebSocketUpgrade(request: IncomingMessage): boolean {
  if (request.headers.upgrade?.toLowerCase() !== "websocket") return false;
  const target = request.url ?? "";
  if (!target.startsWith("/") || target.startsWith("//")) return false;
  const path = target.split("?", 1)[0] ?? "";
  return WEBSOCKET_PATHS.some((pattern) => pattern.test(path));
}

/**
 * Attaches the upgrade listener of @hono/node-ws behind a guard, instead of on the server itself.
 *
 * The listener runs for every request with an Upgrade header, on any path. It dispatches the
 * request to the GET route of that path and drops the response, so a download route opened a
 * file stream nobody read or closed. It adds no error handler to the raw socket, which Node hands
 * over without one, so a client that reset the connection crashed the process. And a target that
 * `new URL` refused became an unhandled rejection that crashed it too.
 *
 * The guard gives every upgrade socket an error handler, answers 400 to anything that is not a
 * WebSocket upgrade of an upload route before any route runs, and destroys the socket when the
 * listener fails, so one bad request only ever ends its own connection.
 */
export function guardUpgrades(server: Server, inject: (server: Server) => void): void {
  const inner = new EventEmitter();
  inject(inner as unknown as Server);
  const listeners = inner.listeners("upgrade") as UpgradeListener[];

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    if (!isWebSocketUpgrade(request)) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    for (const listener of listeners) {
      Promise.resolve()
        .then(() => listener(request, socket, head))
        .catch((err: unknown) => {
          console.error("[ws] Upgrade failed:", describeError(err));
          socket.destroy();
        });
    }
  });
}
