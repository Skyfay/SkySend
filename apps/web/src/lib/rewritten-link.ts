/**
 * Recovery for share links whose fragment was percent-encoded in transit.
 *
 * Mail security gateways such as Microsoft Defender Safe Links rewrite links they
 * find in a message. Some of them wrap the original URL in a query parameter and
 * hand the browser back a path where the "#" survived only as "%23":
 *
 *   /file/<id>#<secret>   ->   /file/<id>%23<secret>
 *
 * The browser never decodes "%23" in a path, so location.hash is empty and the
 * page cannot read the key. The key itself is not lost, it just sits in the path,
 * so it can be moved back into the fragment before the router looks at the URL.
 *
 * This does not undo the exposure. The request already reached the server with the
 * key in its path. That is why wasShareLinkRewritten() exists, so the pages can
 * tell the recipient what happened.
 */

// A file or note ID is a randomUUID(), a secret is base64url without padding.
// Neither alphabet contains "%", so this pattern cannot match a legitimate link.
// "%2523" covers gateways that hand over the wrapper parameter without decoding it.
const REWRITTEN_PATH = /^\/(file|note|d)\/([0-9a-fA-F-]{36})%(?:25)?23([A-Za-z0-9_-]+)\/?$/;

let rewritten = false;

/**
 * Rebuild a share link whose "#" arrived percent-encoded.
 * Returns the corrected path, or null when the path is not a rewritten share link.
 */
export function normalizeRewrittenPath(pathname: string): string | null {
  const match = REWRITTEN_PATH.exec(pathname);
  if (!match) return null;
  return `/${match[1]}/${match[2]}#${match[3]}`;
}

/**
 * Repair the current URL in place when it is a rewritten share link.
 * Runs before the router mounts. replaceState issues no request, so the key is
 * not sent to the server a second time.
 */
export function applyRewrittenShareLinkFix(): void {
  const normalized = normalizeRewrittenPath(window.location.pathname);
  if (!normalized) return;

  const [path, fragment] = normalized.split("#");
  // Gateways append their own query parameters, so keep the search string.
  window.history.replaceState(null, "", `${path}${window.location.search}#${fragment}`);
  rewritten = true;
}

/**
 * Whether this page was reached through a rewritten share link, which means the
 * key travelled to the server in the request path.
 */
export function wasShareLinkRewritten(): boolean {
  return rewritten;
}
