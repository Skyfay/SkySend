import type { Inbox } from "@/lib/api";
import type { StoredRequest } from "@/lib/upload-store";

/**
 * How many uploads arrived in each request since its inbox was last open in this browser.
 * Feeds the dot in the navigation and the count on the Requests page. Lives in memory only,
 * the IDs it compares against are in the stored request.
 */
const counts = new Map<string, number>();
const listeners = new Set<() => void>();
let total = 0;

function emit() {
  total = 0;
  for (const count of counts.values()) total += count;
  for (const listener of listeners) listener();
}

/** The uploads in the inbox that it did not list the last time it was open here. */
export function countUnseen(request: StoredRequest, inbox: Pick<Inbox, "uploads">): number {
  const seen = new Set(request.seenUploads ?? []);
  return inbox.uploads.filter((upload) => !seen.has(upload.id)).length;
}

export function setUnseen(id: string, count: number): void {
  if ((counts.get(id) ?? 0) === count) return;
  if (count > 0) counts.set(id, count);
  else counts.delete(id);
  emit();
}

/** Forgets the counts of every request this browser no longer keeps. */
export function keepUnseen(ids: ReadonlySet<string>): void {
  let changed = false;
  for (const id of counts.keys()) {
    if (!ids.has(id)) {
      counts.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

export function subscribeUnseen(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function unseenTotal(): number {
  return total;
}

export function unseenFor(id: string): number {
  return counts.get(id) ?? 0;
}
