import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeUploadFragment,
  decryptRequestBrief,
  deriveLinkKeys,
  fromBase64url,
  toBase64url,
  type RequestAsk,
} from "@skysend/crypto";
import { padNote, parseTemplate, serializeNote, type NoteBlock } from "@skysend/note-format";
import * as api from "@/lib/api";
import { sanitizeTitle } from "@/lib/file-request";
import { useUpload, type UploadPhase } from "@/hooks/useUpload";

export type RequestUploadPhase =
  | "loading"
  | "invalid"
  | "broken"
  | "gone"
  | "error"
  | "ready"
  | "uploading"
  | "delivered";

/** What the requester asked for, read from the brief. */
export interface SenderBrief {
  /** Cleaned for showing, or null when there is none. */
  title: string | null;
  asks: RequestAsk[];
  /** The blocks to fill in, or null for a note written freely. */
  template: NoteBlock[] | null;
}

/** The keys behind an upload link. The public key comes only from the link, never from the server. */
interface LinkAccess {
  publicKey: Uint8Array;
  uploadToken: string;
}

/** A request that was deleted, or a server that does not offer requests. */
function isGone(err: unknown): boolean {
  return err instanceof api.ApiError && (err.status === 404 || err.status === 403);
}

const BUSY: UploadPhase[] = ["zipping", "uploading", "saving-meta"];

/**
 * The sender side of a file request: reads the link, asks the server how much the request
 * still takes, reads the requester's brief, and uploads files or a note into the request
 * through useUpload.
 */
export function useRequestUpload(id: string, fragment: string) {
  const {
    upload: startUpload,
    reset: resetUpload,
    cancel: cancelUpload,
    ...uploadState
  } = useUpload();
  const [phase, setPhase] = useState<"loading" | "invalid" | "broken" | "gone" | "error" | "ready">(
    "loading",
  );
  const [status, setStatus] = useState<api.SenderRequest | null>(null);
  const [brief, setBrief] = useState<SenderBrief | null>(null);
  const accessRef = useRef<LinkAccess | null>(null);
  /** Set at the click already, so a double click cannot open two uploads. */
  const sendingRef = useRef(false);

  /** Asks the server again how much the request still takes. */
  const refreshStatus = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    api
      .fetchRequestForSender(id, access.uploadToken)
      .then(setStatus)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let access: LinkAccess;
      let briefKey: CryptoKey;
      try {
        const { publicKey, linkSecret } = await decodeUploadFragment(fragment);
        const keys = await deriveLinkKeys(linkSecret, publicKey);
        access = { publicKey, uploadToken: toBase64url(keys.uploadToken) };
        briefKey = keys.briefKey;
      } catch {
        if (!cancelled) setPhase("invalid");
        return;
      }
      if (cancelled) return;
      accessRef.current = access;
      let sender: api.SenderRequest;
      try {
        sender = await api.fetchRequestForSender(id, access.uploadToken);
      } catch (err) {
        if (!cancelled) setPhase(isGone(err) ? "gone" : "error");
        return;
      }
      if (cancelled) return;
      // Every request has a brief. One that does not open was dropped or swapped, and
      // guessing what the requester wanted would only help whoever did that.
      const opened = await decryptRequestBrief(
        {
          ciphertext: fromBase64url(sender.brief.ciphertext),
          nonce: fromBase64url(sender.brief.nonce),
        },
        briefKey,
      ).catch(() => null);
      if (cancelled) return;
      if (!opened) {
        setPhase("broken");
        return;
      }
      let template: NoteBlock[] | null = null;
      if (opened.asks.includes("note") && opened.template) {
        try {
          template = parseTemplate(opened.template);
        } catch {
          // A template nothing in can be filled in leaves a note written freely.
          template = null;
        }
      }
      const title = opened.title === null ? "" : sanitizeTitle(opened.title);
      setBrief({ title: title || null, asks: opened.asks, template });
      setStatus(sender);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fragment]);

  /** Sends files, or with `note` the blocks of a note, padded so its length tells little. */
  const send = useCallback(
    async (content: { files: File[] } | { note: NoteBlock[] }) => {
      const access = accessRef.current;
      if (!access || sendingRef.current) return;
      sendingRef.current = true;
      try {
        const request = { id, uploadToken: access.uploadToken, publicKey: access.publicKey };
        await startUpload(
          "note" in content
            ? { files: [], note: padNote(serializeNote(content.note)), request }
            : { files: content.files, request },
        );
      } finally {
        sendingRef.current = false;
      }
    },
    [id, startUpload],
  );

  // What is left changed once something arrived, and a failed upload may have given its
  // slot back.
  const delivered = uploadState.phase === "done";
  const failed = uploadState.phase === "error";
  useEffect(() => {
    if (delivered || failed) refreshStatus();
  }, [delivered, failed, refreshStatus]);

  const cancel = useCallback(() => {
    cancelUpload();
    refreshStatus();
  }, [cancelUpload, refreshStatus]);

  const overall: RequestUploadPhase =
    phase !== "ready"
      ? phase
      : delivered
        ? "delivered"
        : BUSY.includes(uploadState.phase)
          ? "uploading"
          : "ready";

  return {
    phase: overall,
    status,
    brief,
    uploadPhase: uploadState.phase,
    progress: uploadState.progress,
    speed: uploadState.speed,
    uploadError: failed ? uploadState.error : null,
    send,
    again: resetUpload,
    cancel,
  };
}
