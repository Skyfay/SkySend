import * as http from "node:http";
import * as net from "node:net";
import { spawn } from "node:child_process";
import { getStoredToken, saveStoredToken } from "./config.js";

// ── Token helpers ──────────────────────────────────────

/**
 * Decode the payload of a JWT without verifying the signature.
 * Only used for reading the `exp` claim locally - the server always
 * re-verifies the token on every protected request.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const padded = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf-8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return true;
  const exp = payload["exp"];
  if (typeof exp !== "number") return true;
  // Add a 30-second buffer to avoid using a token that expires mid-request.
  return Date.now() / 1000 >= exp - 30;
}

/**
 * Decode and return user info from a stored JWT payload.
 * Returns null if the token is malformed.
 */
export function decodeTokenUser(token: string): { sub: string; name: string; email: string; exp: number } | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  if (
    typeof payload["sub"] !== "string" ||
    typeof payload["name"] !== "string" ||
    typeof payload["email"] !== "string" ||
    typeof payload["exp"] !== "number"
  ) {
    return null;
  }
  return { sub: payload["sub"], name: payload["name"], email: payload["email"], exp: payload["exp"] };
}

// ── Local callback server ──────────────────────────────

/**
 * Find a free TCP port on localhost by briefly binding to port 0.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not determine free port"));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export interface LocalCallbackServer {
  port: number;
  waitForToken: Promise<string>;
  close: () => void;
}

/**
 * Start a temporary HTTP server on a random localhost port.
 * Resolves `waitForToken` with the JWT once the OIDC callback arrives.
 * Closes itself automatically after receiving one token.
 */
export function startLocalCallbackServer(): Promise<LocalCallbackServer> {
  return new Promise((resolve, reject) => {
    let tokenResolve: (token: string) => void;
    let tokenReject: (err: Error) => void;

    const waitForToken = new Promise<string>((res, rej) => {
      tokenResolve = res;
      tokenReject = rej;
    });

    const server = http.createServer((req, res) => {
      /* v8 ignore next */
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const token = url.searchParams.get("token");

      // Always respond with a friendly HTML page before resolving.
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (token) {
        res.end(
          "<!DOCTYPE html><html><body style=\"font-family:sans-serif;text-align:center;padding:3rem\">" +
          "<h2>Login successful</h2><p>You can close this tab and return to the terminal.</p>" +
          "</body></html>",
        );
        server.close();
        tokenResolve!(token);
      } else {
        res.end(
          "<!DOCTYPE html><html><body style=\"font-family:sans-serif;text-align:center;padding:3rem\">" +
          "<h2>Login failed</h2><p>No token received. Please try again.</p>" +
          "</body></html>",
        );
        server.close();
        tokenReject!(new Error("OIDC callback received no token"));
      }
    });

    getFreePort()
      .then((port) => {
        server.listen(port, "127.0.0.1", () => {
          resolve({
            port,
            waitForToken,
            close: () => server.close(),
          });
        });
        /* v8 ignore next */
        server.on("error", (err) => reject(err));
      })
      .catch(reject);
  });
}

// ── Browser opener ─────────────────────────────────────

/**
 * Open a URL in the user's default browser.
 * Uses platform-appropriate commands without introducing new dependencies.
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "win32") {
    // On Windows, `start` is a shell built-in - must be run via cmd.exe.
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// ── OIDC Login Flow ────────────────────────────────────

/**
 * Run the full browser-based OIDC login flow for a given server.
 * Returns the session JWT after the user completes the login.
 */
export async function performOidcLogin(serverUrl: string): Promise<string> {
  const normalized = serverUrl.replace(/\/+$/, "");
  const callbackServer = await startLocalCallbackServer();
  const callbackUrl = `http://127.0.0.1:${callbackServer.port}/callback`;
  const loginUrl = `${normalized}/auth/login?cli_callback=${encodeURIComponent(callbackUrl)}`;

  console.error(`\nOpening browser for login: ${loginUrl}`);
  console.error("Waiting for authentication...\n");
  openBrowser(loginUrl);

  let token: string;
  try {
    token = await callbackServer.waitForToken;
  } catch (err) {
    callbackServer.close();
    throw err;
  }

  saveStoredToken(normalized, token);
  return token;
}

/**
 * Return a valid session token for the given server.
 * Uses the stored token if it exists and has not expired.
 * Otherwise initiates a new browser-based OIDC login.
 */
export async function ensureOidcAuth(serverUrl: string): Promise<string> {
  const normalized = serverUrl.replace(/\/+$/, "");
  const stored = getStoredToken(normalized);
  if (stored && !isTokenExpired(stored)) {
    return stored;
  }
  return performOidcLogin(normalized);
}
