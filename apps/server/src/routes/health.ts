import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf-8"),
) as { version: string };

const healthRoute = new Hono();

/**
 * GET /api/health
 * Simple health check endpoint for Docker and monitoring.
 */
healthRoute.get("/", (c) => {
  return c.json({ status: "ok", version: pkg.version, timestamp: new Date().toISOString() });
});

export { healthRoute };
