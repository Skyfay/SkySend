import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

interface ClientConfig {
  server?: string;
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
 * 3. Saved config
 */
export function resolveServer(flagValue?: string): string {
  if (flagValue) return flagValue.replace(/\/+$/, "");

  const env = process.env["SKYSEND_SERVER"];
  if (env) return env.replace(/\/+$/, "");

  const config = loadConfig();
  if (config.server) return config.server;

  throw new Error(
    "No server configured. Use --server <url>, set SKYSEND_SERVER, or run: skysend config set-server <url>",
  );
}

export function getConfigFilePath(): string {
  return getConfigPath();
}
