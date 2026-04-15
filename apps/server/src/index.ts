import { Hono, type Context, type Next } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { resolve } from "node:path";

import { loadConfig } from "./lib/config.js";
import { initDatabase, closeDatabase } from "./db/index.js";
import { createStorage } from "./storage/index.js";
import { startCleanupJob, runCleanup } from "./lib/cleanup.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { createUploadQuota } from "./middleware/quota.js";
import type { QuotaVariables } from "./types.js";

// Routes
import { configRoute } from "./routes/config.js";
import { createUploadRoute } from "./routes/upload.js";
import { metaRoute } from "./routes/meta.js";
import { infoRoute } from "./routes/info.js";
import { createDownloadRoute } from "./routes/download.js";
import { passwordRoute } from "./routes/password.js";
import { createDeleteRoute } from "./routes/delete.js";
import { existsRoute } from "./routes/exists.js";
import { healthRoute } from "./routes/health.js";
import { noteRoute } from "./routes/note.js";

// ── Initialize ─────────────────────────────────────────

const config = loadConfig();
initDatabase(config.DATA_DIR);

// Log storage mode
if (config.STORAGE_BACKEND === "s3") {
  const provider = config.S3_ENDPOINT ?? `AWS S3 (${config.S3_REGION})`;
  const mode = config.S3_PUBLIC_URL ? "public URL" : "presigned URL";
  console.log(`[storage] Using S3 backend (${mode}) - endpoint: ${provider}`);
} else {
  console.log(`[storage] Using filesystem backend - path: ${config.UPLOADS_DIR}`);
}

const storage = await createStorage(config);
await storage.init();

// Run cleanup once at startup to clear any stale uploads
try {
  await runCleanup(storage);
} catch (err) {
  console.error("[startup] Initial cleanup failed:", err);
  process.exit(1);
}

const stopCleanup = startCleanupJob(storage, config.CLEANUP_INTERVAL);

// ── App Setup ──────────────────────────────────────────

const app = new Hono();

// Build CSP connect-src based on storage backend
const connectSrc: string[] = ["'self'"];
if (config.STORAGE_BACKEND === "s3") {
  if (config.S3_PUBLIC_URL) {
    // Public URL mode - allow fetches to the public domain
    connectSrc.push(config.S3_PUBLIC_URL.replace(/\/+$/, "") + "/");
  } else if (config.S3_ENDPOINT) {
    // Presigned URL mode with custom S3 provider
    connectSrc.push(config.S3_ENDPOINT.replace(/\/$/, "") + "/");
  } else if (config.S3_REGION) {
    // Presigned URL mode with AWS S3
    connectSrc.push(`https://s3.${config.S3_REGION}.amazonaws.com`);
    connectSrc.push(`https://*.s3.${config.S3_REGION}.amazonaws.com`);
  }
}

// Global middleware
app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc,
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xFrameOptions: "DENY",
  }),
);
// Allow any origin on the public health endpoint (read-only, no sensitive data)
app.use("/api/health", cors({ origin: "*" }));
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = [config.BASE_URL, ...config.CORS_ORIGINS];
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Content-Length",
      "X-Content-Length",
      "X-Auth-Token",
      "X-Owner-Token",
      "X-Salt",
      "X-Max-Downloads",
      "X-Expire-Sec",
      "X-File-Count",
      "X-Has-Password",
      "X-Password-Salt",
      "X-Password-Algo",
    ],
    exposeHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-File-Count",
    ],
  }),
);
// Upload quota middleware (only on upload endpoint)
const quota = createUploadQuota(config);

// Global error handler
app.onError((err, c) => {
  console.error("[error]", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ── API Routes ─────────────────────────────────────────

const api = new Hono();

// Rate limiter only on API routes (not static assets)
api.use("*", createRateLimiter(config));

api.route("/config", configRoute);
api.route("/health", healthRoute);

// File service routes - guarded by ENABLED_SERVICES
const fileServiceGuard = async (c: Context, next: Next) => {
  if (!config.ENABLED_SERVICES.includes("file")) {
    return c.json({ error: "File service is disabled" }, 403);
  }
  return next();
};
api.use("/info/*", fileServiceGuard);
api.use("/exists/*", fileServiceGuard);
api.use("/password/*", fileServiceGuard);
api.use("/meta/*", fileServiceGuard);
api.use("/download/*", fileServiceGuard);
api.use("/upload/*", fileServiceGuard);
api.use("/quota", fileServiceGuard);

api.route("/info", infoRoute);
api.route("/exists", existsRoute);
api.route("/password", passwordRoute);
api.route("/meta", metaRoute);
api.route("/download", createDownloadRoute(storage));

// Quota status endpoint
api.get("/quota", (c) => {
  return c.json(quota.getStatus(c));
});

// Upload route with quota middleware
const uploadRoute = createUploadRoute(storage);
const uploadWithQuota = new Hono<{ Variables: QuotaVariables }>();
uploadWithQuota.use("*", quota.middleware);
uploadWithQuota.use("*", async (c, next) => {
  // Inject quota recorder into context for all upload sub-routes
  c.set("quotaRecorder", quota.recordUsage);
  await next();
});
uploadWithQuota.route("/", uploadRoute);
api.route("/upload", uploadWithQuota);

// Delete uses the upload path with DELETE method
api.route("/upload", createDeleteRoute(storage));

// Note routes (E2EE encrypted notes) - guarded by ENABLED_SERVICES
api.use("/note/*", async (c: Context, next: Next) => {
  if (!config.ENABLED_SERVICES.includes("note")) {
    return c.json({ error: "Note service is disabled" }, 403);
  }
  return next();
});
api.route("/note", noteRoute);

app.route("/api", api);

// ── Static SPA Serving ─────────────────────────────────

// Serve the Vite-built SPA from apps/web/dist
// In production (Docker), the built files are at the expected path
const webDistPath = resolve(import.meta.dirname, "../../web/dist");

app.use(
  "/assets/*",
  serveStatic({ root: webDistPath, rewriteRequestPath: (path) => path }),
);

// Serve all static files from the Vite build output (logo.svg, favicon.svg,
// download-sw.js, robots.txt, .well-known/*, etc.) before the SPA fallback.
app.use(
  "*",
  serveStatic({ root: webDistPath }),
);

// SPA fallback - serve index.html for all non-API routes
app.get("*", serveStatic({ root: webDistPath, path: "/index.html" }));

// ── Start Server ───────────────────────────────────────

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  },
  (info) => {
    console.log(`[skysend] Server running at ${config.BASE_URL}`);
    console.log(`[skysend] Listening on http://${config.HOST}:${info.port}`);
    console.log(`[skysend] Data directory: ${resolve(config.DATA_DIR)}`);
    console.log(`[skysend] Uploads directory: ${resolve(config.UPLOADS_DIR)}`);
    console.log(`[skysend] Max file size: ${(config.FILE_MAX_SIZE / (1024 ** 2)).toFixed(0)} MB`);
    console.log(`[skysend] Max note size: ${(config.NOTE_MAX_SIZE / (1024 ** 2)).toFixed(2)} MB`);
    if (config.FILE_UPLOAD_QUOTA_BYTES > 0) {
      console.log(`[skysend] Upload quota: ${(config.FILE_UPLOAD_QUOTA_BYTES / (1024 ** 2)).toFixed(0)} MB / ${config.FILE_UPLOAD_QUOTA_WINDOW}s`);
    }
  },
);

// Timeout tuning for large file uploads over slow connections:
// - headersTimeout: 60s to receive HTTP headers (prevents Slowloris attacks)
// - requestTimeout: 0 (disabled) - uploads can take hours on slow connections
// - timeout: 0 (disabled) - socket inactivity handled by Node.js keep-alive defaults
const nodeServer = server as unknown as import("node:http").Server;
nodeServer.headersTimeout = 60_000;
nodeServer.requestTimeout = 0;
nodeServer.timeout = 0;

// ── Graceful Shutdown ──────────────────────────────────

function shutdown() {
  console.log("\n[skysend] Shutting down gracefully...");
  stopCleanup();
  server.close(() => {
    closeDatabase();
    console.log("[skysend] Server stopped.");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("[skysend] Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
