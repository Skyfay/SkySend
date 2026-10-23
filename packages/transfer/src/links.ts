/**
 * The links of an instance: `<server>/<type>/<id>#<secret>`. The fragment holds the key, and
 * browsers never send a fragment, so the server sees the ID and nothing else.
 */

/** A share of files, a note, the upload page of a file request and its inbox. */
export type LinkType = "file" | "note" | "request" | "inbox";

export interface ShareLink<T extends LinkType = LinkType> {
  /** The origin of the instance, like `https://send.example.com`. */
  server: string;
  type: T;
  id: string;
  /** The fragment without its "#". */
  secret: string;
}

/**
 * `text` without the slashes at its end, like an address someone typed as `https://host/`.
 * A loop and not `/\/+$/`, which tries every slash of a long run again and takes quadratic
 * time on a run that something else follows.
 */
export function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end--;
  return text.slice(0, end);
}

/** Builds a link. A slash at the end of `server` is dropped. */
export function buildShareLink(server: string, type: LinkType, id: string, secret: string): string {
  return `${trimTrailingSlashes(server)}/${type}/${encodeURIComponent(id)}#${secret}`;
}

/**
 * Reads a link of one of `types`. `/d/<id>` is the old form of a file link. Throws on a link
 * without its fragment and on any other path.
 */
export function parseShareLink<T extends LinkType>(url: string, types: readonly T[]): ShareLink<T> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  const secret = parsed.hash.slice(1);
  if (!secret) throw new Error("URL is missing the secret fragment (#...)");

  const match = /^\/([a-z]+)\/([^/]+)\/?$/.exec(parsed.pathname);
  const type = match?.[1] === "d" ? "file" : match?.[1];
  if (!match || !types.some((allowed) => allowed === type)) {
    const paths = types.map((allowed) => `/${allowed}/<id>`).join(" or ");
    throw new Error(`URL path must be ${paths}, got: ${parsed.pathname}`);
  }
  return { server: parsed.origin, type: type as T, id: decodeURIComponent(match[2]!), secret };
}
