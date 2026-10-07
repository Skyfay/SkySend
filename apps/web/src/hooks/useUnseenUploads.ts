import { useEffect, useSyncExternalStore } from "react";
import * as api from "@/lib/api";
import { openInboxLink } from "@/lib/file-request";
import { getAllRequests } from "@/lib/upload-store";
import {
  countUnseen,
  keepUnseen,
  setUnseen,
  subscribeUnseen,
  unseenTotal,
} from "@/lib/unseen-uploads";

/** How often the inboxes are checked while the page is visible. */
export const UNSEEN_POLL_MS = 5 * 60_000;
/** No round starts sooner than this after the last one, however often the tab comes back. */
export const UNSEEN_MIN_GAP_MS = 60_000;
/** The newest requests checked in one round, so a round never crowds the rate limit. */
export const UNSEEN_MAX_PER_ROUND = 20;
/** An upload that started before its request closed may still finish for about this long. */
const SETTLE_MS = 24 * 60 * 60_000;

let running = false;
let lastRound = Number.NEGATIVE_INFINITY;

/**
 * Checks the requests kept in this browser for uploads their inbox has not shown yet. Only a
 * request without a password can be checked, since the token of one with a password needs
 * the password. One request at a time. It never forgets a request: a 404 here may come from
 * a proxy or a rollback, and the stored link is often the only copy, so the Requests page
 * decides that.
 */
export async function checkUnseenUploads(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const stored = await getAllRequests();
    keepUnseen(new Set(stored.map((request) => request.id)));
    const open = stored.filter(
      (request) => !request.hasPassword && new Date(request.closesAt).getTime() + SETTLE_MS >= now,
    );
    for (const request of open.slice(0, UNSEEN_MAX_PER_ROUND)) {
      try {
        const access = await openInboxLink(request.inboxFragment);
        const inbox = await api.fetchInbox(request.id, access.inboxToken);
        setUnseen(request.id, countUnseen(request, inbox));
      } catch {
        // Waits for the next round. The Requests page shows what went wrong.
      }
    }
  } finally {
    running = false;
  }
}

/** Starts a round unless one ran a moment ago. A clock that went back starts one too. */
function startRound(): void {
  const now = Date.now();
  if (now >= lastRound && now - lastRound < UNSEEN_MIN_GAP_MS) return;
  lastRound = now;
  void checkUnseenUploads(now).catch(() => {});
}

/**
 * The number of uploads that arrived in requests of this browser since their inbox was
 * last open, checked every few minutes while a SkySend page is visible. Nothing is sent
 * but the inbox tokens a visit to the Requests page sends anyway. The layout turns it off
 * on the pages of share links, so a check never ties the requests to a download or to an
 * upload into someone else's request.
 */
export function useUnseenUploads(enabled: boolean): number {
  const total = useSyncExternalStore(subscribeUnseen, unseenTotal);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (document.visibilityState === "visible") startRound();
    };
    check();
    const timer = setInterval(check, UNSEEN_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled]);

  return total;
}
