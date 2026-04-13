import type { CliContext } from "../lib/context.js";
import { formatBytes, formatExpiry } from "../lib/format.js";

interface ConfigOptions {
  json?: boolean;
}

export async function showConfig(ctx: CliContext, options: ConfigOptions): Promise<void> {
  const config = ctx.config;

  if (options.json) {
    console.log(JSON.stringify(config, null, 2));
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
  console.log("General");
  console.log("-------");
  console.log(`Cleanup Interval:   ${config.CLEANUP_INTERVAL}s`);
  console.log(`Rate Limit:         ${config.RATE_LIMIT_MAX} req / ${config.RATE_LIMIT_WINDOW}ms`);
}
