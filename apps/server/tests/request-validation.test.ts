import { describe, expect, it } from "vitest";
import { toBase64url } from "@skysend/crypto";
import {
  base64urlBytes,
  hashToken,
  tokenHeader,
  tokenMatches,
} from "../src/lib/request-validation.js";

const bytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

describe("base64urlBytes", () => {
  const field = base64urlBytes(4, 8);

  it("takes canonical base64url of a length in range", () => {
    const value = bytes(6);
    const parsed = field.safeParse(toBase64url(value));
    expect(parsed.success && new Uint8Array(parsed.data)).toEqual(value);
  });

  it("refuses characters outside the base64url alphabet", () => {
    const parsed = field.safeParse("!!!!!!");
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Invalid base64url");
  });

  it("refuses a second spelling of the same bytes", () => {
    // "AAAAAB" decodes to the same four bytes as "AAAAAA", with a stray bit in the last one.
    for (const value of ["AAAAAB", "AAAAAA==", "AAAA AA"]) {
      expect(field.safeParse(value).success).toBe(false);
    }
  });

  it("names the length it expects", () => {
    expect(field.safeParse(toBase64url(bytes(3))).error?.issues[0]?.message).toBe(
      "Must be 4 to 8 bytes",
    );
    expect(base64urlBytes(16).safeParse(toBase64url(bytes(15))).error?.issues[0]?.message).toBe(
      "Must be 16 bytes",
    );
  });
});

describe("request tokens", () => {
  it("reads a token header of 32 canonical bytes and nothing else", () => {
    const token = bytes(32);
    expect(new Uint8Array(tokenHeader(toBase64url(token))!)).toEqual(token);
    for (const value of [undefined, "", "!".repeat(43), toBase64url(bytes(31))]) {
      expect(tokenHeader(value)).toBeNull();
    }
  });

  it("matches a token header against the stored hash only", () => {
    const token = bytes(32);
    const stored = hashToken(token);
    expect(stored).not.toBe(toBase64url(token));
    expect(tokenMatches(toBase64url(token), stored)).toBe(true);
    expect(tokenMatches(toBase64url(bytes(32)), stored)).toBe(false);
    // The stored hash itself opens nothing, so a copy of the database grants no rights.
    expect(tokenMatches(stored, stored)).toBe(false);
    expect(tokenMatches("!".repeat(43), stored)).toBe(false);
    expect(tokenMatches(undefined, stored)).toBe(false);
  });
});
