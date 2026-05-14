import type { OidcAdapterProfile, OidcUser } from "../types.js";

/**
 * Generic adapter - compatible with any OIDC-compliant provider.
 * Uses standard claim names defined in OpenID Connect Core 1.0.
 */
export const genericAdapter: OidcAdapterProfile = {
  name: "generic",
  claimsMap: { name: "name", email: "email" },

  extractUser(claims: Record<string, unknown>): OidcUser {
    const sub = String(claims["sub"] ?? "");
    const name =
      String(claims[this.claimsMap.name] ?? claims["preferred_username"] ?? claims["sub"] ?? "");
    const email = String(claims[this.claimsMap.email] ?? "");
    return { sub, name, email };
  },
};
