import { useCallback, useState, useSyncExternalStore } from "react";
import type { Argon2idHashFn, RequestAsk } from "@skysend/crypto";
import type { NoteBlock } from "@skysend/note-format";
import * as api from "@/lib/api";
import {
  openInboxLink,
  prepareRequest,
  requestLinks,
  requestOutlived,
  type RequestLinks,
} from "@/lib/file-request";
import { getAllRequests, removeRequest, saveRequest, type StoredRequest } from "@/lib/upload-store";
import { countUnseen, keepUnseen, setUnseen } from "@/lib/unseen-uploads";

export interface NewRequestOptions {
  title: string;
  asks: RequestAsk[];
  /** The fields a sender fills in, when a note is asked for. Empty or null for a free note. */
  template: NoteBlock[] | null;
  expireSec: number;
  maxUploads: number;
  maxSize: number;
  /** How often the requester can download each upload. */
  downloads: number;
  password: string;
}

/** Why creating a request failed, as the key of a message. */
export type CreateRequestError = "signInRequired" | "dailyLimit" | "failed";

/**
 * Creates a request: keys and vault in this browser, then the server row, then the entry
 * for My Links. The secrets of both links stay in this browser.
 */
export function useCreateRequest(argon2id: Argon2idHashFn) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<CreateRequestError | null>(null);
  const [created, setCreated] = useState<(RequestLinks & { request: StoredRequest }) | null>(null);

  const create = useCallback(
    async (options: NewRequestOptions) => {
      setCreating(true);
      setError(null);
      try {
        const title = options.title.trim();
        const prepared = await prepareRequest({
          title: title || undefined,
          asks: options.asks,
          template: options.template,
          password: options.password || undefined,
          argon2id,
        });
        const { id, closesAt } = await api.createRequest({
          ...prepared.body,
          expireSec: options.expireSec,
          maxUploads: options.maxUploads,
          maxSize: options.maxSize,
          downloads: options.downloads,
        });
        const request: StoredRequest = {
          id,
          inboxFragment: prepared.inboxFragment,
          uploadFragment: prepared.uploadFragment,
          hasPassword: prepared.body.hasPassword,
          title: title || undefined,
          closesAt,
          createdAt: new Date().toISOString(),
          seenUploads: [],
          asks: options.asks,
        };
        // The request exists on the server now. If this browser cannot keep it, the two
        // links are still shown, so they can be saved by hand.
        try {
          await saveRequest(request);
        } catch {
          // Shown anyway, see above.
        }
        setCreated({ ...requestLinks(request), request });
      } catch (err) {
        const status = err instanceof api.ApiError ? err.status : 0;
        setError(status === 401 ? "signInRequired" : status === 429 ? "dailyLimit" : "failed");
      } finally {
        setCreating(false);
      }
    },
    [argon2id],
  );

  const reset = useCallback(() => {
    setCreated(null);
    setError(null);
  }, []);

  return { create, creating, error, created, reset };
}

// The same small external store as the upload history, to trigger a reload.
let refreshCounter = 0;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return refreshCounter;
}
function emitRefresh() {
  refreshCounter++;
  for (const l of listeners) l();
}

/** A stored request with what the server says about it right now. */
export interface RequestWithStatus extends StoredRequest {
  /** The inbox without its uploads opened, or null while loading, with a password, or on an error. */
  inbox: api.Inbox | null;
  loading: boolean;
}

/**
 * The requests created in this browser. A request without a password shows how many files
 * arrived, which needs only the token from its own link. One with a password stays closed
 * here until its inbox is opened. `retentionSec` is how long the instance keeps an upload,
 * which decides when a request the server no longer has may be forgotten.
 */
export function useRequestHistory(retentionSec?: number) {
  const [requests, setRequests] = useState<RequestWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const stored = await getAllRequests();
    setRequests(stored.map((r) => ({ ...r, inbox: null, loading: !r.hasPassword })));
    setLoading(false);
    keepUnseen(new Set(stored.map((r) => r.id)));

    for (const request of stored) {
      if (request.hasPassword) continue;
      try {
        const access = await openInboxLink(request.inboxFragment);
        const inbox = await api.fetchInbox(request.id, access.inboxToken);
        setUnseen(request.id, countUnseen(request, inbox));
        setRequests((prev) =>
          prev.map((r) => (r.id === request.id ? { ...r, inbox, loading: false } : r)),
        );
      } catch (err) {
        const gone = err instanceof api.ApiError && err.status === 404;
        // Nothing the server no longer lists is new.
        if (gone) setUnseen(request.id, 0);
        // A 404 before every upload ran out shows the request as unavailable instead, since
        // the stored link is often the only copy of the inbox.
        if (gone && requestOutlived(request.closesAt, retentionSec)) {
          await removeRequest(request.id);
          setRequests((prev) => prev.filter((r) => r.id !== request.id));
        } else {
          setRequests((prev) =>
            prev.map((r) => (r.id === request.id ? { ...r, loading: false } : r)),
          );
        }
      }
    }
  }, [retentionSec]);

  // Load on mount and whenever a refresh is triggered.
  const version = useSyncExternalStore(subscribe, getSnapshot);
  const [lastVersion, setLastVersion] = useState(-1);
  if (lastVersion !== version) {
    setLastVersion(version);
    void load();
  }

  /**
   * Deletes a request on the server with everything in it. One with a password can only be
   * forgotten here, since its owner token needs the password, so the inbox does the rest.
   */
  const remove = useCallback(async (request: StoredRequest) => {
    if (!request.hasPassword) {
      const access = await openInboxLink(request.inboxFragment);
      try {
        await api.deleteRequest(request.id, access.ownerToken);
      } catch (err) {
        // Gone already, so forgetting it here is all that is left.
        if (!(err instanceof api.ApiError && err.status === 404)) throw err;
      }
    }
    await removeRequest(request.id);
    setUnseen(request.id, 0);
    setRequests((prev) => prev.filter((r) => r.id !== request.id));
  }, []);

  return { requests, loading, refresh: emitRefresh, remove };
}
