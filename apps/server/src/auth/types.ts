/**
 * Represents a logged-in OIDC user extracted from the ID token / userinfo claims.
 */
export interface OidcUser {
  /** Subject identifier (stable, unique per user at the provider). */
  sub: string;
  /** Display name. */
  name: string;
  /** Email address (may be empty string if not provided by the provider). */
  email: string;
}

/**
 * Provider-specific adapter profile that adjusts claim mappings and scopes.
 */
export interface OidcAdapterProfile {
  /** Human-readable name for log output. */
  readonly name: string;
  /**
   * Maps standard field names to the actual claim keys returned by this provider.
   * Falls back to the key itself when the resolved claim is absent.
   */
  readonly claimsMap: {
    /** Claim key used for the display name. */
    name: string;
    /** Claim key used for the email address. */
    email: string;
  };
  /**
   * Optional hook called once at startup to validate provider-specific config.
   * Throw an Error to abort startup with a descriptive message.
   */
  validateConfig?(): void;
  /**
   * Extract an OidcUser from the raw ID-token / userinfo claims object.
   * Override per adapter when claim resolution needs custom logic.
   */
  extractUser(claims: Record<string, unknown>): OidcUser;
}
