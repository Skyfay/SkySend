/**
 * What a file request needs in this browser only: its two links on the page's own origin, and
 * when a request the server no longer has may be forgotten here. Creating a request, opening
 * its inbox and reading its upload link live in `@skysend/transfer`.
 */
import { buildShareLink } from "@skysend/transfer";

/** The two links of a request: one to hand out, one to keep. */
export interface RequestLinks {
  uploadLink: string;
  inboxLink: string;
}

/** The upload link and the inbox link of a request, from its ID and the two fragments. */
export function requestLinks(request: {
  id: string;
  uploadFragment: string;
  inboxFragment: string;
}): RequestLinks {
  const origin = window.location.origin;
  return {
    uploadLink: buildShareLink(origin, "request", request.id, request.uploadFragment),
    inboxLink: buildShareLink(origin, "inbox", request.id, request.inboxFragment),
  };
}

/** A margin past the last upload of a request, for one that finished late and for the cleanup. */
const FORGET_MARGIN_MS = 24 * 60 * 60_000;

/**
 * Whether a request the server answers 404 for may be forgotten in this browser: only once
 * every upload in it has run out, which is at most the retention of the instance after it
 * closed. Before that a 404 can come from a proxy or a restored database, and the stored
 * inbox link is often the only copy, so forgetting it would lose what arrived for good.
 * Without the retention, before the config arrived or from a server that sends none,
 * nothing is forgotten.
 */
export function requestOutlived(
  closesAt: string,
  retentionSec: number | undefined,
  now = Date.now(),
): boolean {
  if (!retentionSec) return false;
  return now > new Date(closesAt).getTime() + retentionSec * 1000 + FORGET_MARGIN_MS;
}
