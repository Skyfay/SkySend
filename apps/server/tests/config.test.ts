import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

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
      expect(config.ENABLED_SERVICES).toEqual(["file", "note", "request"]);
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

    it("should treat empty ENABLED_SERVICES as default (all enabled)", async () => {
      process.env.ENABLED_SERVICES = "";
      const config = await loadFreshConfig();
      expect(config.ENABLED_SERVICES).toEqual(["file", "note", "request"]);
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

    it("should return the loaded config after loadConfig() succeeds", async () => {
      const mod = await import("../src/lib/config.js");
      const loaded = mod.loadConfig();
      expect(mod.getConfig()).toBe(loaded);
    });
  });

  describe("CUSTOM_LOGO", () => {
    it("should accept an absolute path starting with /", async () => {
      process.env.CUSTOM_LOGO = "/branding/logo.svg";
      const config = await loadFreshConfig();
      expect(config.CUSTOM_LOGO).toBe("/branding/logo.svg");
    });

    it("should accept an https URL", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CUSTOM_LOGO = "https://example.com/logo.svg";
      const config = await loadFreshConfig();
      expect(config.CUSTOM_LOGO).toBe("https://example.com/logo.svg");
      warn.mockRestore();
    });

    it("should warn about an external logo host", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CUSTOM_LOGO = "https://cdn.example.com/logo.svg";
      await loadFreshConfig();

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("https://cdn.example.com");
      expect(warn.mock.calls[0]?.[0]).toContain("CUSTOM_LOGO");
      warn.mockRestore();
    });

    it("should not warn about a local logo path", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CUSTOM_LOGO = "/branding/logo.svg";
      await loadFreshConfig();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("should not warn when no logo is configured", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await loadFreshConfig();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("should reject a protocol-relative URL", async () => {
      process.env.CUSTOM_LOGO = "//evil.example.com/logo.png";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject a relative path", async () => {
      process.env.CUSTOM_LOGO = "logo.svg";
      await expect(loadFreshConfig()).rejects.toThrow();
    });
  });

  describe("CUSTOM_OG_IMAGE", () => {
    it("should default the style to logo and leave the image unset", async () => {
      const config = await loadFreshConfig();
      expect(config.CUSTOM_OG_IMAGE).toBeUndefined();
      expect(config.CUSTOM_OG_IMAGE_STYLE).toBe("logo");
    });

    it("should accept an absolute path and the banner style", async () => {
      process.env.CUSTOM_OG_IMAGE = "/branding/preview.png";
      process.env.CUSTOM_OG_IMAGE_STYLE = "banner";
      const config = await loadFreshConfig();
      expect(config.CUSTOM_OG_IMAGE).toBe("/branding/preview.png");
      expect(config.CUSTOM_OG_IMAGE_STYLE).toBe("banner");
    });

    it("should reject a protocol-relative URL", async () => {
      process.env.CUSTOM_OG_IMAGE = "//evil.example.com/preview.png";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should reject an unknown style", async () => {
      process.env.CUSTOM_OG_IMAGE_STYLE = "large";
      await expect(loadFreshConfig()).rejects.toThrow();
    });

    it("should warn when the preview image is an SVG", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CUSTOM_OG_IMAGE = "/branding/preview.svg";
      await loadFreshConfig();

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("CUSTOM_OG_IMAGE");
      warn.mockRestore();
    });

    it("should not warn about a PNG preview image", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      process.env.CUSTOM_OG_IMAGE = "/branding/preview.png";
      await loadFreshConfig();

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("BRANDING_DIR", () => {
    it("should default to a branding folder inside DATA_DIR", async () => {
      const config = await loadFreshConfig();
      expect(config.BRANDING_DIR).toBe(join("./data", "branding"));
    });

    it("should follow a custom DATA_DIR", async () => {
      process.env.DATA_DIR = "/srv/skysend";
      const config = await loadFreshConfig();
      expect(config.BRANDING_DIR).toBe(join("/srv/skysend", "branding"));
    });

    it("should accept an explicit override", async () => {
      process.env.BRANDING_DIR = "/mnt/assets";
      const config = await loadFreshConfig();
      expect(config.BRANDING_DIR).toBe("/mnt/assets");
    });
  });

  describe("FILE_UPLOAD_SPEED_LIMIT", () => {
    it("should parse a plain integer string (no unit suffix)", async () => {
      process.env.FILE_UPLOAD_SPEED_LIMIT = "2097152";
      const config = await loadFreshConfig();
      expect(config.FILE_UPLOAD_SPEED_LIMIT).toBe(2097152);
    });

    it("should parse a byte-unit string via parseByteSize", async () => {
      process.env.FILE_UPLOAD_SPEED_LIMIT = "5MB";
      const config = await loadFreshConfig();
      expect(config.FILE_UPLOAD_SPEED_LIMIT).toBe(5 * 1024 ** 2);
    });
  });

  describe("DEFAULT_THEME and DEFAULT_COLOR_SCHEME", () => {
    it("should default to the graphite theme and the system color scheme", async () => {
      const config = await loadFreshConfig();
      expect(config.DEFAULT_THEME).toBe("graphite");
      expect(config.DEFAULT_COLOR_SCHEME).toBe("system");
    });

    it("should accept the other themes and color schemes", async () => {
      process.env.DEFAULT_THEME = "graphite";
      process.env.DEFAULT_COLOR_SCHEME = "dark";
      const config = await loadFreshConfig();
      expect(config.DEFAULT_THEME).toBe("graphite");
      expect(config.DEFAULT_COLOR_SCHEME).toBe("dark");
    });

    it("should point a pre-v3 color scheme in DEFAULT_THEME to DEFAULT_COLOR_SCHEME", async () => {
      process.env.DEFAULT_THEME = "dark";
      await expect(loadFreshConfig()).rejects.toThrow("Set DEFAULT_COLOR_SCHEME=dark instead");
    });

    it("should reject an unknown theme", async () => {
      process.env.DEFAULT_THEME = "neon";
      await expect(loadFreshConfig()).rejects.toThrow();
    });
  });

  describe("DEFAULT_TAB", () => {
    it("should default to the file tab", async () => {
      const config = await loadFreshConfig();
      expect(config.DEFAULT_TAB).toBe("file");
    });

    it("should accept the note tab and each block type, including the values from before v3", async () => {
      for (const tab of ["note", "text", "password", "code", "sshkey"]) {
        vi.resetModules();
        process.env.DEFAULT_TAB = tab;
        const config = await loadFreshConfig();
        expect(config.DEFAULT_TAB).toBe(tab);
      }
    });

    it("should reject a tab that does not exist", async () => {
      process.env.DEFAULT_TAB = "markdown";
      await expect(loadFreshConfig()).rejects.toThrow();
    });
  });

  describe("CUSTOM_COLOR", () => {
    it("should keep the value unchanged when # prefix is already present", async () => {
      process.env.CUSTOM_COLOR = "#46c89d";
      const config = await loadFreshConfig();
      expect(config.CUSTOM_COLOR).toBe("#46c89d");
    });
  });

  describe("S3 cross-field validation", () => {
    it("should throw when STORAGE_BACKEND=s3 but required S3 fields are missing", async () => {
      process.env.STORAGE_BACKEND = "s3";
      // S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY intentionally absent
      await expect(loadFreshConfig()).rejects.toThrow("STORAGE_BACKEND=s3 requires");
    });
  });

  describe("OIDC cross-field validation", () => {
    it("should throw when OIDC is only partially configured", async () => {
      process.env.OIDC_ISSUER = "https://provider.example";
      // OIDC_CLIENT_ID and OIDC_CLIENT_SECRET intentionally absent
      await expect(loadFreshConfig()).rejects.toThrow("OIDC is partially configured");
    });

    it("should auto-generate OIDC_SESSION_SECRET and set OIDC_ENABLED when secret is absent", async () => {
      process.env.OIDC_ISSUER = "https://provider.example";
      process.env.OIDC_CLIENT_ID = "client-id";
      process.env.OIDC_CLIENT_SECRET = "client-secret";
      // OIDC_SESSION_SECRET intentionally not set
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const config = await loadFreshConfig();

      expect(config.OIDC_ENABLED).toBe(true);
      expect(config.OIDC_SESSION_SECRET).toBeTruthy();
      expect(config.OIDC_SESSION_SECRET!.length).toBeGreaterThan(32);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("OIDC_SESSION_SECRET is not set"));
      warnSpy.mockRestore();
    });

    it("should throw when OIDC_SESSION_SECRET is shorter than 32 characters", async () => {
      process.env.OIDC_ISSUER = "https://provider.example";
      process.env.OIDC_CLIENT_ID = "client-id";
      process.env.OIDC_CLIENT_SECRET = "client-secret";
      process.env.OIDC_SESSION_SECRET = "short";
      await expect(loadFreshConfig()).rejects.toThrow("OIDC_SESSION_SECRET must be at least 32 characters");
    });

    it("should warn (not throw) when OIDC_ISSUER uses HTTP", async () => {
      process.env.OIDC_ISSUER = "http://provider.example";
      process.env.OIDC_CLIENT_ID = "client-id";
      process.env.OIDC_CLIENT_SECRET = "client-secret";
      process.env.OIDC_SESSION_SECRET = "a-session-secret-that-is-at-least-32-chars!!";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const config = await loadFreshConfig();

      expect(config.OIDC_ENABLED).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("HTTP instead of HTTPS"));
      warnSpy.mockRestore();
    });

    it("should warn but still set OIDC_ENABLED when both protect flags are false", async () => {
      process.env.OIDC_ISSUER = "https://provider.example";
      process.env.OIDC_CLIENT_ID = "client-id";
      process.env.OIDC_CLIENT_SECRET = "client-secret";
      process.env.OIDC_SESSION_SECRET = "a-session-secret-that-is-at-least-32-chars!!";
      process.env.OIDC_PROTECT_FILES = "false";
      process.env.OIDC_PROTECT_NOTES = "false";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const config = await loadFreshConfig();

      expect(config.OIDC_ENABLED).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no upload routes are protected"));
      warnSpy.mockRestore();
    });
  });

  describe("file requests", () => {
    it("should load the defaults", async () => {
      const config = await loadFreshConfig();
      expect(config.FILE_REQUEST_EXPIRE_OPTIONS_SEC).toEqual([86400, 259200, 604800]);
      expect(config.FILE_REQUEST_DEFAULT_EXPIRE_SEC).toBe(259200);
      expect(config.FILE_REQUEST_UPLOAD_OPTIONS).toEqual([1, 2, 3, 5, 10, 20, 50, 100]);
      expect(config.FILE_REQUEST_DEFAULT_UPLOADS).toBe(10);
      expect(config.FILE_REQUEST_MAX_SIZE).toBe(config.FILE_MAX_SIZE);
      expect(config.FILE_REQUEST_RETENTION_SEC).toBe(604800);
      expect(config.FILE_REQUEST_DOWNLOAD_OPTIONS).toEqual([1, 2, 3, 5, 10, 20]);
      expect(config.FILE_REQUEST_DEFAULT_DOWNLOADS).toBe(5);
      expect(config.FILE_REQUEST_DAILY_LIMIT).toBe(100);
      expect(config.FORCE_REQUEST_PASSWORD).toBe(false);
    });

    it("should parse FILE_REQUEST_MAX_SIZE with units", async () => {
      process.env.FILE_REQUEST_MAX_SIZE = "1GB";
      const config = await loadFreshConfig();
      expect(config.FILE_REQUEST_MAX_SIZE).toBe(1024 ** 3);
    });

    it("should refuse a duration that would not make a valid date", async () => {
      process.env.FILE_REQUEST_EXPIRE_OPTIONS_SEC = "86400,9000000000000";
      process.env.FILE_REQUEST_DEFAULT_EXPIRE_SEC = "86400";
      await expect(loadFreshConfig()).rejects.toThrow("100 years");
      vi.resetModules();
      delete process.env.FILE_REQUEST_EXPIRE_OPTIONS_SEC;
      delete process.env.FILE_REQUEST_DEFAULT_EXPIRE_SEC;
      process.env.FILE_REQUEST_RETENTION_SEC = "3153600001";
      await expect(loadFreshConfig()).rejects.toThrow();
      vi.resetModules();
      delete process.env.FILE_REQUEST_RETENTION_SEC;
      process.env.FILE_EXPIRE_OPTIONS_SEC = "300,9000000000000";
      process.env.FILE_DEFAULT_EXPIRE_SEC = "300";
      await expect(loadFreshConfig()).rejects.toThrow("100 years");
    });

    it("should leave the longest expiry and retention to the operator", async () => {
      process.env.FILE_REQUEST_EXPIRE_OPTIONS_SEC = "86400,7776000";
      process.env.FILE_REQUEST_DEFAULT_EXPIRE_SEC = "86400";
      process.env.FILE_REQUEST_RETENTION_SEC = "31536000";
      const config = await loadFreshConfig();
      expect(config.FILE_REQUEST_EXPIRE_OPTIONS_SEC).toEqual([86400, 7776000]);
      expect(config.FILE_REQUEST_RETENTION_SEC).toBe(31536000);
    });

    it("should reject a default expiry that is not an option", async () => {
      process.env.FILE_REQUEST_DEFAULT_EXPIRE_SEC = "3600";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of FILE_REQUEST_EXPIRE_OPTIONS_SEC");
    });

    it("should reject an upload size that FILE_MAX_SIZE would refuse anyway", async () => {
      process.env.FILE_MAX_SIZE = "1GB";
      process.env.FILE_REQUEST_MAX_SIZE = "2GB";
      await expect(loadFreshConfig()).rejects.toThrow("must not exceed FILE_MAX_SIZE");
    });

    it("should reject options out of range", async () => {
      process.env.FILE_REQUEST_UPLOAD_OPTIONS = "0,10";
      await expect(loadFreshConfig()).rejects.toThrow();
      vi.resetModules();
      process.env.FILE_REQUEST_UPLOAD_OPTIONS = "10,1001";
      await expect(loadFreshConfig()).rejects.toThrow("at most 1000");
      vi.resetModules();
      delete process.env.FILE_REQUEST_UPLOAD_OPTIONS;
      process.env.FILE_REQUEST_DOWNLOAD_OPTIONS = "5,101";
      await expect(loadFreshConfig()).rejects.toThrow("at most 100");
    });

    it("should reject a default number of uploads or downloads that is not an option", async () => {
      process.env.FILE_REQUEST_DEFAULT_UPLOADS = "7";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of FILE_REQUEST_UPLOAD_OPTIONS");
      vi.resetModules();
      delete process.env.FILE_REQUEST_DEFAULT_UPLOADS;
      process.env.FILE_REQUEST_DEFAULT_DOWNLOADS = "4";
      await expect(loadFreshConfig()).rejects.toThrow("must be one of FILE_REQUEST_DOWNLOAD_OPTIONS");
    });

    it("should parse custom options and a forced password", async () => {
      process.env.FILE_REQUEST_UPLOAD_OPTIONS = "5, 25, 250";
      process.env.FILE_REQUEST_DEFAULT_UPLOADS = "25";
      process.env.FILE_REQUEST_DOWNLOAD_OPTIONS = "1,3";
      process.env.FILE_REQUEST_DEFAULT_DOWNLOADS = "3";
      process.env.FORCE_REQUEST_PASSWORD = "true";
      const config = await loadFreshConfig();
      expect(config.FILE_REQUEST_UPLOAD_OPTIONS).toEqual([5, 25, 250]);
      expect(config.FILE_REQUEST_DEFAULT_UPLOADS).toBe(25);
      expect(config.FILE_REQUEST_DOWNLOAD_OPTIONS).toEqual([1, 3]);
      expect(config.FILE_REQUEST_DEFAULT_DOWNLOADS).toBe(3);
      expect(config.FORCE_REQUEST_PASSWORD).toBe(true);
    });

    it("should turn the daily limit off at 0", async () => {
      process.env.FILE_REQUEST_DAILY_LIMIT = "0";
      const config = await loadFreshConfig();
      expect(config.FILE_REQUEST_DAILY_LIMIT).toBe(0);
    });
  });
});
