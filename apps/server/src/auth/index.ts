import type { Config } from "../lib/config.js";
import type { OidcAdapterProfile } from "./types.js";
import { genericAdapter } from "./adapters/generic.js";
import { pocketIdAdapter } from "./adapters/pocketid.js";
import { authentikAdapter } from "./adapters/authentik.js";

export type { OidcAdapterProfile, OidcUser } from "./types.js";

const ADAPTERS: Record<string, OidcAdapterProfile> = {
  generic: genericAdapter,
  pocketid: pocketIdAdapter,
  authentik: authentikAdapter,
};

/**
 * Resolve the configured OIDC adapter, run its optional startup check, and return it.
 * Logs the selected adapter name for operator visibility.
 */
export function createOidcAdapter(config: Config): OidcAdapterProfile {
  const key = config.OIDC_PROVIDER;
  const adapter = ADAPTERS[key] ?? genericAdapter;
  adapter.validateConfig?.();
  console.log(`[oidc] OIDC enabled - using "${adapter.name}" adapter`);
  console.log(`[oidc] Issuer: ${config.OIDC_ISSUER}`);
  if (!config.OIDC_PROTECT_FILES && !config.OIDC_PROTECT_NOTES) {
    console.warn("[oidc] WARNING: No upload routes are protected (both OIDC_PROTECT_FILES and OIDC_PROTECT_NOTES are false).");
  }
  return adapter;
}
