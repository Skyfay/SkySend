import { describe, it, expect } from "vitest";
import { genericAdapter } from "../src/auth/adapters/generic.js";
import { pocketIdAdapter } from "../src/auth/adapters/pocketid.js";
import { authentikAdapter } from "../src/auth/adapters/authentik.js";
import { keycloakAdapter } from "../src/auth/adapters/keycloak.js";

// ── Helper ────────────────────────────────────────────────────────────────────

/** Minimal required scopes every adapter must request. */
const REQUIRED_SCOPES = ["openid", "profile", "email"];

// ── Generic adapter ───────────────────────────────────────────────────────────

describe("genericAdapter", () => {
  it("has all required scopes", () => {
    for (const scope of REQUIRED_SCOPES) {
      expect(genericAdapter.scopes).toContain(scope);
    }
  });

  it("extractUser: returns correct OidcUser from complete claims", () => {
    const user = genericAdapter.extractUser({
      sub: "u1",
      name: "Grace Hopper",
      email: "grace@example.com",
    });
    expect(user).toEqual({ sub: "u1", name: "Grace Hopper", email: "grace@example.com" });
  });

  it("extractUser: falls back to preferred_username when name is missing", () => {
    const user = genericAdapter.extractUser({
      sub: "u1",
      preferred_username: "grace_h",
      email: "grace@example.com",
    });
    expect(user.name).toBe("grace_h");
  });

  it("extractUser: falls back to sub when name and preferred_username are missing", () => {
    const user = genericAdapter.extractUser({ sub: "u1", email: "grace@example.com" });
    expect(user.name).toBe("u1");
  });

  it("extractUser: email defaults to empty string when absent", () => {
    const user = genericAdapter.extractUser({ sub: "u1", name: "Grace" });
    expect(user.email).toBe("");
  });

  it("extractUser: sub is always the raw sub claim", () => {
    const user = genericAdapter.extractUser({ sub: "stable-id", name: "X", email: "" });
    expect(user.sub).toBe("stable-id");
  });
});

// ── PocketID adapter ──────────────────────────────────────────────────────────

describe("pocketIdAdapter", () => {
  it("has all required scopes", () => {
    for (const scope of REQUIRED_SCOPES) {
      expect(pocketIdAdapter.scopes).toContain(scope);
    }
  });

  it("extractUser: prefers preferred_username as display name", () => {
    const user = pocketIdAdapter.extractUser({
      sub: "u2",
      preferred_username: "ada_lv",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(user.name).toBe("ada_lv");
  });

  it("extractUser: falls back to name when preferred_username is missing", () => {
    const user = pocketIdAdapter.extractUser({
      sub: "u2",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(user.name).toBe("Ada Lovelace");
  });

  it("extractUser: falls back to sub when both name fields are missing", () => {
    const user = pocketIdAdapter.extractUser({ sub: "u2", email: "ada@example.com" });
    expect(user.name).toBe("u2");
  });

  it("extractUser: email defaults to empty string when absent", () => {
    const user = pocketIdAdapter.extractUser({ sub: "u2", preferred_username: "ada_lv" });
    expect(user.email).toBe("");
  });
});

// ── Authentik adapter ─────────────────────────────────────────────────────────

describe("authentikAdapter", () => {
  it("has all required scopes", () => {
    for (const scope of REQUIRED_SCOPES) {
      expect(authentikAdapter.scopes).toContain(scope);
    }
  });

  it("extractUser: prefers name claim", () => {
    const user = authentikAdapter.extractUser({
      sub: "u3",
      name: "Alan Turing",
      preferred_username: "aturing",
      email: "alan@example.com",
    });
    expect(user.name).toBe("Alan Turing");
  });

  it("extractUser: falls back to preferred_username when name is missing", () => {
    const user = authentikAdapter.extractUser({
      sub: "u3",
      preferred_username: "aturing",
      email: "alan@example.com",
    });
    expect(user.name).toBe("aturing");
  });

  it("extractUser: falls back to sub when both name fields are missing", () => {
    const user = authentikAdapter.extractUser({ sub: "u3", email: "alan@example.com" });
    expect(user.name).toBe("u3");
  });

  it("extractUser: email defaults to empty string when absent", () => {
    const user = authentikAdapter.extractUser({ sub: "u3", name: "Alan" });
    expect(user.email).toBe("");
  });
});

// ── Keycloak adapter ──────────────────────────────────────────────────────────

describe("keycloakAdapter", () => {
  it("has all required scopes", () => {
    for (const scope of REQUIRED_SCOPES) {
      expect(keycloakAdapter.scopes).toContain(scope);
    }
  });

  it("extractUser: prefers preferred_username as display name", () => {
    const user = keycloakAdapter.extractUser({
      sub: "u4",
      preferred_username: "linus_t",
      name: "Linus Torvalds",
      email: "linus@example.com",
    });
    expect(user.name).toBe("linus_t");
  });

  it("extractUser: falls back to name when preferred_username is missing", () => {
    const user = keycloakAdapter.extractUser({
      sub: "u4",
      name: "Linus Torvalds",
      email: "linus@example.com",
    });
    expect(user.name).toBe("Linus Torvalds");
  });

  it("extractUser: falls back to sub when both name fields are missing", () => {
    const user = keycloakAdapter.extractUser({ sub: "u4", email: "linus@example.com" });
    expect(user.name).toBe("u4");
  });

  it("extractUser: email defaults to empty string when absent", () => {
    const user = keycloakAdapter.extractUser({ sub: "u4", preferred_username: "linus_t" });
    expect(user.email).toBe("");
  });
});
