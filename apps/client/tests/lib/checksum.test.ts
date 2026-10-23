import { describe, expect, it } from "vitest";
import { findChecksum } from "../../src/lib/checksum.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("findChecksum", () => {
  it("finds the line of the asset", () => {
    const listing = `${A}  skysend-linux-arm64\n${B}  skysend-linux-x64\n`;
    expect(findChecksum(listing, "skysend-linux-x64")).toBe(B);
  });

  it("matches the name exactly, not as a substring", () => {
    const listing = `${A}  skysend-windows-x64.exe.sig\n${B}  old-skysend-windows-x64.exe\n`;
    expect(findChecksum(listing, "skysend-windows-x64.exe")).toBeNull();
  });

  it("accepts binary mode and CRLF line endings", () => {
    expect(findChecksum(`${A.toUpperCase()} *skysend-macos-arm64\r\n`, "skysend-macos-arm64")).toBe(
      A,
    );
  });

  it("returns null for a missing asset or a malformed hash", () => {
    expect(findChecksum("", "skysend-linux-x64")).toBeNull();
    expect(findChecksum("not-a-hash  skysend-linux-x64\n", "skysend-linux-x64")).toBeNull();
  });
});
