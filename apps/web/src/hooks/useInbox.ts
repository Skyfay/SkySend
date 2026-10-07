import { useCallback, useEffect, useRef, useState } from "react";
import { expectedPlaintextSize, type Argon2idHashFn } from "@skysend/crypto";
import * as api from "@/lib/api";
import { saveDecryptedDownload } from "@/lib/download-tiers";
import type { ReadBlock } from "@skysend/note-format";
import {
  inboxNeedsPassword,
  noteTooLarge,
  openInbox,
  openInboxLink,
  readInboxNote,
  sanitizeFilename,
  NoteTooLargeError,
  type InboxAccess,
  type OpenedInbox,
  type OpenedUpload,
} from "@/lib/file-request";
import { getRequest, markUploadsSeen, removeRequest } from "@/lib/upload-store";
import { setUnseen } from "@/lib/unseen-uploads";

export type InboxPhase =
  | "invalid"
  | "needs-password"
  | "unlocking"
  | "loading"
  | "ready"
  | "gone"
  | "deleted"
  | "locked"
  | "error";

/** Why a password did not open the inbox. */
export type InboxPasswordError = "wrong-password" | "rate-limited" | null;

interface InboxState {
  phase: InboxPhase;
  passwordError: InboxPasswordError;
  error: string | null;
  inbox: api.Inbox | null;
  opened: OpenedInbox | null;
  /** Progress in percent of each download that is running. */
  downloads: Record<string, number>;
  /** Uploads that arrived since the inbox was last open in this browser. */
  fresh: ReadonlySet<string>;
}

/**
 * The name and type a download is saved under. A sender wrote the name, so it is cleaned,
 * and the type it claims is ignored, so the browser never treats the file as a page.
 */
export function downloadName(entry: OpenedUpload): { filename: string; mimeType: string } {
  const metadata = entry.file?.metadata;
  if (metadata?.type === "single") {
    return { filename: sanitizeFilename(metadata.name), mimeType: "application/octet-stream" };
  }
  return { filename: "archive.zip", mimeType: "application/zip" };
}

/**
 * The inbox of a file request, opened with the key in the link. Nothing here reaches the
 * server but the two inbox tokens. Listing never counts as a download, only a click does.
 */
export function useInbox(id: string, fragment: string, argon2id: Argon2idHashFn) {
  // Whether the link is complete and needs a password shows without the server.
  const [linkState] = useState<"invalid" | "needs-password" | "open">(() => {
    try {
      return inboxNeedsPassword(fragment) ? "needs-password" : "open";
    } catch {
      return "invalid";
    }
  });
  const [state, setState] = useState<InboxState>({
    phase: linkState === "open" ? "loading" : linkState,
    passwordError: null,
    error: null,
    inbox: null,
    opened: null,
    downloads: {},
    fresh: new Set(),
  });
  const accessRef = useRef<InboxAccess | null>(null);
  const hasPasswordRef = useRef(linkState === "needs-password");
  const abortRef = useRef<Map<string, AbortController>>(new Map());

  const load = useCallback(
    async (access: InboxAccess) => {
      try {
        // This browser knows the one link of a request it made. Another link for the same ID
        // is made up, and asking the server with it could only count a failed attempt.
        const known = await getRequest(id).catch(() => undefined);
        if (known && known.inboxFragment !== fragment) {
          setState((s) => ({ ...s, phase: "invalid" }));
          return;
        }
        const inbox = await api.fetchInbox(id, access.inboxToken);
        const opened = await openInbox(id, inbox, access.keys);
        accessRef.current = access;
        // What was new stays marked until the page is left, even after a refresh.
        const ids = inbox.uploads.map((upload) => upload.id);
        const seenBefore = await markUploadsSeen(id, fragment, ids).catch(() => null);
        if (seenBefore) setUnseen(id, 0);
        setState((s) => ({
          ...s,
          phase: "ready",
          passwordError: null,
          error: null,
          inbox,
          opened,
          fresh: seenBefore
            ? new Set([...s.fresh, ...ids.filter((uploadId) => !seenBefore.has(uploadId))])
            : s.fresh,
        }));
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 429) {
          // Without a password there is nothing to type, so asking for one would mislead.
          setState((s) =>
            hasPasswordRef.current
              ? { ...s, phase: "needs-password", passwordError: "rate-limited" }
              : { ...s, phase: "locked" },
          );
          return;
        }
        if (err instanceof api.ApiError && err.status === 404) {
          // With a password a wrong one and a deleted request look the same to the server.
          if (hasPasswordRef.current) {
            setState((s) => ({ ...s, phase: "needs-password", passwordError: "wrong-password" }));
            return;
          }
          // Anyone who knows the ID can make up an inbox link that leads here. Only the
          // link this browser stored for the request may remove it from the list.
          const stored = await getRequest(id).catch(() => undefined);
          if (stored?.inboxFragment === fragment) {
            await removeRequest(id).catch(() => {});
            setUnseen(id, 0);
          }
          setState((s) => ({ ...s, phase: "gone" }));
          return;
        }
        // What the server says is worth showing. What the client threw is not for the page.
        const message = err instanceof api.ApiError ? err.message : null;
        setState((s) => ({ ...s, phase: "error", error: message }));
      }
    },
    [id, fragment],
  );

  useEffect(() => {
    if (linkState !== "open") return;
    openInboxLink(fragment)
      .then(load)
      .catch(() => setState((s) => ({ ...s, phase: "invalid" })));
  }, [linkState, fragment, load]);

  const unlock = useCallback(
    async (password: string) => {
      setState((s) => ({ ...s, phase: "unlocking", passwordError: null }));
      try {
        await load(await openInboxLink(fragment, password, argon2id));
      } catch {
        setState((s) => ({ ...s, phase: "invalid" }));
      }
    },
    [fragment, argon2id, load],
  );

  const refresh = useCallback(async () => {
    if (accessRef.current) await load(accessRef.current);
  }, [load]);

  const setDownload = (uploadId: string, progress: number | null) =>
    setState((s) => {
      const downloads = { ...s.downloads };
      if (progress === null) delete downloads[uploadId];
      else downloads[uploadId] = progress;
      return { ...s, downloads };
    });

  /** Counts one more download of an upload in the list, as the server just did. */
  const countDownload = useCallback(
    (uploadId: string) =>
      setState((s) => ({
        ...s,
        opened: s.opened && {
          ...s.opened,
          uploads: s.opened.uploads.map((u) =>
            u.upload.id === uploadId
              ? { ...u, upload: { ...u.upload, downloadCount: u.upload.downloadCount + 1 } }
              : u,
          ),
        },
      })),
    [],
  );

  /** Decrypts one upload and hands it to the browser. Throws what the pipeline throws. */
  const download = useCallback(
    async (entry: OpenedUpload) => {
      const access = accessRef.current;
      if (!access || !entry.file) return;
      const uploadId = entry.upload.id;
      const controller = new AbortController();
      abortRef.current.set(uploadId, controller);
      setDownload(uploadId, 0);
      const { filename, mimeType } = downloadName(entry);
      try {
        await saveDecryptedDownload({
          source: {
            path: api.inboxFilePath(id, uploadId),
            token: access.inboxToken,
            tokenHeader: "X-Inbox-Token",
            fetchCiphertext: () => api.downloadInboxFile(id, uploadId, access.inboxToken),
          },
          secret: entry.file.secret,
          salt: entry.file.salt,
          fileKey: entry.file.keys.fileKey,
          filename,
          mimeType,
          size: entry.upload.size,
          plaintextSize: expectedPlaintextSize(entry.file.metadata),
          signal: controller.signal,
          onProgress: (progress) => setDownload(uploadId, progress),
          onDebug: () => null,
        });
        countDownload(uploadId);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      } finally {
        abortRef.current.delete(uploadId);
        setDownload(uploadId, null);
      }
    },
    [id, countDownload],
  );

  /**
   * Opens a note in this page. It counts as a download, and its plaintext lives in the state
   * of the caller only, never in a store. `maxSize` is the largest note the instance takes.
   */
  const openNote = useCallback(
    async (
      entry: OpenedUpload,
      maxSize: number,
    ): Promise<{ blocks: ReadBlock[]; unreadable: boolean }> => {
      const access = accessRef.current;
      if (!access || entry.file?.metadata.type !== "note") throw new Error("Not a note");
      // Checked before the fetch, so a crafted note costs no download and no memory.
      if (noteTooLarge(entry.file, maxSize)) throw new NoteTooLargeError("Note too large");
      const { stream } = await api.downloadInboxFile(id, entry.upload.id, access.inboxToken);
      countDownload(entry.upload.id);
      return readInboxNote(entry.file, stream, maxSize);
    },
    [id, countDownload],
  );

  const cancelDownload = useCallback((uploadId: string) => {
    abortRef.current.get(uploadId)?.abort();
  }, []);

  const deleteFile = useCallback(
    async (uploadId: string) => {
      const access = accessRef.current;
      if (!access) return;
      await api.deleteInboxFile(id, uploadId, access.ownerToken);
      setState((s) => ({
        ...s,
        opened: s.opened && {
          ...s.opened,
          uploads: s.opened.uploads.filter((u) => u.upload.id !== uploadId),
        },
      }));
    },
    [id],
  );

  const close = useCallback(async () => {
    const access = accessRef.current;
    if (!access) return;
    await api.closeRequest(id, access.ownerToken);
    setState((s) => ({ ...s, inbox: s.inbox && { ...s.inbox, open: false } }));
  }, [id]);

  const deleteAll = useCallback(async () => {
    const access = accessRef.current;
    if (!access) return;
    await api.deleteRequest(id, access.ownerToken);
    await removeRequest(id).catch(() => {});
    accessRef.current = null;
    setState((s) => ({ ...s, phase: "deleted", inbox: null, opened: null }));
  }, [id]);

  return {
    ...state,
    unlock,
    refresh,
    download,
    openNote,
    cancelDownload,
    deleteFile,
    close,
    deleteAll,
  };
}
