import type { OidcAdapterProfile, OidcUser } from "../types.js";

/**
 * PocketID adapter.
 * PocketID uses `preferred_username` as the primary display name claim.
 * Falls back to `name` and then to `sub` if neither is present.
 * See: https://pocketid.app/docs
 */
export const pocketIdAdapter: OidcAdapterProfile = {
  name: "pocketid",
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
