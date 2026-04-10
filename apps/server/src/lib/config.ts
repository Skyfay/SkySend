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

const configSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1).max(65535)),

  HOST: z.string().default("0.0.0.0"),

  BASE_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .transform((v) => v.replace(/\/+$/, "")),

  DATA_DIR: z.string().default("./data"),

  MAX_FILE_SIZE: z
    .string()
    .default("2GB")
    .transform((v) => parseByteSize(v))
    .pipe(z.number().positive()),

  EXPIRE_OPTIONS_SEC: commaSeparatedInts.default(() => [300, 3600, 86400, 604800]),

  DEFAULT_EXPIRE_SEC: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  DOWNLOAD_OPTIONS: commaSeparatedInts.default(() => [1, 2, 3, 4, 5, 10, 20, 50, 100]),

  DEFAULT_DOWNLOAD: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  CLEANUP_INTERVAL: z
    .string()
    .default("60")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  SITE_TITLE: z.string().default("SkySend"),

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

  UPLOAD_QUOTA_BYTES: z
    .string()
    .default("0")
    .transform((v) => {
      // Support both raw numbers and human-readable sizes
      if (/^\d+$/.test(v.trim())) return parseInt(v, 10);
      return parseByteSize(v);
    })
    .pipe(z.number().int().min(0)),

  UPLOAD_QUOTA_WINDOW: z
    .string()
    .default("86400")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  MAX_FILES_PER_UPLOAD: z
    .string()
    .default("32")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  UPLOADS_DIR: z.string().optional(),

  TRUST_PROXY: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
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

  // Cross-field validation
  if (!_config.EXPIRE_OPTIONS_SEC.includes(_config.DEFAULT_EXPIRE_SEC)) {
    throw new Error(
      `DEFAULT_EXPIRE_SEC (${_config.DEFAULT_EXPIRE_SEC}) must be one of EXPIRE_OPTIONS_SEC (${_config.EXPIRE_OPTIONS_SEC.join(", ")})`
    );
  }
  if (!_config.DOWNLOAD_OPTIONS.includes(_config.DEFAULT_DOWNLOAD)) {
    throw new Error(
      `DEFAULT_DOWNLOAD (${_config.DEFAULT_DOWNLOAD}) must be one of DOWNLOAD_OPTIONS (${_config.DOWNLOAD_OPTIONS.join(", ")})`
    );
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
