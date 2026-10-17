import { createDecryptStream } from "@skysend/crypto";
import { createOpfsFile } from "@/lib/opfs-file";
import { ensureSwController, streamDownloadViaSw } from "@/lib/sw-download";
import { isSafari, isFirefox, isDevToolsOpen, getBrowserInfo } from "@/lib/utils";

/** Open DevTools only matter in Firefox, whose network panel keeps a download in memory. */
const firefoxDevToolsOpen = () => isFirefox() && isDevToolsOpen();

export interface DownloadDebugInfo {
  tier: "sw" | "file-picker" | "opfs" | "blob" | null;
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
  /**
   * Base nonce from the authenticated metadata, which the header of the stream must match.
   * Undefined for uploads of clients that did not put one in.
   */
  baseNonce: Uint8Array | undefined;
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
 * Decrypts a download and hands it to the browser, trying four tiers in order:
 *
 * 1. Service Worker stream, fastest (Chrome, Edge, Brave, Firefox)
 * 2. showSaveFilePicker, zero RAM fallback (Chrome, Edge)
 * 3. OPFS, the file written to disk and handed over from there (Safari)
 * 4. Blob, last resort (uses the full file size in RAM)
 *
 * A cancel or a truncated stream ends the download instead of falling back, and so does any
 * failure once tier 3 or 4 fetched the file, since the fetch used up a download of the share.
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
    baseNonce,
    signal,
    onProgress,
    onDebug,
  } = options;
  const event = (message: string, detail?: string) => ({
    time: new Date().toISOString(),
    message,
    ...(detail ? { detail } : {}),
  });
  const addEvent = (message: string) =>
    onDebug((d) => (d ? { ...d, events: [...d.events, event(message)] } : null));
  // Why a tier was passed over, shown before the one that ran, so a report of a download that
  // landed in the Blob tier says what stopped the faster ones.
  const passed: ReturnType<typeof event>[] = [];
  const pass = (message: string, detail?: string) => passed.push(event(message, detail));

  // Safari terminates Service Workers aggressively and buffers ReadableStream
  // responses in RAM instead of streaming to disk. For large files the caller
  // shows a warning first.
  const safari = isSafari();
  let downloaded = false;

  // Tier 1: Service Worker streaming decryption (non-Safari browsers)
  try {
    if (safari) pass("Service Worker skipped", "Safari never streams it into a download");
    const sw = !safari
      ? await ensureSwController((reason) => pass("Service Worker not available", reason))
      : null;
    if (sw) {
      console.info("[SkySend] Download tier: 1 (SW stream)");
      onDebug(() => ({
        tier: "sw",
        swPath: null,
        browser: getBrowserInfo(),
        devtools: firefoxDevToolsOpen(),
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
        baseNonce ? ownBuffer(baseNonce) : undefined,
      );
      downloaded = true;
    }
  } catch (swErr) {
    // User-initiated cancel - do not fall through to Tier 2/3
    if (swErr instanceof DOMException && swErr.name === "AbortError") throw swErr;
    if (isTruncated(swErr)) throw swErr;
    console.warn("[SkySend] SW stream failed, trying fallback:", swErr);
    pass("SW stream failed", swErr instanceof Error ? swErr.message.slice(0, 200) : undefined);
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
      decrypted: counted.pipeThrough(createDecryptStream(fileKey, plaintextSize, baseNonce)),
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
        devtools: firefoxDevToolsOpen(),
        fileSize: size,
        events: [...(d?.events ?? []), ...passed.splice(0), event("Save File Picker started")],
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
      pass(
        "Save File Picker failed",
        pickerErr instanceof Error ? pickerErr.message.slice(0, 200) : undefined,
      );
    }
  } else if (!downloaded) {
    pass("Save File Picker not available", "This browser has none");
  }

  // Tier 3: OPFS. Checks everything before it fetches, so a browser without room falls through.
  if (!downloaded) {
    const disk = await createOpfsFile(plaintextSize ?? size, (reason) =>
      pass("OPFS not used", reason),
    );
    if (disk) {
      console.info("[SkySend] Download tier: 3 (OPFS)");
      onProgress(0, 0);
      onDebug((d) => ({
        tier: "opfs",
        swPath: null,
        browser: getBrowserInfo(),
        devtools: firefoxDevToolsOpen(),
        fileSize: size,
        events: [...(d?.events ?? []), ...passed.splice(0), event("OPFS file started")],
      }));
      let stopStallTimer = () => {};
      try {
        const counted = await fetchCounted();
        stopStallTimer = counted.stopStallTimer;
        const reader = counted.decrypted.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (signal.aborted) {
            await reader.cancel();
            throw new DOMException("Download cancelled by user", "AbortError");
          }
          await disk.write(value);
        }
        disk.save(await disk.finish(), filename);
        downloaded = true;
      } catch (opfsErr) {
        disk.abort();
        throw opfsErr;
      } finally {
        stopStallTimer();
      }
    }
  }

  // Tier 4: Blob fallback (uses RAM - last resort)
  if (!downloaded) {
    console.warn(`[SkySend] Download tier: 4 (Blob fallback${safari ? " - Safari" : ""})`);
    onProgress(0, 0);
    onDebug((d) => ({
      tier: "blob",
      swPath: null,
      browser: getBrowserInfo(),
      devtools: firefoxDevToolsOpen(),
      fileSize: size,
      events: [
        ...(d?.events ?? []),
        ...passed.splice(0),
        event(`Blob fallback started${safari ? " (Safari)" : ""}`),
      ],
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
    // Never the sender's type: a blob: URL belongs to this origin, and a browser that ignores
    // the download attribute would open a text/html one as a page of the instance.
    const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
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
