import { SignJWT, jwtVerify } from "jose";
import {
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  randomState,
  randomNonce,
} from "openid-client";
import type { OidcUser } from "./types.js";

// ── JWT session ────────────────────────────────────────

const SESSION_COOKIE = "skysend-auth";
const PKCE_COOKIE = "skysend-pkce";

/**
 * Sign a session JWT containing the user's identity.
 * Uses HS256 with the provided secret.
 */
export async function createSessionJwt(
  user: OidcUser,
  secret: string,
  durationSec: number,
): Promise<string> {
  const key = await importSecret(secret);
  return new SignJWT({ sub: user.sub, name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${durationSec}s`)
    .sign(key);
}

/**
 * Verify a session JWT. Returns the user payload or null if invalid / expired.
 */
export async function verifySessionJwt(
  token: string,
  secret: string,
): Promise<OidcUser | null> {
  try {
    const key = await importSecret(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (
      typeof payload["sub"] === "string" &&
      typeof payload["name"] === "string" &&
      typeof payload["email"] === "string"
    ) {
      return {
        sub: payload["sub"],
        name: payload["name"],
        email: payload["email"],
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── PKCE helpers ───────────────────────────────────────

export interface PkceState {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
}

/**
 * Generate a fresh PKCE state bundle (state, code_verifier, code_challenge).
 * Uses openid-client's crypto helpers which rely on the Web Crypto API.
 */
export async function createPkceState(): Promise<PkceState> {
  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  return { state, nonce, codeVerifier, codeChallenge };
}

/**
 * Sign a short-lived PKCE JWT (5 minutes) for the state + codeVerifier.
 */
export async function createPkceJwt(
  pkce: PkceState,
  secret: string,
): Promise<string> {
  const key = await importSecret(secret);
  return new SignJWT({ state: pkce.state, nonce: pkce.nonce, codeVerifier: pkce.codeVerifier })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

/**
 * Verify the PKCE cookie JWT. Returns `{ state, codeVerifier }` or null.
 */
export async function verifyPkceJwt(
  token: string,
  secret: string,
): Promise<{ state: string; nonce: string; codeVerifier: string } | null> {
  try {
    const key = await importSecret(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (
      typeof payload["state"] === "string" &&
      typeof payload["nonce"] === "string" &&
      typeof payload["codeVerifier"] === "string"
    ) {
      return { state: payload["state"], nonce: payload["nonce"], codeVerifier: payload["codeVerifier"] };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Cookie helpers ─────────────────────────────────────

export { SESSION_COOKIE, PKCE_COOKIE };

/**
 * Build the cookie attribute string for the session cookie.
 * Secure flag is set when BASE_URL starts with https://.
 */
export function sessionCookieOptions(baseUrl: string, maxAgeSec: number): string {
  const secure = baseUrl.startsWith("https://");
  const parts = [
    `Max-Age=${maxAgeSec}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build a short-lived (5-minute) cookie attribute string for the PKCE cookie.
 */
export function pkceCookieOptions(baseUrl: string): string {
  return sessionCookieOptions(baseUrl, 300);
}

/**
 * Build a Set-Cookie header value that clears a cookie.
 */
export function clearCookieOptions(): string {
  return "Max-Age=0; Path=/; HttpOnly; SameSite=Lax";
}

// ── Internal ───────────────────────────────────────────

async function importSecret(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
