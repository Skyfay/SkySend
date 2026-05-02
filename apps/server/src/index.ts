import { Hono, type Context, type Next } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
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
import { createPasswordLockout } from "./lib/password-lockout.js";
import type { QuotaVariables } from "./types.js";

// Routes
import { configRoute } from "./routes/config.js";
import { createUploadRoute } from "./routes/upload.js";
import { createUploadWsRoute } from "./routes/upload-ws.js";
import { metaRoute } from "./routes/meta.js";
import { infoRoute } from "./routes/info.js";
import { createDownloadRoute } from "./routes/download.js";
import { createPasswordRoute } from "./routes/password.js";
import { createDeleteRoute } from "./routes/delete.js";
import { existsRoute } from "./routes/exists.js";
import { healthRoute } from "./routes/health.js";
import { createNoteRoute } from "./routes/note.js";

// ── Initialize ─────────────────────────────────────────

const config = loadConfig();
initDatabase(config.DATA_DIR);

// Log storage mode
if (config.STORAGE_BACKEND === "s3") {
  const provider = config.S3_ENDPOINT ?? `AWS S3 (${config.S3_REGION})`;
  console.log(`[storage] Using S3 backend (presigned URL) - endpoint: ${provider}`);
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
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

// Build CSP connect-src based on storage backend
const connectSrc: string[] = ["'self'"];
if (config.STORAGE_BACKEND === "s3") {
  if (config.S3_ENDPOINT) {
    // Presigned URL mode with custom S3 provider
    connectSrc.push(config.S3_ENDPOINT.replace(/\/$/, "") + "/");
  } else if (config.S3_REGION) {
    // Presigned URL mode with AWS S3
    connectSrc.push(`https://s3.${config.S3_REGION}.amazonaws.com`);
    connectSrc.push(`https://*.s3.${config.S3_REGION}.amazonaws.com`);
  }
}

// Allow a custom external logo origin in CSP image sources, local paths remain covered by 'self'.
const imgSrc: string[] = ["'self'", "data:"];
if (config.CUSTOM_LOGO && /^https?:\/\//.test(config.CUSTOM_LOGO)) {
  const customLogoOrigin = new URL(config.CUSTOM_LOGO).origin;
  if (!imgSrc.includes(customLogoOrigin)) {
    imgSrc.push(customLogoOrigin);
  }
}

// Global middleware
// L-4: Hono's built-in logger only logs METHOD, PATH, STATUS, and elapsed time.
// It does NOT log IP addresses or other user-identifying information.
app.use("*", logger());
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // C-4: 'wasm-unsafe-eval' is required for hash-wasm (Argon2id password-based key
      // derivation). hash-wasm bundles the WebAssembly binary inline and instantiates it
      // from a buffer via WebAssembly.compile(), which Chrome 95+ and Firefox 93+ block
      // under CSP unless 'wasm-unsafe-eval' is present. This does NOT grant 'unsafe-eval'
      // for arbitrary JavaScript - it is narrowly scoped to WebAssembly compilation only.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      // C-3: 'unsafe-inline' is required for dynamic inline styles used in:
      //   - NoteContent.tsx: computed line-number column width (style={{ minWidth: `...ch` }})
      //   - ui/progress.tsx: animated progress bar transform (style={{ transform: ... }})
      // These cannot be replaced by static CSS without a larger refactor.
      // All other CSP directives are strict.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc,
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
    referrerPolicy: "no-referrer",
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

// Rate limiter on API routes (not static assets).
// S-2 (Security Audit): Chunk upload requests are intentionally exempt from the
// global rate limiter. This is NOT a security gap - it is a deliberate design
// decision for the following reasons:
//   1. Chunk uploads are already guarded by an upload session (valid init token required).
//   2. The quota middleware enforces per-IP byte limits on the entire upload.
//   3. Per-session memory limits cap total in-flight data.
//   4. Applying the global rate limit (e.g. 60 req/min) to chunks would block a
//      single legitimate large-file upload (a 1 GB file = ~100 chunks at 10 MB each).
// If dedicated chunk-level throttling is needed, implement it as a separate
// bytes-per-second limit in the upload session layer, not via the global counter.
const rateLimiter = createRateLimiter(config);
const passwordLockout = createPasswordLockout(config.PASSWORD_MAX_ATTEMPTS, config.PASSWORD_LOCKOUT_MS);
const passwordRoute = createPasswordRoute(passwordLockout);
const noteRoute = createNoteRoute(passwordLockout);
api.use("*", async (c, next) => {
  if (/\/upload\/[^/]+\/chunk/.test(c.req.path)) {
    return next();
  }
  if (c.req.path.endsWith("/upload/ws")) {
    return next();
  }
  return rateLimiter(c, next);
});

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

// WebSocket upload transport (primary path when FILE_UPLOAD_WS=true)
if (config.FILE_UPLOAD_WS && config.ENABLED_SERVICES.includes("file")) {
  const uploadWsRoute = createUploadWsRoute({
    storage,
    upgradeWebSocket,
    quota: { check: quota.check, record: quota.recordUsage },
  });
  api.route("/upload/ws", uploadWsRoute);
}

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
// - headersTimeout: 60s to receive HTTP headers.
//   S-7 (Security Audit): This is the primary Slowloris defense. Slowloris sends
//   HTTP headers extremely slowly - headersTimeout terminates such connections.
//   Setting it to 0 would be dangerous; 60s is appropriate for normal clients.
// - requestTimeout: 0 (disabled by design).
//   S-7: NOT a Slowloris risk because headersTimeout already covers that attack.
//   requestTimeout covers the body-transfer phase only. Disabling it is intentional:
//   large file uploads over slow connections can legitimately take many hours.
//   The reverse proxy (Nginx/Caddy/Traefik) should handle overall connection timeouts.
// - timeout: 0 (disabled) - socket inactivity handled by Node.js keep-alive defaults.
const nodeServer = server as unknown as import("node:http").Server;
nodeServer.headersTimeout = 60_000;
nodeServer.requestTimeout = 0;

// Attach the WebSocket adapter so /api/upload/ws can accept upgrade requests.
if (config.FILE_UPLOAD_WS && config.ENABLED_SERVICES.includes("file")) {
  injectWebSocket(nodeServer);
}
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
