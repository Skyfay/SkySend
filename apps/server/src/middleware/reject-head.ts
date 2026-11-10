import { createMiddleware } from "hono/factory";

/**
 * Answers HEAD with 405 on a route whose GET counts a download.
 *
 * Hono runs the GET handler for a HEAD request and drops the body of its response. On a download
 * route that counted a download, and the file stream it returned was never read or closed, so
 * every HEAD left a file descriptor open until the next restart. No client sends HEAD here.
 */
export const rejectHead = createMiddleware(async (c, next) => {
  if (c.req.method === "HEAD") return c.body(null, 405, { Allow: "GET" });
  await next();
});
