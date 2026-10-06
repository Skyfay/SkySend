import { createHash } from "node:crypto";
import { z } from "zod";
import {
  constantTimeEqual,
  fromBase64url,
  toBase64url,
  REQUEST_TOKEN_LENGTH,
} from "@skysend/crypto";

/** Request and upload IDs come from randomUUID() and are stored in lower case. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Binary field sent as canonical base64url, checked for its decoded length. Every other
 * spelling of the same bytes is refused, so one value has one encoding.
 */
export function base64urlBytes(min: number, max = min) {
  return z
    .string()
    .max(Math.ceil((max * 4) / 3))
    .transform((value, ctx) => {
      let bytes: Uint8Array;
      try {
        bytes = fromBase64url(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid base64url" });
        return z.NEVER;
      }
      if (toBase64url(bytes) !== value) {
        ctx.addIssue({ code: "custom", message: "Invalid base64url" });
        return z.NEVER;
      }
      if (bytes.length < min || bytes.length > max) {
        const expected = min === max ? `${min}` : `${min} to ${max}`;
        ctx.addIssue({ code: "custom", message: `Must be ${expected} bytes` });
        return z.NEVER;
      }
      return Buffer.from(bytes);
    });
}

/**
 * The bytes of a token header, or null when it is missing or not 32 bytes of canonical
 * base64url. Callers answer null like a wrong token.
 */
export function tokenHeader(value: string | undefined): Buffer | null {
  const parsed = base64urlBytes(REQUEST_TOKEN_LENGTH).safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What the database keeps of a request token: its SHA-256, so a copy of the database grants
 * none of the rights the token does. The tokens are 32 uniform bytes, so no slow hash is
 * needed.
 */
export function hashToken(token: Uint8Array): string {
  return toBase64url(new Uint8Array(createHash("sha256").update(token).digest()));
}

/** Whether a token header matches a stored token hash, compared in constant time. */
export function tokenMatches(value: string | undefined, storedHash: string): boolean {
  const provided = tokenHeader(value);
  return (
    provided !== null &&
    constantTimeEqual(fromBase64url(hashToken(provided)), fromBase64url(storedHash))
  );
}

/** Encodes a stored binary column for a response. */
export function encodeBytes(value: Buffer): string {
  return toBase64url(new Uint8Array(value));
}
