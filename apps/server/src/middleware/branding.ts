import { createMiddleware } from "hono/factory";
import { serveStatic } from "@hono/node-server/serve-static";
import { mkdirSync, realpathSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { MiddlewareHandler } from "hono";

/** URL prefix the branding directory is mounted under, with trailing slash. */
export const BRANDING_PREFIX = "/branding/";

/**
 * Image types an operator may drop into the branding directory.
 *
 * The directory is writable by whoever owns the data volume, so restricting it
 * to images keeps the app origin from serving attacker-authored HTML if that
 * volume is ever compromised.
 */
const ALLOWED_EXTENSIONS = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".avif",
]);

/**
 * Resolves a /branding/* request path to a real file inside `root`.
 * Returns null when the request is not an allowed image or escapes the root.
 */
function resolveBrandingFile(reqPath: string, root: string): string | null {
  if (!reqPath.startsWith(BRANDING_PREFIX)) return null;

  let relative: string;
  try {
    relative = decodeURIComponent(reqPath.slice(BRANDING_PREFIX.length));
  } catch {
    // Malformed percent-encoding
    return null;
  }

  if (!relative || relative.includes("\0") || relative.includes("\\")) return null;
  if (!ALLOWED_EXTENSIONS.has(extname(relative).toLowerCase())) return null;

  const target = resolve(root, relative);
  if (!target.startsWith(root + sep)) return null;

  try {
    // serveStatic follows symlinks without containment, so resolve them here.
    const real = realpathSync(target);
    return real.startsWith(root + sep) ? real : null;
  } catch {
    // Missing file or unreadable path
    return null;
  }
}

/**
 * Serves operator-supplied branding assets from a mounted directory.
 *
 * Files live on the app's own origin, so a custom logo needs no third-party
 * request and stays covered by the CSP 'self' image source.
 */
export function createBrandingStatic(brandingDir: string): MiddlewareHandler[] {
  let root = resolve(brandingDir);

  // serveStatic logs an error at construction time when the root is missing,
  // and operators expect to find the directory ready to drop files into.
  try {
    mkdirSync(root, { recursive: true });
  } catch (err) {
    // Read-only or externally managed mounts (e.g. SKIP_CHOWN=true) are the
    // operator's responsibility - a missing directory only means 404s.
    console.warn(`[skysend] Could not create branding directory ${root}:`, err);
  }

  try {
    // The containment check compares real paths, so the root must be resolved
    // too - a symlinked mount point would otherwise reject every file.
    root = realpathSync(root);
  } catch {
    // Directory does not exist - every request 404s via resolveBrandingFile.
  }

  const guard = createMiddleware(async (c, next) => {
    if (!resolveBrandingFile(c.req.path, root)) return c.notFound();

    await next();

    if (c.res.status === 200) {
      c.res.headers.set("Cache-Control", "public, max-age=3600");
    }
  });

  const files = serveStatic({
    root,
    // Runs after serveStatic's own traversal check and is not re-validated by
    // it, so this only strips the already guarded prefix. The guard rejects
    // every path outside the prefix before this handler runs, which is why the
    // fallback is unreachable.
    /* v8 ignore next 2 */
    rewriteRequestPath: (path) =>
      path.startsWith(BRANDING_PREFIX) ? path.slice(BRANDING_PREFIX.length - 1) : "/",
  });

  return [guard, files];
}
