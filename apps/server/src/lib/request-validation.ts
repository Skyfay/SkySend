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

/** Whether a token header matches a stored token, compared in constant time. */
export function tokenMatches(value: string | undefined, stored: string): boolean {
  const provided = tokenHeader(value);
  return provided !== null && constantTimeEqual(provided, fromBase64url(stored));
}

/** Encodes a stored binary column for a response. */
export function encodeBytes(value: Buffer): string {
  return toBase64url(new Uint8Array(value));
}
