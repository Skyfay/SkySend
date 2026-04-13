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
    // Service toggles
    enabledServices: config.ENABLED_SERVICES,
    // File configuration
    fileMaxSize: config.FILE_MAX_SIZE,
    fileMaxFilesPerUpload: config.FILE_MAX_FILES_PER_UPLOAD,
    fileExpireOptions: config.FILE_EXPIRE_OPTIONS_SEC,
    fileDefaultExpire: config.FILE_DEFAULT_EXPIRE_SEC,
    fileDownloadOptions: config.FILE_DOWNLOAD_OPTIONS,
    fileDefaultDownload: config.FILE_DEFAULT_DOWNLOAD,
    fileUploadQuotaBytes: config.FILE_UPLOAD_QUOTA_BYTES,
    fileUploadQuotaWindow: config.FILE_UPLOAD_QUOTA_WINDOW,
    // Note configuration
    noteMaxSize: config.NOTE_MAX_SIZE,
    noteExpireOptions: config.NOTE_EXPIRE_OPTIONS_SEC,
    noteDefaultExpire: config.NOTE_DEFAULT_EXPIRE_SEC,
    noteViewOptions: config.NOTE_VIEW_OPTIONS,
    noteDefaultViews: config.NOTE_DEFAULT_VIEWS,
    // General
    customTitle: config.CUSTOM_TITLE,
    customColor: config.CUSTOM_COLOR ?? null,
    customLogo: config.CUSTOM_LOGO ?? null,
    customPrivacy: config.CUSTOM_PRIVACY ?? null,
    customLegal: config.CUSTOM_LEGAL ?? null,
    customLinkUrl: config.CUSTOM_LINK_URL ?? null,
    customLinkName: config.CUSTOM_LINK_NAME ?? null,
  });
});

export { configRoute };
