import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// We need to test the config module in isolation with controlled env vars.
// Since loadConfig caches its result, we re-import fresh each test.

describe("config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Vitest/Vite injects BASE_URL="/", which conflicts with our config's BASE_URL (a full URL).
    // Set a valid BASE_URL for all tests since it's required.
    process.env.BASE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function loadFreshConfig() {
    const mod = await import("../src/lib/config.js");
    return mod.loadConfig();
  }

  describe("defaults", () => {
    it("should load with all defaults when no env vars set", async () => {
      const config = await loadFreshConfig();
      expect(config.PORT).toBe(3000);
      expect(config.HOST).toBe("0.0.0.0");
      expect(config.BASE_URL).toBe("http://localhost:3000");
      expect(config.DATA_DIR).toBe("./data");
      expect(config.FILE_MAX_SIZE).toBe(2 * 1024 ** 3);
      expect(config.FILE_EXPIRE_OPTIONS_SEC).toEqual([300, 3600, 86400, 604800]);
      expect(config.FILE_DEFAULT_EXPIRE_SEC).toBe(86400);
      expect(config.FILE_DOWNLOAD_OPTIONS).toEqual([1, 2, 3, 4, 5, 10, 20, 50, 100]);
      expect(config.FILE_DEFAULT_DOWNLOAD).toBe(1);
      expect(config.CLEANUP_INTERVAL).toBe(60);
      expect(config.CUSTOM_TITLE).toBe("SkySend");
      expect(config.RATE_LIMIT_WINDOW).toBe(60000);
      expect(config.RATE_LIMIT_MAX).toBe(60);
      expect(config.FILE_UPLOAD_QUOTA_BYTES).toBe(0);
      expect(config.FILE_UPLOAD_QUOTA_WINDOW).toBe(86400);
      expect(config.FILE_MAX_FILES_PER_UPLOAD).toBe(32);
      expect(config.NOTE_MAX_SIZE).toBe(1024 ** 2);
      expect(config.NOTE_EXPIRE_OPTIONS_SEC).toEqual([300, 3600, 86400, 604800]);
      expect(config.NOTE_DEFAULT_EXPIRE_SEC).toBe(86400);
      expect(config.NOTE_VIEW_OPTIONS).toEqual([0, 1, 2, 3, 5, 10, 20, 50, 100]);
      expect(config.NOTE_DEFAULT_VIEWS).toBe(0);
      expect(config.ENABLED_SERVICES).toEqual(["file", "note"]);
      expect(config.FILE_UPLOAD_WS).toBe(true);
      expect(config.FILE_UPLOAD_WS_MAX_BUFFER).toBe(16 * 1024 * 1024);
    });
  });

  describe("custom values", () => {
    it("should parse PORT", async () => {
      process.env.PORT = "8080";
      const config = await loadFreshConfig();
      expect(config.PORT).toBe(8080);
    });

    it("should parse BASE_URL and strip trailing slash", async () => {
      process.env.BASE_URL = "https://send.example.com/";
      const config = await loadFreshConfig();
      expect(config.BASE_URL).toBe("https://send.example.com");
    });

    it("should parse FILE_MAX_SIZE with units", async () => {
      process.env.FILE_MAX_SIZE = "500MB";
      const config = await loadFreshConfig();
      expect(config.FILE_MAX_SIZE).toBe(500 * 1024 ** 2);
    });

    it("should parse FILE_MAX_SIZE in GB", async () => {
      process.env.FILE_MAX_SIZE = "1GB";
      const config = await loadFreshConfig();
      expect(config.FILE_MAX_SIZE).toBe(1024 ** 3);
    });

    it("should parse comma-separated FILE_EXPIRE_OPTIONS_SEC", async () => {
      process.env.FILE_EXPIRE_OPTIONS_SEC = "60,3600,86400";
      const config = await loadFreshConfig();
      expect(config.FILE_EXPIRE_OPTIONS_SEC).toEqual([60, 3600, 86400]);
    });

    it("should parse comma-separated FILE_DOWNLOAD_OPTIONS", async () => {
      process.env.FILE_DOWNLOAD_OPTIONS = "1,5,10";
      const config = await loadFreshConfig();
      expect(config.FILE_DOWNLOAD_OPTIONS).toEqual([1, 5, 10]);
    });

    it("should parse FILE_UPLOAD_QUOTA_BYTES as number string", async () => {
      process.env.FILE_UPLOAD_QUOTA_BYTES = "1073741824";
      const config = await loadFreshConfig();
      expect(config.FILE_UPLOAD_QUOTA_BYTES).toBe(1073741824);
    });

    it("should parse FILE_UPLOAD_QUOTA_BYTES with unit", async () => {
      process.env.FILE_UPLOAD_QUOTA_BYTES = "5GB";
      const config = await loadFreshConfig();
      expect(config.FILE_UPLOAD_QUOTA_BYTES).toBe(5 * 1024 ** 3);
    });

    it("should parse CUSTOM_TITLE", async () => {
      process.env.CUSTOM_TITLE = "MyShare";
      const config = await loadFreshConfig();
      expect(config.CUSTOM_TITLE).toBe("MyShare");
    });

    it("should parse ENABLED_SERVICES with only file", async () => {
      process.env.ENABLED_SERVICES = "file";
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["file"]);
    });

    it("should parse ENABLED_SERVICES with only note", async () => {
      process.env.ENABLED_SERVICES = "note";
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["note"]);
    });

    it("should ignore invalid values in ENABLED_SERVICES", async () => {
      process.env.ENABLED_SERVICES = "file,invalid,note";
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["file", "note"]);
    });
  });

  describe("validation errors", () => {
    it("should reject invalid PORT", async () => {
      process.env.PORT = "99999";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject PORT = 0", async () => {
      process.env.PORT = "0";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject non-numeric PORT", async () => {
      process.env.PORT = "abc";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject invalid BASE_URL", async () => {
      process.env.BASE_URL = "not-a-url";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject missing BASE_URL", async () => {
      delete process.env.BASE_URL;
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject invalid FILE_MAX_SIZE unit", async () => {
      process.env.FILE_MAX_SIZE = "500TB";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject non-numeric FILE_EXPIRE_OPTIONS_SEC", async () => {
      process.env.FILE_EXPIRE_OPTIONS_SEC = "abc,def";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject negative FILE_DEFAULT_EXPIRE_SEC", async () => {
      process.env.FILE_DEFAULT_EXPIRE_SEC = "-1";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject FILE_DEFAULT_EXPIRE_SEC not in FILE_EXPIRE_OPTIONS_SEC", async () => {
      process.env.FILE_EXPIRE_OPTIONS_SEC = "300,3600";
      process.env.FILE_DEFAULT_EXPIRE_SEC = "86400";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of FILE_EXPIRE_OPTIONS_SEC");
    });

    it("should reject FILE_DEFAULT_DOWNLOAD not in FILE_DOWNLOAD_OPTIONS", async () => {
      process.env.FILE_DOWNLOAD_OPTIONS = "5,10";
      process.env.FILE_DEFAULT_DOWNLOAD = "1";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of FILE_DOWNLOAD_OPTIONS");
    });

    it("should reject NOTE_DEFAULT_EXPIRE_SEC not in NOTE_EXPIRE_OPTIONS_SEC", async () => {
      process.env.NOTE_EXPIRE_OPTIONS_SEC = "300,3600";
      process.env.NOTE_DEFAULT_EXPIRE_SEC = "86400";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of NOTE_EXPIRE_OPTIONS_SEC");
    });

    it("should reject NOTE_DEFAULT_VIEWS not in NOTE_VIEW_OPTIONS", async () => {
      process.env.NOTE_VIEW_OPTIONS = "5,10";
      process.env.NOTE_DEFAULT_VIEWS = "1";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of NOTE_VIEW_OPTIONS");
    });

    it("should treat empty ENABLED_SERVICES as default (both enabled)", async () => {
      process.env.ENABLED_SERVICES = "";
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["file", "note"]);
    });

    it("should reject ENABLED_SERVICES with only invalid values", async () => {
      process.env.ENABLED_SERVICES = "invalid,unknown";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should skip file cross-validation when file service is disabled", async () => {
      process.env.ENABLED_SERVICES = "note";
      process.env.FILE_EXPIRE_OPTIONS_SEC = "300,3600";
      process.env.FILE_DEFAULT_EXPIRE_SEC = "86400"; // Not in options - would normally fail
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["note"]);
    });

    it("should skip note cross-validation when note service is disabled", async () => {
      process.env.ENABLED_SERVICES = "file";
      process.env.NOTE_EXPIRE_OPTIONS_SEC = "300,3600";
      process.env.NOTE_DEFAULT_EXPIRE_SEC = "86400"; // Not in options - would normally fail
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["file"]);
    });
  });

  describe("getConfig", () => {
    it("should throw if loadConfig was not called", async () => {
      const mod = await import("../src/lib/config.js");
      expect(() => mod.getConfig()).toThrow("Config not loaded");
    });
  });
});
