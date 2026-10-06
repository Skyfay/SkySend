import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeUploadFragment,
  decryptRequestTitle,
  deriveLinkKeys,
  fromBase64url,
  toBase64url,
} from "@skysend/crypto";
import * as api from "@/lib/api";
import { sanitizeTitle } from "@/lib/file-request";
import { useUpload, type UploadPhase } from "@/hooks/useUpload";

export type RequestUploadPhase =
  | "loading"
  | "invalid"
  | "gone"
  | "error"
  | "ready"
  | "uploading"
  | "delivered";

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
 * still takes, shows the requester's title, and uploads into the request through useUpload.
 */
export function useRequestUpload(id: string, fragment: string) {
  const {
    upload: startUpload,
    reset: resetUpload,
    cancel: cancelUpload,
    ...uploadState
  } = useUpload();
  const [phase, setPhase] = useState<"loading" | "invalid" | "gone" | "error" | "ready">("loading");
  const [status, setStatus] = useState<api.SenderRequest | null>(null);
  const [title, setTitle] = useState<string | null>(null);
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
      let titleKey: CryptoKey;
      try {
        const { publicKey, linkSecret } = await decodeUploadFragment(fragment);
        const keys = await deriveLinkKeys(linkSecret, publicKey);
        access = { publicKey, uploadToken: toBase64url(keys.uploadToken) };
        titleKey = keys.titleKey;
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
      if (sender.title) {
        // The requester wrote it, and a broken one just stays hidden.
        const text = await decryptRequestTitle(
          {
            ciphertext: fromBase64url(sender.title.ciphertext),
            nonce: fromBase64url(sender.title.nonce),
          },
          titleKey,
        ).catch(() => null);
        if (!cancelled) setTitle(text === null ? null : sanitizeTitle(text));
      }
      if (cancelled) return;
      setStatus(sender);
      setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fragment]);

  const send = useCallback(
    async (files: File[]) => {
      const access = accessRef.current;
      if (!access || sendingRef.current) return;
      sendingRef.current = true;
      try {
        await startUpload({
          files,
          request: { id, uploadToken: access.uploadToken, publicKey: access.publicKey },
        });
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
    title,
    uploadPhase: uploadState.phase,
    progress: uploadState.progress,
    speed: uploadState.speed,
    uploadError: failed ? uploadState.error : null,
    send,
    again: resetUpload,
    cancel,
  };
}
