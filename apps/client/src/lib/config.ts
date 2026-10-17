import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { writePrivateFile } from "./private-file.js";

export interface ServerEntry {
  name: string;
  url: string;
  websocket?: boolean;
}

interface ClientConfig {
  server?: string;
  servers?: ServerEntry[];
  defaultServer?: string;
}

function getConfigDir(): string {
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = xdg || path.join(os.homedir(), ".config");
  return path.join(base, "skysend");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadConfig(): ClientConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ClientConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: ClientConfig): void {
  writePrivateFile(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

export function resetConfig(): void {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Resolve the server URL with priority:
 * 1. --server CLI flag
 * 2. SKYSEND_SERVER env variable
 * 3. defaultServer from multi-server config
 * 4. Legacy top-level server field
 */
export function resolveServer(flagValue?: string): string {
  if (flagValue) return flagValue.replace(/\/+$/, "");

  const env = process.env["SKYSEND_SERVER"];
  if (env) return env.replace(/\/+$/, "");

  const config = loadConfig();
  if (config.defaultServer) return config.defaultServer;
  if (config.server) return config.server;

  throw new Error(
    "No server configured. Use --server <url>, set SKYSEND_SERVER, or run: skysend config set-server <url>",
  );
}

export function getConfigFilePath(): string {
  return getConfigPath();
}

// ── Multi-Server Management ────────────────────────────

export function getServers(): ServerEntry[] {
  const config = loadConfig();
  const servers = config.servers ?? [];
  // Migrate legacy single-server config
  if (servers.length === 0 && config.server) {
    const entry: ServerEntry = { name: "Default", url: config.server };
    servers.push(entry);
    saveConfig({ ...config, servers, defaultServer: config.server });
  }
  return servers;
}

export function addServer(name: string, url: string): void {
  const config = loadConfig();
  const servers = config.servers ?? [];
  const normalized = url.replace(/\/+$/, "");
  if (servers.some((s) => s.url === normalized)) {
    throw new Error(`Server already exists: ${normalized}`);
  }
  servers.push({ name, url: normalized });
  const updates: ClientConfig = { ...config, servers };
  if (!updates.defaultServer) updates.defaultServer = normalized;
  saveConfig(updates);
}

export function removeServer(url: string): void {
  const config = loadConfig();
  const servers = (config.servers ?? []).filter((s) => s.url !== url);
  const updates: ClientConfig = { ...config, servers };
  if (config.defaultServer === url) {
    updates.defaultServer = servers[0]?.url;
  }
  saveConfig(updates);
}

export function setDefaultServer(url: string): void {
  const config = loadConfig();
  saveConfig({ ...config, defaultServer: url.replace(/\/+$/, "") });
}

export function getDefaultServer(): string | undefined {
  const config = loadConfig();
  return config.defaultServer ?? config.server;
}

/**
 * Whether uploads to a server may take the WebSocket, on unless switched off for that server.
 * The server still has to offer it (`fileUploadWs`), and a failed handshake falls back to HTTP.
 */
export function getWebSocket(serverUrl?: string): boolean {
  const config = loadConfig();
  if (serverUrl) {
    const entry = (config.servers ?? []).find((s) => s.url === serverUrl);
    if (entry && entry.websocket !== undefined) return entry.websocket;
  }
  return true;
}

export function setWebSocket(serverUrl: string, enabled: boolean): void {
  const config = loadConfig();
  const servers = config.servers ?? [];
  const entry = servers.find((s) => s.url === serverUrl);
  if (entry) {
    entry.websocket = enabled;
    saveConfig({ ...config, servers });
  }
}

// ── OIDC Token Storage ─────────────────────────────────

function getTokensPath(): string {
  return path.join(getConfigDir(), "tokens.json");
}

function loadTokens(): Record<string, string> {
  const tokensPath = getTokensPath();
  if (!fs.existsSync(tokensPath)) return {};
  try {
    const raw = fs.readFileSync(tokensPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeTokens(tokens: Record<string, string>): void {
  writePrivateFile(getTokensPath(), JSON.stringify(tokens, null, 2) + "\n");
}

export function getStoredToken(serverUrl: string): string | undefined {
  const tokens = loadTokens();
  return tokens[serverUrl.replace(/\/+$/, "")];
}

export function saveStoredToken(serverUrl: string, token: string): void {
  const tokens = loadTokens();
  tokens[serverUrl.replace(/\/+$/, "")] = token;
  writeTokens(tokens);
}

export function clearStoredToken(serverUrl: string): void {
  const tokens = loadTokens();
  delete tokens[serverUrl.replace(/\/+$/, "")];
  writeTokens(tokens);
}
