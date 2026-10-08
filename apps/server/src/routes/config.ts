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
    // Service toggles. Released CLI clients accept only "file" and "note" in this list and
    // refuse the whole config otherwise, so file requests get a field of their own.
    enabledServices: config.ENABLED_SERVICES.filter((service) => service !== "request"),
    fileRequestsEnabled: config.ENABLED_SERVICES.includes("request"),
    // File configuration
    fileMaxSize: config.FILE_MAX_SIZE,
    fileMaxFilesPerUpload: config.FILE_MAX_FILES_PER_UPLOAD,
    fileExpireOptions: config.FILE_EXPIRE_OPTIONS_SEC,
    fileDefaultExpire: config.FILE_DEFAULT_EXPIRE_SEC,
    fileDownloadOptions: config.FILE_DOWNLOAD_OPTIONS,
    fileDefaultDownload: config.FILE_DEFAULT_DOWNLOAD,
    fileUploadQuotaBytes: config.FILE_UPLOAD_QUOTA_BYTES,
    fileUploadQuotaWindow: config.FILE_UPLOAD_QUOTA_WINDOW,
    fileUploadConcurrentChunks: config.FILE_UPLOAD_CONCURRENT_CHUNKS,
    fileUploadSpeedLimit: config.FILE_UPLOAD_SPEED_LIMIT,
    fileUploadWs: config.FILE_UPLOAD_WS,
    // Note configuration
    noteMaxSize: config.NOTE_MAX_SIZE,
    noteExpireOptions: config.NOTE_EXPIRE_OPTIONS_SEC,
    noteDefaultExpire: config.NOTE_DEFAULT_EXPIRE_SEC,
    noteViewOptions: config.NOTE_VIEW_OPTIONS,
    noteDefaultViews: config.NOTE_DEFAULT_VIEWS,
    // Since v3 the server accepts notes made of blocks. CLI clients check this before they
    // create one, so they can fall back to a legacy note on an older server.
    noteBlocks: true,
    // File request configuration
    fileRequestExpireOptions: config.FILE_REQUEST_EXPIRE_OPTIONS_SEC,
    fileRequestDefaultExpire: config.FILE_REQUEST_DEFAULT_EXPIRE_SEC,
    fileRequestUploadOptions: config.FILE_REQUEST_UPLOAD_OPTIONS,
    fileRequestDefaultUploads: config.FILE_REQUEST_DEFAULT_UPLOADS,
    fileRequestMaxSize: config.FILE_REQUEST_MAX_SIZE,
    fileRequestRetention: config.FILE_REQUEST_RETENTION_SEC,
    fileRequestDownloadOptions: config.FILE_REQUEST_DOWNLOAD_OPTIONS,
    fileRequestDefaultDownloads: config.FILE_REQUEST_DEFAULT_DOWNLOADS,
    // General
    customTitle: config.CUSTOM_TITLE,
    customColor: config.CUSTOM_COLOR ?? null,
    customLogo: config.CUSTOM_LOGO ?? null,
    customPrivacy: config.CUSTOM_PRIVACY ?? null,
    customLegal: config.CUSTOM_LEGAL ?? null,
    customLinkUrl: config.CUSTOM_LINK_URL ?? null,
    customLinkName: config.CUSTOM_LINK_NAME ?? null,
    customReportUrl: config.CUSTOM_REPORT_URL ?? null,
    // UI defaults
    defaultTheme: config.DEFAULT_THEME,
    defaultColorScheme: config.DEFAULT_COLOR_SCHEME,
    defaultTab: config.DEFAULT_TAB,
    forceFilePassword: config.FORCE_FILE_PASSWORD,
    forceNotePassword: config.FORCE_NOTE_PASSWORD,
    forceRequestPassword: config.FORCE_REQUEST_PASSWORD,
    // OIDC auth
    oidcEnabled: config.OIDC_ENABLED,
    oidcProtectFiles: config.OIDC_ENABLED && config.OIDC_PROTECT_FILES,
    oidcProtectNotes: config.OIDC_ENABLED && config.OIDC_PROTECT_NOTES,
    oidcProtectRequests: config.OIDC_ENABLED && config.OIDC_PROTECT_REQUESTS,
  });
});

export { configRoute };
