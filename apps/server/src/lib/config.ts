import { join } from "node:path";
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

  FILE_EXPIRE_OPTIONS_SEC: commaSeparatedInts.default(() => [300, 3600, 86400, 604800]),

  FILE_DEFAULT_EXPIRE_SEC: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

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

  // --- Note-specific configuration ---

  NOTE_MAX_SIZE: z
    .string()
    .default("1MB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().positive()),

  NOTE_EXPIRE_OPTIONS_SEC: commaSeparatedInts.default(() => [300, 3600, 86400, 604800]),

  NOTE_DEFAULT_EXPIRE_SEC: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

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
});

type RawConfig = z.infer<typeof configSchema>;
export type Config = Omit<RawConfig, "UPLOADS_DIR"> & { UPLOADS_DIR: string };

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

  return _config;
}

/**
 * Get the already-loaded config. Throws if loadConfig() has not been called.
 */
export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}
