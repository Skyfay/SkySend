import { Hono } from "hono";
import { getConfig } from "../lib/config.js";

const configRoute = new Hono();

/**
 * GET /api/config
 * Returns server limits and options for the client UI.
 * No authentication required.
 */
configRoute.get("/", (c) => {
  const config = getConfig();
  return c.json({
    maxFileSize: config.MAX_FILE_SIZE,
    maxFilesPerUpload: config.MAX_FILES_PER_UPLOAD,
    expireOptions: config.EXPIRE_OPTIONS_SEC,
    defaultExpire: config.DEFAULT_EXPIRE_SEC,
    downloadOptions: config.DOWNLOAD_OPTIONS,
    defaultDownload: config.DEFAULT_DOWNLOAD,
    customTitle: config.CUSTOM_TITLE,
    uploadQuotaBytes: config.UPLOAD_QUOTA_BYTES,
    uploadQuotaWindow: config.UPLOAD_QUOTA_WINDOW,
    customColor: config.CUSTOM_COLOR ?? null,
    customLogo: config.CUSTOM_LOGO ?? null,
  });
});

export { configRoute };
