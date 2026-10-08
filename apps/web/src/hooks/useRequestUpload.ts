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

/** A random submission ID, 16 bytes as hex. */
function newSubmission(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

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
      // Every request has a brief. One that is missing or does not open was dropped or
      // swapped, and guessing what the requester wanted would only help whoever did that.
      const stored = sender.brief;
      const opened = stored
        ? await decryptRequestBrief(
            { ciphertext: fromBase64url(stored.ciphertext), nonce: fromBase64url(stored.nonce) },
            briefKey,
          ).catch(() => null)
        : null;
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

  /**
   * The send in progress when it has two parts. Files go first, then the note, both marked
   * with one submission so the inbox shows them together. The files reserve the slot of the
   * note as well, and the server holds it for the note. When the files arrived but the note
   * did not, the next send only sends the note, under the same submission and into that slot.
   */
  const pendingRef = useRef<{ submission: string; filesSent: boolean; hold?: string } | null>(null);
  const [filesSent, setFilesSent] = useState(false);
  const [sequence, setSequence] = useState(false);

  /**
   * Sends files, a note, or both as one submission. A note is padded so its length tells
   * little. Resolves once everything is sent or a part failed.
   */
  const send = useCallback(
    async (content: { files?: File[]; note?: NoteBlock[] }) => {
      const access = accessRef.current;
      if (!access || sendingRef.current) return;
      sendingRef.current = true;
      const request = { id, uploadToken: access.uploadToken, publicKey: access.publicKey };
      try {
        const note = content.note ? padNote(serializeNote(content.note)) : undefined;
        // A note alone, or files alone, is one upload. A note after its files is the second
        // part of a submission, also when the files went out in an earlier try.
        const twoParts =
          note !== undefined && (content.files !== undefined || pendingRef.current?.filesSent);
        if (!twoParts) {
          // A submission of its own as well, so a note alone looks like one sent with files.
          const submission = newSubmission();
          await startUpload(
            note === undefined
              ? { files: content.files ?? [], submission, request }
              : { files: [], note, submission, request },
          );
          return;
        }
        const pending = (pendingRef.current ??= { submission: newSubmission(), filesSent: false });
        setSequence(true);
        if (!pending.filesSent && content.files) {
          const sent = await startUpload({
            files: content.files,
            submission: pending.submission,
            reserveNext: true,
            request,
          });
          // Files that did not arrive start over as a new submission. Should they have
          // arrived after all, a retry under the same mark would list them twice.
          if (!sent) {
            pendingRef.current = null;
            return;
          }
          pending.filesSent = true;
          pending.hold = sent.hold;
          setFilesSent(true);
        }
        const sent = await startUpload({
          files: [],
          note,
          submission: pending.submission,
          hold: pending.hold,
          request,
        });
        if (sent) {
          pendingRef.current = null;
          setFilesSent(false);
        }
      } finally {
        sendingRef.current = false;
        setSequence(false);
      }
    },
    [id, startUpload],
  );

  // Between the two parts the upload reads "done" for a moment, which is no delivery yet.
  const delivered = uploadState.phase === "done" && !sequence;
  const failed = uploadState.phase === "error";
  // What is left changed once something arrived, and a failed upload may have given its
  // slot back.
  useEffect(() => {
    if (delivered || failed) refreshStatus();
  }, [delivered, failed, refreshStatus]);
  // A note that finds the request full had no held slot left: the hold ran out or the server
  // restarted. Its files stay alone, and the page says the request is full.
  const fullAfterFiles = failed && uploadState.error === "full";
  useEffect(() => {
    if (!fullAfterFiles || !pendingRef.current?.filesSent) return;
    pendingRef.current = null;
    setFilesSent(false);
  }, [fullAfterFiles]);

  const cancel = useCallback(() => {
    cancelUpload();
    refreshStatus();
  }, [cancelUpload, refreshStatus]);

  /** Starts over for another send, a new submission included. */
  const again = useCallback(() => {
    pendingRef.current = null;
    setFilesSent(false);
    resetUpload();
  }, [resetUpload]);

  // Files and a note go as one submission, which takes two uploads of the request. Once its
  // files arrived, the server holds the slot of its note, which no longer counts as left.
  const both = !!brief && brief.asks.includes("files") && brief.asks.includes("note");
  const uploadsLeft = status?.uploadsLeft ?? 0;
  const sendsLeft = both ? Math.floor(uploadsLeft / 2) + (filesSent ? 1 : 0) : uploadsLeft;

  const overall: RequestUploadPhase =
    phase !== "ready"
      ? phase
      : delivered
        ? "delivered"
        : sequence || BUSY.includes(uploadState.phase)
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
    /** What the last upload used and when, for the technical info of the page. */
    debugInfo: uploadState.debugInfo,
    /** The files of a two-part send arrived, the note did not yet. */
    filesSent,
    /** How many more sends the request takes, a submission of files and a note as one. */
    sendsLeft,
    send,
    again,
    cancel,
  };
}
