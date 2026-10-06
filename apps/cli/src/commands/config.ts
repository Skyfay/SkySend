import type { CliContext } from "../lib/context.js";
import { formatBytes, formatExpiry } from "../lib/format.js";

interface ConfigOptions {
  json?: boolean;
}

/** Settings that are credentials. JSON output often lands in tickets and logs, so they never show. */
const SECRET_KEYS = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "OIDC_CLIENT_SECRET", "OIDC_SESSION_SECRET"];

export async function showConfig(ctx: CliContext, options: ConfigOptions): Promise<void> {
  const config = ctx.config;

  if (options.json) {
    const masked: Record<string, unknown> = { ...config };
    for (const key of SECRET_KEYS) {
      if (masked[key]) masked[key] = "********";
    }
    console.log(JSON.stringify(masked, null, 2));
    return;
  }

  console.log("Server Configuration");
  console.log("====================");
  console.log(`Site Title:         ${config.CUSTOM_TITLE}`);
  console.log(`Base URL:           ${config.BASE_URL}`);
  console.log(`Host:               ${config.HOST}:${config.PORT}`);
  console.log(`Data Directory:     ${config.DATA_DIR}`);
  console.log(`Enabled Services:   ${config.ENABLED_SERVICES.join(", ")}`);
  console.log();
  console.log("File Settings");
  console.log("-------------");
  console.log(`Max File Size:      ${formatBytes(config.FILE_MAX_SIZE)}`);
  console.log(`Max Files/Upload:   ${config.FILE_MAX_FILES_PER_UPLOAD}`);
  console.log(`Expire Options:     ${config.FILE_EXPIRE_OPTIONS_SEC.map(formatExpiry).join(", ")}`);
  console.log(`Default Expiry:     ${formatExpiry(config.FILE_DEFAULT_EXPIRE_SEC)}`);
  console.log(`Download Options:   ${config.FILE_DOWNLOAD_OPTIONS.join(", ")}`);
  console.log(`Default Downloads:  ${config.FILE_DEFAULT_DOWNLOAD}`);
  console.log(
    `Upload Quota:       ${config.FILE_UPLOAD_QUOTA_BYTES === 0 ? "disabled" : `${formatBytes(config.FILE_UPLOAD_QUOTA_BYTES)} / ${formatExpiry(config.FILE_UPLOAD_QUOTA_WINDOW)}`}`,
  );
  console.log();
  console.log("Note Settings");
  console.log("-------------");
  console.log(`Max Note Size:      ${formatBytes(config.NOTE_MAX_SIZE)}`);
  console.log(`Expire Options:     ${config.NOTE_EXPIRE_OPTIONS_SEC.map(formatExpiry).join(", ")}`);
  console.log(`Default Expiry:     ${formatExpiry(config.NOTE_DEFAULT_EXPIRE_SEC)}`);
  console.log(`View Options:       ${config.NOTE_VIEW_OPTIONS.map((v: number) => v === 0 ? "∞" : String(v)).join(", ")}`);
  console.log(`Default Views:      ${config.NOTE_DEFAULT_VIEWS === 0 ? "∞" : config.NOTE_DEFAULT_VIEWS}`);
  console.log();
  console.log("File Request Settings");
  console.log("---------------------");
  console.log(
    `Open For Options:   ${config.FILE_REQUEST_EXPIRE_OPTIONS_SEC.map(formatExpiry).join(", ")}`,
  );
  console.log(`Default Open For:   ${formatExpiry(config.FILE_REQUEST_DEFAULT_EXPIRE_SEC)}`);
  console.log(`Max Uploads:        ${config.FILE_REQUEST_MAX_UPLOADS}`);
  console.log(`Max Total Size:     ${formatBytes(config.FILE_REQUEST_MAX_SIZE)}`);
  console.log(`Retention:          ${formatExpiry(config.FILE_REQUEST_RETENTION_SEC)}`);
  console.log(`Downloads per File: ${config.FILE_REQUEST_DOWNLOADS}`);
  const dailyLimit = config.FILE_REQUEST_DAILY_LIMIT;
  console.log(`Daily Limit:        ${dailyLimit === 0 ? "∞" : dailyLimit}`);
  console.log();
  console.log("General");
  console.log("-------");
  console.log(`Cleanup Interval:   ${config.CLEANUP_INTERVAL}s`);
  console.log(`Rate Limit:         ${config.RATE_LIMIT_MAX} req / ${config.RATE_LIMIT_WINDOW}ms`);
}
