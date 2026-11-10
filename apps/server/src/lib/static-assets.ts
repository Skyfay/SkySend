import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { getMimeType } from "hono/utils/mime";

/**
 * Whether the last segment of a path has a dot with something after it, like logo.svg or
 * robots.txt. Such a path goes to the static files, every other one gets the SPA.
 *
 * Linear on purpose. The regex /\.[^/]+$/ it replaces backtracked quadratically on a path of
 * many dots, and one unauthenticated request of 16 KB held the event loop for 60 ms.
 */
export function hasFileExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.indexOf(".");
  return dot !== -1 && dot < name.length - 1;
}

/**
 * Serves the files of the Vite build under /assets/ from memory, each response one buffer.
 *
 * Streamed the way serveStatic does it, a response went out as its headers on their own and
 * then the body, and on a fresh connection over loopback, which is how a reverse proxy on the
 * same host reaches the server, TCP then held the body back for about 200 ms per file. The
 * bundle and its stylesheet made a page load wait that long several times. A response in one
 * buffer goes out in one write and arrives at once.
 *
 * The names carry a hash of the content, so a file never changes while the server runs and
 * may be held once it was read. The names are listed at startup, so a request path is only
 * ever looked up in that list and never reaches the filesystem.
 */
export async function createAssetHandler(assetsDir: string): Promise<MiddlewareHandler> {
  const files = new Map<string, string>();
  try {
    for (const entry of await readdir(assetsDir, { withFileTypes: true })) {
      if (entry.isFile()) files.set(`/assets/${entry.name}`, join(assetsDir, entry.name));
    }
  } catch {
    // No build in this directory, every request passes on.
  }
  const loaded = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

  return async (c, next) => {
    const file = files.get(c.req.path);
    if (!file) return next();
    let body = loaded.get(file);
    if (!body) {
      // Copied once into an array of its own, which a response body needs as its type.
      body = readFile(file).then((data) => new Uint8Array(data));
      loaded.set(file, body);
      // A failed read is tried again on the next request instead of being kept.
      body.catch(() => loaded.delete(file));
    }
    return c.body(await body, 200, {
      "Content-Type": getMimeType(file) ?? "application/octet-stream",
    });
  };
}
