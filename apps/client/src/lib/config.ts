import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n", "utf-8");
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

// WebSocket uploads are globally disabled.
// Large file transfers via WebSocket over HTTPS connections fail mid-transfer
// due to an unresolved issue. HTTP chunked upload is used instead until a
// proper fix is in place. Do not re-enable this without resolving the root cause.
export function getWebSocket(_serverUrl?: string): boolean {
  return false;
}

// setWebSocket is intentionally a no-op while WebSocket uploads are globally
// disabled. The per-server preference is not persisted so the stored config
// cannot accidentally re-enable WebSocket after the lock is lifted.
export function setWebSocket(_serverUrl: string, _enabled: boolean): void {
  // no-op - see getWebSocket comment above
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
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const tokensPath = getTokensPath();
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
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
