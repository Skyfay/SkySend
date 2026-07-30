import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createRequestLogger, redactSensitivePath } from "../src/middleware/request-logger.js";

const ID = "c9c9c3a2-9c3b-4585-a9b8-8b001a8051c7";
const SECRET = "Xy1wbZmb0OePQDYhBptXGNdYyUFWZAQhW_JaiMDlT8g";

describe("redactSensitivePath", () => {
  it("drops a percent-encoded key from the incoming line", () => {
    expect(redactSensitivePath(`<-- GET /file/${ID}%23${SECRET}`)).toBe(`<-- GET /file/${ID}`);
  });

  it("keeps status and duration on the outgoing line", () => {
    expect(redactSensitivePath(`--> GET /file/${ID}%23${SECRET} 200 4ms`)).toBe(
      `--> GET /file/${ID} 200 4ms`,
    );
  });

  it("keeps an ANSI-coloured status intact", () => {
    const line = `--> GET /file/${ID}%23${SECRET} [33m404[0m 2ms`;
    expect(redactSensitivePath(line)).toBe(`--> GET /file/${ID} [33m404[0m 2ms`);
  });

  it("drops a double-encoded key", () => {
    expect(redactSensitivePath(`<-- GET /file/${ID}%2523${SECRET}`)).toBe(`<-- GET /file/${ID}`);
  });

  it("covers note and legacy download paths", () => {
    expect(redactSensitivePath(`<-- GET /note/${ID}%23${SECRET}`)).toBe(`<-- GET /note/${ID}`);
    expect(redactSensitivePath(`<-- GET /d/${ID}%23${SECRET}`)).toBe(`<-- GET /d/${ID}`);
  });

  it("drops a query string appended to a share-link path", () => {
    expect(redactSensitivePath(`<-- GET /file/${ID}%23${SECRET}?utm_source=mail`)).toBe(
      `<-- GET /file/${ID}`,
    );
  });

  it("leaves an intact share link untouched", () => {
    expect(redactSensitivePath(`--> GET /file/${ID} 200 1ms`)).toBe(`--> GET /file/${ID} 200 1ms`);
  });

  it("leaves API paths and their query strings untouched", () => {
    expect(redactSensitivePath(`--> GET /api/info/${ID} 200 1ms`)).toBe(
      `--> GET /api/info/${ID} 200 1ms`,
    );
    expect(redactSensitivePath("--> POST /api/upload/abc/chunk?index=3 200 9ms")).toBe(
      "--> POST /api/upload/abc/chunk?index=3 200 9ms",
    );
  });
});

// The redaction only matters if it is actually wired into the middleware, so this
// asserts on what reaches the console. That is the security property itself here,
// not a stand-in for some other behavior.
describe("createRequestLogger", () => {
  it("keeps a rewritten share-link key out of the log", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });

    const app = new Hono();
    app.use("*", createRequestLogger());
    app.get("*", (c) => c.text("ok"));

    await app.request(`http://localhost/file/${ID}%23${SECRET}`);
    await app.request("http://localhost/api/config");

    spy.mockRestore();

    expect(lines.some((line) => line.includes(SECRET))).toBe(false);
    expect(lines.some((line) => line.includes(`/file/${ID}`))).toBe(true);
    expect(lines.some((line) => line.includes("/api/config"))).toBe(true);
  });
});
