import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Parse a human-readable byte size string (e.g., "2GB", "500MB") into bytes.
 * Supports: B, KB, MB, GB.
 */
function parseByteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid byte size: "${value}". Use format like "2GB", "500MB".`);
  }
  const num = parseFloat(match[1]!);
  const unit = match[2]!.toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
  };
  return Math.floor(num * multipliers[unit]!);
}

/** Comma-separated list of positive integers. */
const commaSeparatedInts = z
  .string()
  .transform((s) => s.split(",").map((v) => parseInt(v.trim(), 10)))
  .pipe(z.array(z.number().int().positive()).min(1));

/** Comma-separated list of non-negative integers (allows 0). */
const commaSeparatedNonNegativeInts = z
  .string()
  .transform((s) => s.split(",").map((v) => parseInt(v.trim(), 10)))
  .pipe(z.array(z.number().int().nonnegative()).min(1));

const configSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535)),

  HOST: z.string().default("0.0.0.0"),

  BASE_URL: z
    .string()
    .min(1, "BASE_URL is required (e.g. https://send.example.com)")
    .url("BASE_URL must be a valid URL (e.g. https://send.example.com)")
    .transform((v) => v.replace(/\/+$/, "")),

  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()) : [])),

  DATA_DIR: z.string().default("./data"),

  // --- File-specific configuration ---

  FILE_MAX_SIZE: z
    .string()
    .default("2GB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().positive()),

  FILE_EXPIRE_OPTIONS_SEC: commaSeparatedNonNegativeInts.default(() => [0, 300, 3600, 86400, 604800]),

  FILE_DEFAULT_EXPIRE_SEC: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().nonnegative()),

  FILE_DOWNLOAD_OPTIONS: commaSeparatedInts.default(() => [1, 2, 3, 4, 5, 10, 20, 50, 100]),

  FILE_DEFAULT_DOWNLOAD: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  FILE_MAX_FILES_PER_UPLOAD: z
    .string()
    .default("32")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  FILE_UPLOAD_QUOTA_BYTES: z
    .string()
    .default("0")
    .transform((v) => {
      // Support both raw numbers and human-readable sizes
      if (/^\d+$/.test(v.trim())) return parseInt(v, 10);
      return parseByteSize(v);
    })
    .pipe(z.number().int().min(0)),

  FILE_UPLOAD_QUOTA_WINDOW: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  FILE_UPLOAD_CONCURRENT_CHUNKS: z
    .string()
    .default("3")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(20, "FILE_UPLOAD_CONCURRENT_CHUNKS must be between 1 and 20")),

  FILE_UPLOAD_SPEED_LIMIT: z
    .string()
    .default("0")
    .transform((v) => {
      const trimmed = v.trim();
      if (trimmed === "0" || trimmed === "") return 0;
      if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
      return parseByteSize(trimmed);
    })
    .pipe(z.number().int().min(0)),

  FILE_UPLOAD_WS: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),

  FILE_UPLOAD_WS_MAX_BUFFER: z
    .string()
    .default("16MB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().int().min(1024 * 1024, "FILE_UPLOAD_WS_MAX_BUFFER must be at least 1MB")),

  // --- Note-specific configuration ---

  NOTE_MAX_SIZE: z
    .string()
    .default("1MB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().positive()),

  NOTE_EXPIRE_OPTIONS_SEC: commaSeparatedNonNegativeInts.default(() => [0, 300, 3600, 86400, 604800]),

  NOTE_DEFAULT_EXPIRE_SEC: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().nonnegative()),

  NOTE_VIEW_OPTIONS: commaSeparatedNonNegativeInts.default(() => [0, 1, 2, 3, 5, 10, 20, 50, 100]),

  NOTE_DEFAULT_VIEWS: z
    .string()
    .default("0")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().nonnegative()),

  // --- General configuration ---

  ENABLED_SERVICES: z
    .string()
    .default("file,note")
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v === "file" || v === "note"),
    )
    .pipe(z.array(z.enum(["file", "note"])).min(1, "ENABLED_SERVICES must contain at least one of: file, note")),

  CLEANUP_INTERVAL: z
    .string()
    .default("60")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  CUSTOM_TITLE: z.string().default("SkySend"),

  RATE_LIMIT_WINDOW: z
    .string()
    .default("60000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  RATE_LIMIT_MAX: z
    .string()
    .default("60")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  /** Maximum failed password attempts before a resource is locked. */
  PASSWORD_MAX_ATTEMPTS: z
    .string()
    .default("10")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  /** How long (ms) a resource stays locked after too many failed attempts. Default: 15 minutes. */
  PASSWORD_LOCKOUT_MS: z
    .string()
    .default("900000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  UPLOADS_DIR: z.string().optional(),

  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  CUSTOM_COLOR: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color, e.g. 46c89d or #46c89d")
    .transform((v) => (v.startsWith("#") ? v : `#${v}`))
    .optional(),

  CUSTOM_LOGO: z
    .string()
    .refine(
      (v) => /^https?:\/\//.test(v) || v.startsWith("/"),
      "Must be a URL (https://...) or an absolute path (/logo.svg)",
    )
    .optional(),

  CUSTOM_PRIVACY: z
    .string()
    .url("Must be a valid URL (https://...)")
    .optional(),

  CUSTOM_LEGAL: z
    .string()
    .url("Must be a valid URL (https://...)")
    .optional(),

  CUSTOM_LINK_URL: z
    .string()
    .url("Must be a valid URL (https://...)")
    .optional(),

  CUSTOM_LINK_NAME: z.string().max(50).optional(),

  CUSTOM_REPORT_URL: z
    .string()
    .url("Must be a valid URL (https://...)")
    .optional(),

  // --- UI defaults ---

  DEFAULT_THEME: z
    .enum(["dark", "light", "system"])
    .default("system"),

  DEFAULT_TAB: z
    .enum(["file", "text", "password", "code", "sshkey"])
    .default("file"),

  FORCE_FILE_PASSWORD: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  FORCE_NOTE_PASSWORD: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // --- Storage backend configuration ---

  STORAGE_BACKEND: z
    .enum(["filesystem", "s3"])
    .default("filesystem"),

  // --- S3 configuration (only when STORAGE_BACKEND=s3) ---

  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url("S3_ENDPOINT must be a valid URL").optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),

  S3_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  S3_PRESIGNED_EXPIRY: z
    .string()
    .default("300")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  S3_PART_SIZE: z
    .string()
    .default("25MB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().int().min(5 * 1024 * 1024, "S3_PART_SIZE must be at least 5MB (S3 minimum)").max(5 * 1024 * 1024 * 1024, "S3_PART_SIZE must be at most 5GB")),

  S3_CONCURRENCY: z
    .string()
    .default("4")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(16, "S3_CONCURRENCY must be between 1 and 16")),

  // --- OIDC authentication (optional) ---

  /** Which provider preset to use. Defaults to "generic" when OIDC is active. */
  OIDC_PROVIDER: z
    .enum(["generic", "pocketid", "authentik", "keycloak"])
    .default("generic"),

  /** OIDC issuer URL (e.g. https://auth.example.com/realms/myrealm). Required when OIDC is active. */
  OIDC_ISSUER: z.string().url("OIDC_ISSUER must be a valid URL").optional(),

  /** OIDC client ID registered at the provider. Required when OIDC is active. */
  OIDC_CLIENT_ID: z.string().optional(),

  /** OIDC client secret. Required when OIDC is active. */
  OIDC_CLIENT_SECRET: z.string().optional(),

  /** Override the redirect URI. Defaults to ${BASE_URL}/auth/callback. */
  OIDC_REDIRECT_URI: z.string().url("OIDC_REDIRECT_URI must be a valid URL").optional(),

  /** Space-separated scopes. Defaults to "openid profile email". */
  OIDC_SCOPES: z.string().default("openid profile email"),

  /** Protect file uploads behind OIDC when active. Default: true. */
  OIDC_PROTECT_FILES: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),

  /** Protect note creation behind OIDC when active. Default: true. */
  OIDC_PROTECT_NOTES: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() !== "false"),

  /**
   * Secret used to sign session JWT cookies. Must be at least 32 characters.
   * Required when OIDC is active.
   */
  OIDC_SESSION_SECRET: z.string().optional(),

  /** Session duration in seconds. Default: 86400 (24 hours). */
  OIDC_SESSION_DURATION: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),
});

type RawConfig = z.infer<typeof configSchema>;
export type Config = Omit<RawConfig, "UPLOADS_DIR"> & {
  UPLOADS_DIR: string;
  /** True when OIDC is fully configured (OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET + OIDC_SESSION_SECRET are all set). */
  OIDC_ENABLED: boolean;
};

let _config: Config | undefined;

/**
 * Load and validate configuration from environment variables.
 * The result is cached after the first call.
 */
export function loadConfig(): Config {
  if (_config) return _config;
  // Strip empty strings from env - treat them as unset so defaults apply
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    env[key] = value === "" ? undefined : value;
  }
  const parsed = configSchema.parse(env);
  _config = {
    ...parsed,
    UPLOADS_DIR: parsed.UPLOADS_DIR ?? join(parsed.DATA_DIR, "uploads"),
    OIDC_ENABLED: false,
  } as Config;

  // Cross-field validation - Files
  if (_config.ENABLED_SERVICES.includes("file")) {
    if (!_config.FILE_EXPIRE_OPTIONS_SEC.includes(_config.FILE_DEFAULT_EXPIRE_SEC)) {
      throw new Error(
        `FILE_DEFAULT_EXPIRE_SEC (${_config.FILE_DEFAULT_EXPIRE_SEC}) must be one of FILE_EXPIRE_OPTIONS_SEC (${_config.FILE_EXPIRE_OPTIONS_SEC.join(", ")})`
      );
    }
    if (!_config.FILE_DOWNLOAD_OPTIONS.includes(_config.FILE_DEFAULT_DOWNLOAD)) {
      throw new Error(
        `FILE_DEFAULT_DOWNLOAD (${_config.FILE_DEFAULT_DOWNLOAD}) must be one of FILE_DOWNLOAD_OPTIONS (${_config.FILE_DOWNLOAD_OPTIONS.join(", ")})`
      );
    }
  }

  // Cross-field validation - Notes
  if (_config.ENABLED_SERVICES.includes("note")) {
    if (!_config.NOTE_EXPIRE_OPTIONS_SEC.includes(_config.NOTE_DEFAULT_EXPIRE_SEC)) {
      throw new Error(
      `NOTE_DEFAULT_EXPIRE_SEC (${_config.NOTE_DEFAULT_EXPIRE_SEC}) must be one of NOTE_EXPIRE_OPTIONS_SEC (${_config.NOTE_EXPIRE_OPTIONS_SEC.join(", ")})`
    );
  }
    if (!_config.NOTE_VIEW_OPTIONS.includes(_config.NOTE_DEFAULT_VIEWS)) {
      throw new Error(
        `NOTE_DEFAULT_VIEWS (${_config.NOTE_DEFAULT_VIEWS}) must be one of NOTE_VIEW_OPTIONS (${_config.NOTE_VIEW_OPTIONS.join(", ")})`
      );
    }
  }

  // Cross-field validation - S3 storage
  if (_config.STORAGE_BACKEND === "s3") {
    const required: Array<[string, unknown]> = [
      ["S3_BUCKET", _config.S3_BUCKET],
      ["S3_REGION", _config.S3_REGION],
      ["S3_ACCESS_KEY", _config.S3_ACCESS_KEY],
      ["S3_SECRET_KEY", _config.S3_SECRET_KEY],
    ];
    const missing = required.filter(([, v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(
        `STORAGE_BACKEND=s3 requires: ${missing.join(", ")}`,
      );
    }
  }

  // Cross-field validation - OIDC
  const oidcPartiallyConfigured =
    _config.OIDC_ISSUER ||
    _config.OIDC_CLIENT_ID ||
    _config.OIDC_CLIENT_SECRET;

  if (oidcPartiallyConfigured) {
    const missing: string[] = [];
    if (!_config.OIDC_ISSUER) missing.push("OIDC_ISSUER");
    if (!_config.OIDC_CLIENT_ID) missing.push("OIDC_CLIENT_ID");
    if (!_config.OIDC_CLIENT_SECRET) missing.push("OIDC_CLIENT_SECRET");
    if (missing.length > 0) {
      throw new Error(`OIDC is partially configured. Missing: ${missing.join(", ")}`);
    }
    if (!_config.OIDC_SESSION_SECRET) {
      _config.OIDC_SESSION_SECRET = randomBytes(48).toString("base64");
      console.warn(
        "[oidc] WARNING: OIDC_SESSION_SECRET is not set - a random secret was generated at startup. "
        + "All active sessions will be invalidated on every server restart. "
        + "Set OIDC_SESSION_SECRET in your environment to persist sessions across restarts.",
      );
    } else if (_config.OIDC_SESSION_SECRET.length < 32) {
      throw new Error("OIDC_SESSION_SECRET must be at least 32 characters long");
    }
    if (!_config.OIDC_ISSUER!.startsWith("https://")) {
      console.warn("[oidc] WARNING: OIDC_ISSUER is using HTTP instead of HTTPS. This exposes OAuth tokens to network interception and is insecure in production.");
    }
    if (!_config.OIDC_PROTECT_FILES && !_config.OIDC_PROTECT_NOTES) {
      console.warn(
        "[oidc] WARNING: OIDC_PROTECT_FILES=false and OIDC_PROTECT_NOTES=false - OIDC is enabled but no upload routes are protected.",
      );
    }
    _config.OIDC_ENABLED = true;
  }

  return _config;
}

/**
 * Get the already-loaded config. Throws if loadConfig() has not been called.
 */
export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}
