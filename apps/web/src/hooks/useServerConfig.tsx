import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchConfig, type ServerConfig } from "@/lib/api";

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
