import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { resolve } from "node:path";

import { loadConfig } from "./lib/config.js";
import { initDatabase, closeDatabase } from "./db/index.js";
import { FileStorage } from "./storage/filesystem.js";
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

// ── Initialize ─────────────────────────────────────────

const config = loadConfig();
initDatabase(config.DATA_DIR);
const storage = new FileStorage(config.UPLOADS_DIR);
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
      connectSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xFrameOptions: "DENY",
  }),
);
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
    console.log(`[skysend] Max file size: ${(config.MAX_FILE_SIZE / (1024 ** 2)).toFixed(0)} MB`);
    if (config.UPLOAD_QUOTA_BYTES > 0) {
      console.log(`[skysend] Upload quota: ${(config.UPLOAD_QUOTA_BYTES / (1024 ** 2)).toFixed(0)} MB / ${config.UPLOAD_QUOTA_WINDOW}s`);
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
