import { Hono } from "hono";

const healthRoute = new Hono();

/**
 * GET /api/health
 * Simple health check endpoint for Docker and monitoring.
 */
healthRoute.get("/", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

export { healthRoute };
