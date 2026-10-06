import { createMiddleware } from "hono/factory";
import { getConfig } from "../lib/config.js";

/**
 * Turns every file request endpoint off when ENABLED_SERVICES leaves out "request".
 * Registered inside the request and inbox routes, so neither can be mounted without it.
 */
export const requestServiceGuard = createMiddleware(async (c, next) => {
  if (!getConfig().ENABLED_SERVICES.includes("request")) {
    return c.json({ error: "File request service is disabled" }, 403);
  }
  await next();
});
