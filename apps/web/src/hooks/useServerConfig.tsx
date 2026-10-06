import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchConfig, type ServerConfig } from "@/lib/api";
import { accentCss, deriveAccent } from "@/lib/accent";

interface ServerConfigContextValue {
  config: ServerConfig | null;
  loading: boolean;
  error: string | null;
}

const ServerConfigContext = createContext<ServerConfigContextValue>({
  config: null,
  loading: true,
  error: null,
});

export function ServerConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchConfig()
      .then((cfg) => {
        if (!cancelled) {
          setConfig(cfg);
          setLoading(false);

          // The theme and the default color scheme need nothing here: the server writes
          // both into index.html, and public/theme-init.js applies them before the first paint.

          // Derive every accent shade from the custom color. Without one, index.css
          // already carries the shades of SkySend green.
          if (cfg.customColor) {
            const style = document.createElement("style");
            style.textContent = accentCss(deriveAccent(cfg.customColor));
            document.head.appendChild(style);
          }

          // Apply custom logo as favicon
          if (cfg.customLogo) {
            const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
            if (link) link.href = cfg.customLogo;
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load config");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ServerConfigContext.Provider value={{ config, loading, error }}>
      {children}
    </ServerConfigContext.Provider>
  );
}

export function useServerConfig() {
  return useContext(ServerConfigContext);
}
