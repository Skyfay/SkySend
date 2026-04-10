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
  console.log(`Site Title:         ${config.SITE_TITLE}`);
  console.log(`Base URL:           ${config.BASE_URL}`);
  console.log(`Host:               ${config.HOST}:${config.PORT}`);
  console.log(`Data Directory:     ${config.DATA_DIR}`);
  console.log(`Max File Size:      ${formatBytes(config.MAX_FILE_SIZE)}`);
  console.log(`Max Files/Upload:   ${config.MAX_FILES_PER_UPLOAD}`);
  console.log(`Expire Options:     ${config.EXPIRE_OPTIONS_SEC.map(formatExpiry).join(", ")}`);
  console.log(`Default Expiry:     ${formatExpiry(config.DEFAULT_EXPIRE_SEC)}`);
  console.log(`Download Options:   ${config.DOWNLOAD_OPTIONS.join(", ")}`);
  console.log(`Default Downloads:  ${config.DEFAULT_DOWNLOAD}`);
  console.log(`Cleanup Interval:   ${config.CLEANUP_INTERVAL}s`);
  console.log(`Rate Limit:         ${config.RATE_LIMIT_MAX} req / ${config.RATE_LIMIT_WINDOW}ms`);
  console.log(
    `Upload Quota:       ${config.UPLOAD_QUOTA_BYTES === 0 ? "disabled" : `${formatBytes(config.UPLOAD_QUOTA_BYTES)} / ${formatExpiry(config.UPLOAD_QUOTA_WINDOW)}`}`,
  );
}
