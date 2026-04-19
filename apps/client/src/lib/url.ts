/**
 * Parse and build SkySend share URLs.
 *
 * Share URLs follow the pattern:
 *   https://send.example.com/file/<id>#<base64url-secret>
 *   https://send.example.com/note/<id>#<base64url-secret>
 */

export interface ParsedUrl {
  server: string;
  type: "file" | "note";
  id: string;
  secret: string;
}

export function parseShareUrl(url: string): ParsedUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const secret = parsed.hash.slice(1); // remove leading #
  if (!secret) {
    throw new Error("URL is missing the secret fragment (#...)");
  }

  // Match /file/:id or /note/:id (also /d/:id as legacy redirect)
  const match = parsed.pathname.match(/^\/(file|note|d)\/([^/]+)\/?$/);
  if (!match) {
    throw new Error(`URL path must be /file/<id> or /note/<id>, got: ${parsed.pathname}`);
  }

  const type = match[1] === "d" ? "file" : (match[1] as "file" | "note");
  const id = decodeURIComponent(match[2]!);
  const server = parsed.origin;

  return { server, type, id, secret };
}

export function buildShareUrl(
  server: string,
  type: "file" | "note",
  id: string,
  secret: string,
): string {
  const base = server.replace(/\/+$/, "");
  return `${base}/${type}/${encodeURIComponent(id)}#${secret}`;
}
