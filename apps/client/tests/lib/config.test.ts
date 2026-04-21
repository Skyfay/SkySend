import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Each test gets its own isolated temp directory set via XDG_CONFIG_HOME.
 * We also use vi.resetModules() so config state doesn't leak between tests.
 */
let tempDir: string;

async function freshConfig() {
  vi.resetModules();
  return import("../../src/lib/config.js");
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "skysend-config-test-"));
  process.env["XDG_CONFIG_HOME"] = tempDir;
});

afterEach(() => {
  delete process.env["XDG_CONFIG_HOME"];
  delete process.env["SKYSEND_SERVER"];
  rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

// ── loadConfig / saveConfig ───────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns empty object when no config file exists", async () => {
    const { loadConfig } = await freshConfig();
    expect(loadConfig()).toEqual({});
  });

  it("returns empty object for corrupt JSON (recovery)", async () => {
    const { loadConfig, getConfigFilePath, saveConfig } = await freshConfig();
    // Create a valid config first to ensure the dir exists
    saveConfig({ server: "https://example.com" });
    // Overwrite with corrupt JSON
    const { writeFileSync } = await import("node:fs");
    writeFileSync(getConfigFilePath(), "not { valid json", "utf-8");
    expect(loadConfig()).toEqual({});
  });
});

describe("saveConfig / loadConfig roundtrip", () => {
  it("persists and restores a simple server value", async () => {
    const { loadConfig, saveConfig } = await freshConfig();
    saveConfig({ server: "https://send.example.com" });
    expect(loadConfig()).toMatchObject({ server: "https://send.example.com" });
  });

  it("creates the config directory if it does not exist", async () => {
    const { saveConfig, getConfigFilePath } = await freshConfig();
    saveConfig({ server: "https://send.example.com" });
    const { existsSync } = await import("node:fs");
    expect(existsSync(getConfigFilePath())).toBe(true);
  });
});

// ── resolveServer ─────────────────────────────────────────────────────────────

describe("resolveServer", () => {
  it("returns the flag value when provided, stripping trailing slashes", async () => {
    const { resolveServer } = await freshConfig();
    expect(resolveServer("https://flag.example.com/")).toBe("https://flag.example.com");
    expect(resolveServer("https://flag.example.com///")).toBe("https://flag.example.com");
  });

  it("returns the SKYSEND_SERVER env variable when no flag is set", async () => {
    process.env["SKYSEND_SERVER"] = "https://env.example.com/";
    const { resolveServer } = await freshConfig();
    expect(resolveServer()).toBe("https://env.example.com");
  });

  it("flag takes priority over env variable", async () => {
    process.env["SKYSEND_SERVER"] = "https://env.example.com";
    const { resolveServer } = await freshConfig();
    expect(resolveServer("https://flag.example.com")).toBe("https://flag.example.com");
  });

  it("falls back to saved config server", async () => {
    const { resolveServer, saveConfig } = await freshConfig();
    saveConfig({ server: "https://config.example.com" });
    expect(resolveServer()).toBe("https://config.example.com");
  });

  it("throws when no server is configured at all", async () => {
    const { resolveServer } = await freshConfig();
    expect(() => resolveServer()).toThrow("No server configured");
  });
});

// ── Multi-Server Management ───────────────────────────────────────────────────

describe("addServer", () => {
  it("adds a new server entry", async () => {
    const { addServer, getServers } = await freshConfig();
    addServer("My Server", "https://send.example.com");
    const servers = getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "My Server", url: "https://send.example.com" });
  });

  it("strips trailing slashes from the server URL", async () => {
    const { addServer, getServers } = await freshConfig();
    addServer("My Server", "https://send.example.com/");
    expect(getServers()[0]?.url).toBe("https://send.example.com");
  });

  it("sets the first added server as the default", async () => {
    const { addServer, getDefaultServer } = await freshConfig();
    addServer("First", "https://first.example.com");
    expect(getDefaultServer()).toBe("https://first.example.com");
  });

  it("does not change default when a second server is added", async () => {
    const { addServer, getDefaultServer } = await freshConfig();
    addServer("First", "https://first.example.com");
    addServer("Second", "https://second.example.com");
    expect(getDefaultServer()).toBe("https://first.example.com");
  });

  it("throws when adding a duplicate server URL", async () => {
    const { addServer } = await freshConfig();
    addServer("My Server", "https://send.example.com");
    expect(() => addServer("Duplicate", "https://send.example.com")).toThrow(
      "Server already exists",
    );
  });
});

describe("removeServer", () => {
  it("removes a server by URL", async () => {
    const { addServer, removeServer, getServers } = await freshConfig();
    addServer("A", "https://a.example.com");
    addServer("B", "https://b.example.com");
    removeServer("https://a.example.com");
    const servers = getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]?.url).toBe("https://b.example.com");
  });

  it("reassigns default to remaining server when the default is removed", async () => {
    const { addServer, removeServer, getDefaultServer } = await freshConfig();
    addServer("A", "https://a.example.com");
    addServer("B", "https://b.example.com");
    removeServer("https://a.example.com");
    expect(getDefaultServer()).toBe("https://b.example.com");
  });

  it("does nothing when removing a URL that does not exist", async () => {
    const { addServer, removeServer, getServers } = await freshConfig();
    addServer("A", "https://a.example.com");
    removeServer("https://nonexistent.example.com");
    expect(getServers()).toHaveLength(1);
  });
});

// ── getWebSocket / setWebSocket ───────────────────────────────────────────────

describe("WebSocket preference", () => {
  it("defaults to true when no preference is saved", async () => {
    const { addServer, getWebSocket } = await freshConfig();
    addServer("A", "https://a.example.com");
    expect(getWebSocket("https://a.example.com")).toBe(true);
  });

  it("persists WebSocket setting per server", async () => {
    const { addServer, setWebSocket, getWebSocket } = await freshConfig();
    addServer("A", "https://a.example.com");
    setWebSocket("https://a.example.com", false);
    expect(getWebSocket("https://a.example.com")).toBe(false);
  });

  it("does not affect other servers", async () => {
    const { addServer, setWebSocket, getWebSocket } = await freshConfig();
    addServer("A", "https://a.example.com");
    addServer("B", "https://b.example.com");
    setWebSocket("https://a.example.com", false);
    expect(getWebSocket("https://b.example.com")).toBe(true);
  });
});

// ── Legacy migration ──────────────────────────────────────────────────────────

describe("legacy single-server config migration", () => {
  it("migrates a legacy 'server' key to the servers array on first getServers() call", async () => {
    const { saveConfig, getServers } = await freshConfig();
    // Manually write a legacy config
    saveConfig({ server: "https://legacy.example.com" });
    const servers = getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "Default", url: "https://legacy.example.com" });
  });
});
