import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { getRequestListener } from "@hono/node-server";
import { guardUpgrades, isWebSocketUpgrade } from "../src/lib/upgrade-guard.js";

function upgradeRequest(url: string, upgrade = "websocket"): IncomingMessage {
  return { url, headers: { upgrade } } as unknown as IncomingMessage;
}

describe("isWebSocketUpgrade", () => {
  it("accepts a WebSocket upgrade of the two upload routes", () => {
    expect(isWebSocketUpgrade(upgradeRequest("/api/upload/ws"))).toBe(true);
    expect(isWebSocketUpgrade(upgradeRequest("/api/upload/ws?x=1"))).toBe(true);
    expect(isWebSocketUpgrade(upgradeRequest("/api/request/abc/upload/ws"))).toBe(true);
    expect(isWebSocketUpgrade(upgradeRequest("/api/upload/ws", "WebSocket"))).toBe(true);
  });

  it("refuses other paths, other protocols and targets that are not a plain path", () => {
    expect(isWebSocketUpgrade(upgradeRequest("/api/download/abc"))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("/api/health"))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("/api/upload/ws/"))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("/api/upload/ws", "h2c"))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("//"))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("http://["))).toBe(false);
    expect(isWebSocketUpgrade(upgradeRequest("*"))).toBe(false);
  });
});

/** Sends raw bytes and resolves with everything the server answers until it closes. */
function rawRequest(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(request));
    let answer = "";
    socket.on("data", (data) => (answer += data.toString()));
    socket.on("close", () => resolve(answer));
    socket.on("error", reject);
  });
}

function upgradeHeaders(target: string, upgrade = "websocket"): string {
  return (
    `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: ${upgrade}\r\n` +
    "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
  );
}

describe("guardUpgrades", () => {
  let server: Server;
  let port: number;
  let downloads: number;

  beforeEach(async () => {
    downloads = 0;
    const app = new Hono();
    const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
    app.get("/api/download/:id", (c) => {
      downloads++;
      return c.body("ciphertext");
    });
    app.get(
      "/api/upload/ws",
      upgradeWebSocket(() => ({})),
    );
    server = createServer(getRequestListener(app.fetch));
    guardUpgrades(server, injectWebSocket);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("answers 400 to an upgrade of another route without running it", async () => {
    const answer = await rawRequest(port, upgradeHeaders("/api/download/abc"));
    expect(answer).toMatch(/^HTTP\/1\.1 400 /);
    expect(downloads).toBe(0);
  });

  it("answers 400 to a target new URL would refuse and keeps serving", async () => {
    for (const target of ["//", "http://", "http://["]) {
      expect(await rawRequest(port, upgradeHeaders(target))).toMatch(/^HTTP\/1\.1 400 /);
    }
    const res = await fetch(`http://127.0.0.1:${port}/api/download/abc`);
    expect(res.status).toBe(200);
  });

  it("still upgrades the WebSocket upload route", async () => {
    const socket = connect(port, "127.0.0.1", () => socket.write(upgradeHeaders("/api/upload/ws")));
    const first = await new Promise<string>((resolve) =>
      socket.once("data", (data) => resolve(data.toString())),
    );
    socket.destroy();
    expect(first).toMatch(/^HTTP\/1\.1 101 /);
  });

  it("survives a client that resets the connection of an upgrade", async () => {
    for (const upgrade of ["foo", "websocket"]) {
      const socket: Socket = connect(port, "127.0.0.1", () => {
        socket.write(upgradeHeaders("/api/health", upgrade), () => socket.resetAndDestroy());
      });
      socket.on("error", () => {});
      await new Promise((resolve) => socket.on("close", resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const res = await fetch(`http://127.0.0.1:${port}/api/download/abc`);
    expect(res.status).toBe(200);
  });

  it("ends only the socket of an upgrade whose listener fails", async () => {
    const failing = createServer();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    guardUpgrades(failing, (inner) => {
      inner.on("upgrade", async () => {
        throw new TypeError("Invalid URL");
      });
    });
    await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
    const failingPort = (failing.address() as AddressInfo).port;
    try {
      expect(await rawRequest(failingPort, upgradeHeaders("/api/upload/ws"))).toBe("");
      expect(error).toHaveBeenCalledWith("[ws] Upgrade failed:", expect.anything());
    } finally {
      error.mockRestore();
      failing.closeAllConnections();
      await new Promise((resolve) => failing.close(resolve));
    }
  });
});
