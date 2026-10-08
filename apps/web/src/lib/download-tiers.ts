import { createDecryptStream } from "@skysend/crypto";
import { ensureSwController, streamDownloadViaSw } from "@/lib/opfs-download";
import { isSafari, isDevToolsOpen, getBrowserInfo } from "@/lib/utils";

export interface DownloadDebugInfo {
  tier: "sw" | "file-picker" | "blob" | null;
  swPath: string | null;
  browser: string;
  devtools: boolean;
  fileSize: number | null;
  /**
   * `detail` is a measured value or an error shown beside the message, like the average
   * speed. `failed` marks the event a download ended with when it did not finish.
   */
  events: Array<{ time: string; message: string; detail?: string; failed?: boolean }>;
}

/** The encrypted file as the main thread receives it, for tier 2 and 3. */
export interface Ciphertext {
  stream: ReadableStream<Uint8Array>;
  size: number;
  storageBackend: "s3" | "filesystem";
}

/** Where the ciphertext comes from. A normal download and an inbox file differ only here. */
export interface DownloadSource {
  /** The API path, which the Service Worker fetches for tier 1. */
  path: string;
  token: string;
  /** The header the Service Worker sends the token in. */
  tokenHeader: "X-Auth-Token" | "X-Inbox-Token";
  /** Fetches the same endpoint on the main thread, for tier 2 and 3. */
  fetchCiphertext: () => Promise<Ciphertext>;
}

export interface SaveDownloadOptions {
  source: DownloadSource;
  secret: Uint8Array;
  salt: Uint8Array;
  fileKey: CryptoKey;
  filename: string;
  mimeType: string;
  /** Size of the ciphertext. */
  size: number;
  /**
   * Size from the authenticated metadata, which the decrypted stream must match. Undefined
   * only for archives uploaded by older clients, which carry no archive size.
   */
  plaintextSize: number | undefined;
  signal: AbortSignal;
  /** Progress in percent and the bytes received. Starts again at 0 when a tier falls back. */
  onProgress: (progress: number, loaded: number) => void;
  onDebug: (update: (info: DownloadDebugInfo | null) => DownloadDebugInfo | null) => void;
}

/**
 * True for a download the server cut short. Every tier fetches the same
 * ciphertext, so falling back to the next one would only repeat the download.
 */
function isTruncated(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Stream truncation detected");
}

/** A copy of exactly the bytes of a view, which postMessage can take. */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Decrypts a download and hands it to the browser, trying three tiers in order:
 *
 * 1. Service Worker stream, fastest (Chrome, Edge, Brave, Firefox)
 * 2. showSaveFilePicker, zero RAM fallback (Chrome, Edge)
 * 3. Blob, last resort and Safari default (uses the full file size in RAM)
 *
 * A cancel or a truncated stream ends the download instead of falling back.
 */
export async function saveDecryptedDownload(options: SaveDownloadOptions): Promise<void> {
  const {
    source,
    secret,
    salt,
    fileKey,
    filename,
    mimeType,
    size,
    plaintextSize,
    signal,
    onProgress,
    onDebug,
  } = options;
  const event = (message: string) => ({ time: new Date().toISOString(), message });
  const addEvent = (message: string) =>
    onDebug((d) => (d ? { ...d, events: [...d.events, event(message)] } : null));

  // Safari terminates Service Workers aggressively and buffers ReadableStream
  // responses in RAM instead of streaming to disk. For large files the caller
  // shows a warning first.
  const safari = isSafari();
  let downloaded = false;

  // Tier 1: Service Worker streaming decryption (non-Safari browsers)
  try {
    const sw = !safari ? await ensureSwController() : null;
    if (sw) {
      console.info("[SkySend] Download tier: 1 (SW stream)");
      onDebug(() => ({
        tier: "sw",
        swPath: null,
        browser: getBrowserInfo(),
        devtools: isDevToolsOpen(),
        fileSize: size,
        events: [event("SW stream started")],
      }));

      const apiBase = import.meta.env.DEV
        ? (import.meta.env.VITE_API_BASE ?? "http://localhost:3000")
        : window.location.origin;

      await streamDownloadViaSw(
        `${apiBase}${source.path}`,
        source.token,
        ownBuffer(secret),
        ownBuffer(salt),
        filename,
        mimeType,
        size,
        (progress) => onProgress(progress, Math.round((progress / 100) * size)),
        (swPath) => onDebug((d) => (d ? { ...d, swPath } : null)),
        signal,
        () => addEvent("S3 presigned URL received"),
        plaintextSize,
        source.tokenHeader,
      );
      downloaded = true;
    }
  } catch (swErr) {
    // User-initiated cancel - do not fall through to Tier 2/3
    if (swErr instanceof DOMException && swErr.name === "AbortError") throw swErr;
    if (isTruncated(swErr)) throw swErr;
    console.warn("[SkySend] SW stream failed, trying fallback:", swErr);
  }

  /** Fetches the ciphertext and counts what arrives, with a note in the debug log on a stall. */
  const fetchCounted = async () => {
    const { stream, size: total, storageBackend } = await source.fetchCiphertext();
    if (storageBackend === "s3") addEvent("S3 presigned URL received");

    let loaded = 0;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stallFired = false;
    const resetStall = () => {
      if (stallFired) {
        addEvent("Download resumed");
        stallFired = false;
      }
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stallFired = true;
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        addEvent(`Download stalled at ${pct}%`);
      }, 5000);
    };
    resetStall();

    const counted = stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          onProgress(total > 0 ? Math.round((loaded / total) * 100) : 0, loaded);
          resetStall();
          controller.enqueue(chunk);
        },
      }),
    );
    return {
      decrypted: counted.pipeThrough(createDecryptStream(fileKey, plaintextSize)),
      stopStallTimer: () => {
        if (stallTimer) clearTimeout(stallTimer);
      },
    };
  };

  // Tier 2: showSaveFilePicker fallback (Chrome, Edge - if SW failed)
  if (!downloaded && typeof window.showSaveFilePicker === "function") {
    try {
      console.info("[SkySend] Download tier: 2 (showSaveFilePicker)");
      onProgress(0, 0);
      onDebug((d) => ({
        tier: "file-picker",
        swPath: null,
        browser: getBrowserInfo(),
        devtools: isDevToolsOpen(),
        fileSize: size,
        events: [...(d?.events ?? []), event("Save File Picker started")],
      }));
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: filename,
        types:
          mimeType !== "application/octet-stream" ? [{ accept: { [mimeType]: [] } }] : undefined,
      });
      const writable = await fileHandle.createWritable();
      const { decrypted, stopStallTimer } = await fetchCounted();
      await decrypted.pipeTo(writable, { signal });
      stopStallTimer();
      downloaded = true;
    } catch (pickerErr) {
      // User cancelled = AbortError, rethrow to be caught by outer handler
      if (pickerErr instanceof DOMException && pickerErr.name === "AbortError") throw pickerErr;
      // A failed pipeTo() aborts the writable, which discards the partial file.
      if (isTruncated(pickerErr)) throw pickerErr;
      console.warn("[SkySend] showSaveFilePicker failed:", pickerErr);
    }
  }

  // Tier 3: Blob fallback (uses RAM - last resort / Safari default)
  if (!downloaded) {
    console.warn(`[SkySend] Download tier: 3 (Blob fallback${safari ? " - Safari" : ""})`);
    onProgress(0, 0);
    onDebug((d) => ({
      tier: "blob",
      swPath: null,
      browser: getBrowserInfo(),
      devtools: isDevToolsOpen(),
      fileSize: size,
      events: [...(d?.events ?? []), event(`Blob fallback started${safari ? " (Safari)" : ""}`)],
    }));
    const { decrypted, stopStallTimer } = await fetchCounted();
    const reader = decrypted.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) {
        reader.cancel();
        throw new DOMException("Download cancelled by user", "AbortError");
      }
      chunks.push(value);
    }
    stopStallTimer();
    const blob = new Blob(chunks as BlobPart[], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}
