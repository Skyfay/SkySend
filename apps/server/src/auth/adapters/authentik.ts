import type { OidcAdapterProfile, OidcUser } from "../types.js";

/**
 * Authentik adapter.
 * Authentik is fully OIDC-compliant and exposes standard claims.
 * The `name` claim is the full display name; `preferred_username` is the login name.
 * See: https://docs.goauthentik.io/docs/providers/oauth2/
 */
export const authentikAdapter: OidcAdapterProfile = {
  name: "authentik",
  scopes: ["openid", "profile", "email"],
  claimsMap: { name: "name", email: "email" },

  extractUser(claims: Record<string, unknown>): OidcUser {
    const sub = String(claims["sub"] ?? "");
    const name = String(
      claims["name"] ?? claims["preferred_username"] ?? claims["sub"] ?? "",
    );
    const email = String(claims["email"] ?? "");
    return { sub, name, email };
  },
};
