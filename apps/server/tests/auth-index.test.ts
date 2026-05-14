import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../src/lib/config.js";
import { createOidcAdapter } from "../src/auth/index.js";
import { genericAdapter } from "../src/auth/adapters/generic.js";
import { pocketIdAdapter } from "../src/auth/adapters/pocketid.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    OIDC_PROVIDER: "generic",
    OIDC_ISSUER: "https://provider.example",
    OIDC_PROTECT_FILES: true,
    OIDC_PROTECT_NOTES: true,
    ...overrides,
  } as unknown as Config;
}

describe("createOidcAdapter", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the pocketid adapter for the 'pocketid' provider key", () => {
    const adapter = createOidcAdapter(makeConfig({ OIDC_PROVIDER: "pocketid" }));
    expect(adapter.name).toBe(pocketIdAdapter.name);
  });

  it("falls back to genericAdapter for an unknown provider key", () => {
    const adapter = createOidcAdapter(makeConfig({ OIDC_PROVIDER: "nonexistent-provider" }));
    expect(adapter.name).toBe(genericAdapter.name);
  });

  it("returns the adapter without throwing when validateConfig is absent", () => {
    const adapter = createOidcAdapter(makeConfig({ OIDC_PROVIDER: "authentik" }));
    expect(adapter).toBeDefined();
    expect(adapter.name).toBe("authentik");
  });

  it("emits a warning when neither protect flag is set", () => {
    const warnSpy = vi.spyOn(console, "warn");
    createOidcAdapter(makeConfig({ OIDC_PROTECT_FILES: false, OIDC_PROTECT_NOTES: false }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No upload routes are protected"),
    );
  });

  it("does not warn when at least one protect flag is true", () => {
    const warnSpy = vi.spyOn(console, "warn");
    createOidcAdapter(makeConfig({ OIDC_PROTECT_FILES: true, OIDC_PROTECT_NOTES: false }));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
