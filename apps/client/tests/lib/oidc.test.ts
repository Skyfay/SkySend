import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Test isolation ────────────────────────────────────────────────────────────
// Use a temp dir so config/token file I/O doesn't pollute the real config dir.

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "skysend-oidc-test-"));
  process.env["XDG_CONFIG_HOME"] = tempDir;
});

afterEach(() => {
  delete process.env["XDG_CONFIG_HOME"];
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(tempDir, { recursive: true, force: true });
});

// ── JWT factory helpers ───────────────────────────────────────────────────────
// isTokenExpired / decodeTokenUser only base64url-decode the payload without
// verifying the signature, so we build minimal unsigned tokens for testing.

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256" })}.${b64url(payload)}.fakesig`;
}

function makeUserToken(
  overrides: Record<string, unknown> = {},
  expiresInSec = 3600,
): string {
  return fakeJwt({
    sub: "u-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
    ...overrides,
  });
}

// ── isTokenExpired ────────────────────────────────────────────────────────────

describe("isTokenExpired", () => {
  it("returns false for a valid token with plenty of time remaining", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    expect(isTokenExpired(makeUserToken({}, 3600))).toBe(false);
  });

  it("returns true for a token that has already expired", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    const token = fakeJwt({
      sub: "u-1",
      exp: Math.floor(Date.now() / 1000) - 60, // 60 seconds in the past
    });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true when the token expires within the 30-second buffer", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    // exp is 10 seconds from now - inside the 30 s buffer
    const token = fakeJwt({ sub: "u-1", exp: Math.floor(Date.now() / 1000) + 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("returns true when the token has no exp claim", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    expect(isTokenExpired(fakeJwt({ sub: "u-1", name: "Ada" }))).toBe(true);
  });

  it("returns true for a completely malformed token", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    expect(isTokenExpired("not-a-jwt")).toBe(true);
    expect(isTokenExpired("")).toBe(true);
    expect(isTokenExpired("a.b")).toBe(true); // only 2 parts
  });

  it("returns true when the payload is not valid JSON", async () => {
    const { isTokenExpired } = await import("../../src/lib/oidc.js");
    const token = [
      Buffer.from("{}").toString("base64url"),
      Buffer.from("not-json!!!").toString("base64url"),
      "sig",
    ].join(".");
    expect(isTokenExpired(token)).toBe(true);
  });
});

// ── decodeTokenUser ───────────────────────────────────────────────────────────

describe("decodeTokenUser", () => {
  it("returns the correct user object from a valid token", async () => {
    const { decodeTokenUser } = await import("../../src/lib/oidc.js");
    const user = decodeTokenUser(makeUserToken());
    expect(user).toMatchObject({
      sub: "u-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(typeof user!.exp).toBe("number");
  });

  it("returns null for a token missing required fields (no email)", async () => {
    const { decodeTokenUser } = await import("../../src/lib/oidc.js");
    const token = fakeJwt({
      sub: "u-1",
      name: "Ada",
      exp: Math.floor(Date.now() / 1000) + 3600,
      // email is missing
    });
    expect(decodeTokenUser(token)).toBeNull();
  });

  it("returns null for a completely malformed token", async () => {
    const { decodeTokenUser } = await import("../../src/lib/oidc.js");
    expect(decodeTokenUser("not-a-jwt")).toBeNull();
    expect(decodeTokenUser("")).toBeNull();
  });

  it("returns null when payload is not valid JSON", async () => {
    const { decodeTokenUser } = await import("../../src/lib/oidc.js");
    const token = [
      Buffer.from("{}").toString("base64url"),
      Buffer.from("!!!invalid json").toString("base64url"),
      "sig",
    ].join(".");
    expect(decodeTokenUser(token)).toBeNull();
  });
});

// ── openBrowser ───────────────────────────────────────────────────────────────
// vi.resetModules() + vi.doMock() lets each test load a fresh module instance
// with a different process.platform mock.

describe("openBrowser", () => {
  it("uses 'open' on macOS", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const spawnMock = vi.fn().mockReturnValue({ unref: vi.fn(), on: vi.fn() });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { openBrowser } = await import("../../src/lib/oidc.js");
    openBrowser("https://example.com/auth");

    expect(spawnMock).toHaveBeenCalledWith("open", ["https://example.com/auth"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("hands the address to rundll32 on Windows, never to cmd.exe", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const spawnMock = vi.fn().mockReturnValue({ unref: vi.fn(), on: vi.fn() });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { openBrowser } = await import("../../src/lib/oidc.js");
    // cmd.exe read the & as the end of one command and ran what followed.
    openBrowser("https://evil.example/&calc.exe");

    expect(spawnMock).toHaveBeenCalledWith(
      "rundll32",
      ["url.dll,FileProtocolHandler", "https://evil.example/&calc.exe"],
      { detached: true, stdio: "ignore" },
    );
    expect(spawnMock.mock.calls.some(([command]) => /cmd/i.test(String(command)))).toBe(false);
  });

  it("uses 'xdg-open' on Linux", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const spawnMock = vi.fn().mockReturnValue({ unref: vi.fn(), on: vi.fn() });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { openBrowser } = await import("../../src/lib/oidc.js");
    openBrowser("https://example.com/auth");

    expect(spawnMock).toHaveBeenCalledWith("xdg-open", ["https://example.com/auth"], {
      detached: true,
      stdio: "ignore",
    });
  });

  it("opens no address that is not http or https", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const spawnMock = vi.fn().mockReturnValue({ unref: vi.fn(), on: vi.fn() });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { openBrowser } = await import("../../src/lib/oidc.js");
    const onFail = vi.fn();
    for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "not a url"]) {
      openBrowser(url, onFail);
    }
    expect(spawnMock).not.toHaveBeenCalled();
    expect(onFail).toHaveBeenCalledTimes(3);
  });

  it("does not end the process where no browser can be opened", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.doUnmock("node:child_process");
    vi.resetModules();
    const savedPath = process.env.PATH;
    // No xdg-open on the path, like a server without a desktop.
    process.env.PATH = "/nonexistent";
    try {
      const { openBrowser } = await import("../../src/lib/oidc.js");
      const failed = await new Promise<boolean>((resolve) => {
        openBrowser("https://example.com/auth", () => resolve(true));
        setTimeout(() => resolve(false), 2000);
      });
      expect(failed).toBe(true);
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

// ── startLocalCallbackServer ──────────────────────────────────────────────────

describe("startLocalCallbackServer", () => {
  it("starts a server on a valid port", async () => {
    const { startLocalCallbackServer } = await import("../../src/lib/oidc.js");
    const srv = await startLocalCallbackServer();
    expect(srv.port).toBeGreaterThan(0);
    expect(srv.port).toBeLessThanOrEqual(65535);
    srv.close();
  });

  it("resolves waitForToken when a request with ?token= arrives", async () => {
    const { startLocalCallbackServer } = await import("../../src/lib/oidc.js");
    const srv = await startLocalCallbackServer();

    const tokenValue = "my.test.jwt";
    const response = await fetch(`http://127.0.0.1:${srv.port}${srv.path}?token=${tokenValue}`);

    expect(response.status).toBe(200);
    const received = await srv.waitForToken;
    expect(received).toBe(tokenValue);
  });

  it("rejects waitForToken when callback has no token param", async () => {
    const { startLocalCallbackServer } = await import("../../src/lib/oidc.js");
    const srv = await startLocalCallbackServer();

    // Set up the rejection expectation BEFORE sending the request so that
    // the promise has an attached handler before it rejects.
    const rejectionPromise = expect(srv.waitForToken).rejects.toThrow("no token");
    await fetch(`http://127.0.0.1:${srv.port}${srv.path}`);
    await rejectionPromise;
  });

  it("answers nothing but its secret path, and a guess does not end the login", async () => {
    const { startLocalCallbackServer } = await import("../../src/lib/oidc.js");
    const srv = await startLocalCallbackServer();
    expect(srv.path).toMatch(/^\/callback\/[A-Za-z0-9_-]{43}$/);
    const other = await startLocalCallbackServer();
    expect(other.path).not.toBe(srv.path);
    other.close();

    // Another program, or a web page that found the port, tries to hand in its own session.
    for (const guess of ["/callback", "/", "/callback/guess"]) {
      const response = await fetch(`http://127.0.0.1:${srv.port}${guess}?token=foreign.session`);
      expect(response.status).toBe(404);
    }
    await fetch(`http://127.0.0.1:${srv.port}${srv.path}?token=the.real.session`);
    expect(await srv.waitForToken).toBe("the.real.session");
  });

  it("rejects when getFreePort cannot determine the port (address() returns null)", async () => {
    // Mock node:net so that the temporary server's address() returns null,
    // triggering the error branch inside getFreePort.
    const mockNetServer = {
      listen: vi.fn().mockImplementation(
        (_port: number, _host: string, cb: () => void) => { cb(); return mockNetServer; },
      ),
      address: vi.fn().mockReturnValue(null),
      close: vi.fn(),
      on: vi.fn(),
    };
    vi.doMock("node:net", () => ({ createServer: vi.fn().mockReturnValue(mockNetServer) }));
    vi.resetModules();

    const { startLocalCallbackServer } = await import("../../src/lib/oidc.js");
    await expect(startLocalCallbackServer()).rejects.toThrow("Could not determine free port");

    // Restore node:net to the real implementation so subsequent tests are unaffected.
    vi.doMock("node:net", async () => vi.importActual("node:net"));
  });
});

// ── performOidcLogin ──────────────────────────────────────────────────────────
// Mock openBrowser (via child_process spawn) so no real browser is opened.
// After the mock captures the login URL, we extract the cli_callback port
// and send a simulated OIDC callback ourselves.

describe("performOidcLogin", () => {
  it("returns the JWT received via the local callback server", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    let capturedUrl = "";
    const spawnMock = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      capturedUrl = args[0] ?? "";
      return { unref: vi.fn(), on: vi.fn() };
    });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { performOidcLogin } = await import("../../src/lib/oidc.js");
    const loginPromise = performOidcLogin("http://localhost:3000");

    // Wait for the server to start and openBrowser to be called
    await vi.waitFor(() => {
      if (!capturedUrl) throw new Error("browser not opened yet");
    }, { timeout: 2000 });

    // The callback address the server is told to send the token to, secret path included
    const callback = new URL(capturedUrl).searchParams.get("cli_callback");
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback\/[A-Za-z0-9_-]{43}$/);

    // Simulate the OIDC provider redirecting to the local callback server
    await fetch(`${callback}?token=simulated.oidc.token`);

    const result = await loginPromise;
    expect(result).toBe("simulated.oidc.token");
  });

  it("includes the server URL in the login URL", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    let capturedUrl = "";
    const spawnMock = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      capturedUrl = args[0] ?? "";
      return { unref: vi.fn(), on: vi.fn() };
    });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { performOidcLogin } = await import("../../src/lib/oidc.js");
    const loginPromise = performOidcLogin("http://myserver.example");

    await vi.waitFor(() => {
      if (!capturedUrl) throw new Error("browser not opened yet");
    }, { timeout: 2000 });

    expect(capturedUrl).toContain("http://myserver.example/auth/login");

    // Clean up: send a token so the promise resolves
    const callback = new URL(capturedUrl).searchParams.get("cli_callback");
    await fetch(`${callback}?token=cleanup.token`);
    await loginPromise;
  });

  it("rejects and closes the callback server when the OIDC callback contains no token", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    let capturedUrl = "";
    const spawnMock = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      capturedUrl = args[0] ?? "";
      return { unref: vi.fn(), on: vi.fn() };
    });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { performOidcLogin } = await import("../../src/lib/oidc.js");
    const loginPromise = performOidcLogin("http://localhost:3000");

    await vi.waitFor(() => {
      if (!capturedUrl) throw new Error("browser not opened yet");
    }, { timeout: 2000 });

    // Attach the rejection handler BEFORE sending the request, so the promise
    // has a handler before it rejects (same pattern as "rejects waitForToken" above).
    const callback = new URL(capturedUrl).searchParams.get("cli_callback");
    const rejectionPromise = expect(loginPromise).rejects.toThrow("no token");
    await fetch(`${callback}`);
    await rejectionPromise;
  });
});

// ── ensureOidcAuth ────────────────────────────────────────────────────────────

describe("ensureOidcAuth", () => {
  it("returns the cached token when it is still valid", async () => {
    const { ensureOidcAuth } = await import("../../src/lib/oidc.js");
    const { saveStoredToken } = await import("../../src/lib/config.js");

    const token = makeUserToken({}, 3600);
    saveStoredToken("http://localhost:3000", token);

    const result = await ensureOidcAuth("http://localhost:3000");
    expect(result).toBe(token);
  });

  it("normalizes trailing slashes when looking up the cached token", async () => {
    const { ensureOidcAuth } = await import("../../src/lib/oidc.js");
    const { saveStoredToken } = await import("../../src/lib/config.js");

    const token = makeUserToken({}, 3600);
    saveStoredToken("http://localhost:3000", token);

    const result = await ensureOidcAuth("http://localhost:3000///");
    expect(result).toBe(token);
  });

  it("initiates login when the stored token is expired", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");

    let capturedUrl = "";
    const spawnMock = vi.fn().mockImplementation((_cmd: string, args: string[]) => {
      capturedUrl = args[0] ?? "";
      return { unref: vi.fn(), on: vi.fn() };
    });
    vi.doMock("node:child_process", () => ({ spawn: spawnMock }));
    vi.resetModules();

    const { ensureOidcAuth } = await import("../../src/lib/oidc.js");
    const { saveStoredToken } = await import("../../src/lib/config.js");

    // Store an already-expired token
    const expiredToken = fakeJwt({
      sub: "u-1",
      name: "Ada",
      email: "ada@example.com",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    saveStoredToken("http://localhost:3000", expiredToken);

    const authPromise = ensureOidcAuth("http://localhost:3000");

    // Wait for the browser opener to be called
    await vi.waitFor(() => {
      if (!capturedUrl) throw new Error("browser not opened yet");
    }, { timeout: 2000 });

    // Send simulated callback
    const callback = new URL(capturedUrl).searchParams.get("cli_callback");
    await fetch(`${callback}?token=new.fresh.token`);

    const result = await authPromise;
    expect(result).toBe("new.fresh.token");
  });
});
  process.env["XDG_CONFIG_HOME"] = tempDir;
