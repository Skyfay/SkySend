import { useState, useEffect, useCallback } from "react";
import { fetchAuthSession, type OidcUser } from "@/lib/api";
import type { ServerConfig } from "@/lib/api";

export interface UseAuthResult {
  user: OidcUser | null;
  isLoggedIn: boolean;
  loading: boolean;
  logout: () => void;
}

/**
 * Provides the current OIDC session state.
 *
 * When `config.oidcEnabled` is false this hook returns the idle state
 * immediately without making any network request.
 */
export function useAuth(config: ServerConfig | null): UseAuthResult {
  const [user, setUser] = useState<OidcUser | null>(null);
  const [done, setDone] = useState(false);

  const oidcEnabled = config?.oidcEnabled ?? false;
  const loading = oidcEnabled && !done;

  useEffect(() => {
    if (!oidcEnabled) return;
    fetchAuthSession()
      .then(setUser)
      .finally(() => setDone(true));
  }, [oidcEnabled]);

  const logout = useCallback(() => {
    window.location.href = "/auth/logout";
  }, []);

  return {
    user,
    isLoggedIn: user !== null,
    loading,
    logout,
  };
}
