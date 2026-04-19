import type { ServerConfig, QuotaStatus } from "../lib/api.js";

export type View =
  | "server-select"
  | "menu"
  | "upload"
  | "download"
  | "note-create"
  | "note-view"
  | "my-uploads"
  | "settings";

export interface AppState {
  server: string;
  serverName: string;
  config: ServerConfig;
  quota?: QuotaStatus;
}
