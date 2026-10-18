import * as http from "node:http";
import * as net from "node:net";
import { randomBytes } from "node:crypto";
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
  /** The path the login comes back to, unguessable, like `/callback/<32 random bytes>`. */
  path: string;
  waitForToken: Promise<string>;
  close: () => void;
}

/**
 * Start a temporary HTTP server on a random localhost port.
 * Resolves `waitForToken` with the JWT once the OIDC callback arrives on `path`.
 * Closes itself automatically after receiving one token.
 *
 * Only `path` gets an answer. Any program on this computer, and any web page the browser has
 * open, can reach the port, and without a secret path one of them could hand in a session of
 * another account or end the login. The server keeps the path of the callback it is given, so
 * this works with every server version.
 */
export function startLocalCallbackServer(): Promise<LocalCallbackServer> {
  return new Promise((resolve, reject) => {
    let tokenResolve: (token: string) => void;
    let tokenReject: (err: Error) => void;

    const waitForToken = new Promise<string>((res, rej) => {
      tokenResolve = res;
      tokenReject = rej;
    });
    const path = `/callback/${randomBytes(32).toString("base64url")}`;

    const server = http.createServer((req, res) => {
      /* v8 ignore next */
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== path) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
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
            path,
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
 * On a machine without a desktop, or over SSH, there is no opener: `onFail` is called instead of
 * the error ending the process, and the caller has printed the address anyway.
 *
 * Only http and https addresses open, never a file or a program a link could name. The address
 * comes from a server, which may be one from the public list, so on Windows it never goes through
 * cmd.exe: cmd reads & | ^ < > in it as its own syntax and ran whatever followed. rundll32 hands
 * the address to the default browser as it is.
 */
export function openBrowser(url: string, onFail?: () => void): void {
  let target: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Not a web address");
    target = parsed.href;
  } catch {
    onFail?.();
    return;
  }
  const platform = process.platform;
  const [command, args] =
    platform === "darwin"
      ? ["open", [target]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => onFail?.());
  child.unref();
}

// ── OIDC Login Flow ────────────────────────────────────

/**
 * Run the full browser-based OIDC login flow for a given server.
 * Returns the session JWT after the user completes the login.
 */
export async function performOidcLogin(serverUrl: string): Promise<string> {
  const normalized = serverUrl.replace(/\/+$/, "");
  const callbackServer = await startLocalCallbackServer();
  const callbackUrl = `http://127.0.0.1:${callbackServer.port}${callbackServer.path}`;
  const loginUrl = `${normalized}/auth/login?cli_callback=${encodeURIComponent(callbackUrl)}`;

  // Straight to stderr: the Bun binary wraps console.error in a color code where FORCE_COLOR
  // is set, and a script that reads the address would take the code along into the URL.
  process.stderr.write(
    `\nOpening browser for login: ${loginUrl}\n` +
      "If no browser opens, open that address in a browser on this computer.\n" +
      "Waiting for authentication...\n\n",
  );
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
