import type { ServerConfig, QuotaStatus } from "../lib/api.js";

/** The tabs of the TUI, in the order of the bar at the top. */
export type TabId = "send" | "receive" | "note" | "links" | "settings";

export interface AppState {
  server: string;
  serverName: string;
  config: ServerConfig;
  quota?: QuotaStatus;
}
