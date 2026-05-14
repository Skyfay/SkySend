import type { OidcAdapterProfile, OidcUser } from "../types.js";

/**
 * Keycloak adapter.
 * Keycloak is fully OIDC-compliant. `preferred_username` is the Keycloak login
 * name and is always present. `name` is the full display name (requires the
 * user profile to have first/last name set). We prefer `preferred_username` as
 * the primary display name since it is guaranteed to exist, with `name` as
 * fallback.
 *
 * Issuer URL format: https://<keycloak-host>/realms/<realm-name>
 * See: https://www.keycloak.org/docs/latest/securing_apps/index.html#_oidc
 */
export const keycloakAdapter: OidcAdapterProfile = {
  name: "keycloak",
  scopes: ["openid", "profile", "email"],
  claimsMap: { name: "preferred_username", email: "email" },

  extractUser(claims: Record<string, unknown>): OidcUser {
    const sub = String(claims["sub"] ?? "");
    const name = String(
      claims["preferred_username"] ?? claims["name"] ?? claims["sub"] ?? "",
    );
    const email = String(claims["email"] ?? "");
    return { sub, name, email };
  },
};
