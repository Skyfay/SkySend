/**
 * WebSocket upload transport for streaming encrypted files.
 *
 * Protocol:
 *   1. Open WebSocket on /api/upload/ws
 *   2. Send JSON init message with auth headers
 *   3. Wait for "ready" message with upload ID
 *   4. Stream encrypted data as binary frames (256 KB)
 *   5. Send JSON "finalize" message
 *   6. Wait for "done" confirmation
 */

const FRAME_SIZE = 256 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 2 * 1024 * 1024;
const READY_TIMEOUT_MS = 10_000;

export async function uploadWsTransport(
  server: string,
  headers: Record<string, string>,
  encryptedStream: ReadableStream<Uint8Array>,
  encryptedSize: number,
  speedLimit: number,
  onProgress: (loaded: number) => void,
  /** Called once all binary frames are queued and the client is waiting for the
   *  server's "done" confirmation.  Use this to show a "Finalizing..." state. */
  onFinalize?: () => void,
): Promise<{ id: string }> {
  const wsUrl = new URL("/api/upload/ws", server);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";

  const ws = new WebSocket(wsUrl.toString());

  let fatalError: Error | null = null;
  let doneId: string | null = null;
  let readyId: string | null = null;
  const readyWaiters: Array<() => void> = [];
  const doneWaiters: Array<() => void> = [];

  const notifyReady = () => { for (const f of readyWaiters.splice(0)) f(); };
  const notifyDone = () => { for (const f of doneWaiters.splice(0)) f(); };

  ws.addEventListener("message", (evt) => {
    if (typeof evt.data !== "string") return;
    let msg: { type?: string; id?: string; message?: string };
    try {
      msg = JSON.parse(evt.data as string);
    } catch {
      return;
    }
    if (msg.type === "ready" && typeof msg.id === "string") {
      readyId = msg.id;
      notifyReady();
    } else if (msg.type === "done" && typeof msg.id === "string") {
      doneId = msg.id;
      notifyReady();
      notifyDone();
    } else if (msg.type === "error") {
      fatalError = new Error(msg.message ?? "Server error");
      notifyReady();
      notifyDone();
    }
  });

  ws.addEventListener("close", (evt: CloseEvent) => {
    if (!doneId && !fatalError) {
      fatalError = new Error(`WebSocket closed unexpectedly (code=${evt.code})`);
    }
    notifyReady();
    notifyDone();
  });
  ws.addEventListener("error", () => {
    if (!fatalError) fatalError = new Error("WebSocket error");
    notifyReady();
    notifyDone();
  });

  // Wait for open
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 10_000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket handshake failed")); });
  });

  try {
    ws.send(JSON.stringify({
      type: "init",
      headers: {
        authToken: headers["X-Auth-Token"]!,
        ownerToken: headers["X-Owner-Token"]!,
        salt: headers["X-Salt"]!,
        maxDownloads: parseInt(headers["X-Max-Downloads"]!, 10),
        expireSec: parseInt(headers["X-Expire-Sec"]!, 10),
        fileCount: parseInt(headers["X-File-Count"]!, 10),
        contentLength: encryptedSize,
        hasPassword: headers["X-Has-Password"] === "true",
        passwordSalt: headers["X-Password-Salt"],
        passwordAlgo: headers["X-Password-Algo"],
      },
    }));

    // Wait for ready
    await new Promise<void>((resolve, reject) => {
      if (readyId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WebSocket ready timed out")), READY_TIMEOUT_MS);
      readyWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
    if (fatalError) throw fatalError;
    if (!readyId) throw new Error("Server did not return an upload id");

    // Stream frames
    const reader = encryptedStream.getReader();
    let loaded = 0;
    let carry: Uint8Array | null = null;
    const sendStartedAt = Date.now();

    const drain = async () => {
      while ((ws as unknown as { bufferedAmount: number }).bufferedAmount > LOW_WATER) {
        if (fatalError) throw fatalError;
        await new Promise((r) => setTimeout(r, 20));
      }
    };

    const sendFrame = async (frame: Uint8Array) => {
      if (fatalError) throw fatalError;
      if ((ws as unknown as { bufferedAmount: number }).bufferedAmount > HIGH_WATER) await drain();

      if (speedLimit > 0 && loaded > 0) {
        const elapsedMs = Date.now() - sendStartedAt;
        const expectedMs = (loaded / speedLimit) * 1000;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 1) await new Promise((r) => setTimeout(r, delayMs));
      }

      const copy = new Uint8Array(frame.byteLength);
      copy.set(frame);
      ws.send(copy.buffer as ArrayBuffer);
      loaded += frame.byteLength;
      onProgress(loaded);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let buf: Uint8Array;
      if (carry && carry.byteLength > 0) {
        buf = new Uint8Array(carry.byteLength + value.byteLength);
        buf.set(carry);
        buf.set(value, carry.byteLength);
        carry = null;
      } else {
        buf = value;
      }

      let offset = 0;
      while (buf.byteLength - offset >= FRAME_SIZE) {
        await sendFrame(buf.subarray(offset, offset + FRAME_SIZE));
        offset += FRAME_SIZE;
      }
      if (offset < buf.byteLength) {
        carry = buf.slice(offset);
      }
    }
    if (carry && carry.byteLength > 0) {
      await sendFrame(carry);
    }

    if (fatalError) throw fatalError;

    // Drain the WebSocket send buffer to zero before sending "finalize".
    // After the last ws.send() call, Node.js may still hold GBs of data in its
    // internal write queue because bufferedAmount reflects the WebSocket-layer
    // queue, not the OS TCP socket buffer.  Waiting for zero ensures all frames
    // have been handed off to the TCP layer before the DONE timer starts, so the
    // timeout only needs to cover the OS-level flush + server finalization - not
    // the full remaining transit of the upload payload.
    while ((ws as unknown as { bufferedAmount: number }).bufferedAmount > 0) {
      if (fatalError) throw fatalError;
      await new Promise((r) => setTimeout(r, 50));
    }

    onFinalize?.();

    // Finalize
    ws.send(JSON.stringify({ type: "finalize" }));

    // Dynamic timeout: 5 min base plus 2 s/MB assuming 4 Mbps minimum bandwidth.
    // For large files on slow remote connections the upload payload may still be
    // in transit (in the OS TCP buffer) after the client shows 100%, so the
    // server's "done" reply may arrive long after the progress bar completes.
    const doneTimeoutMs = Math.max(5 * 60_000, Math.ceil(encryptedSize / (1024 * 1024)) * 2_000);
    await new Promise<void>((resolve, reject) => {
      if (doneId || fatalError) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error("WebSocket finalize timed out")), doneTimeoutMs);
      doneWaiters.push(() => { clearTimeout(timer); resolve(); });
    });

    if (fatalError) throw fatalError;
    if (!doneId) throw new Error("Server did not confirm upload completion");
    return { id: doneId };
  } finally {
    try { ws.close(); } catch { /* ignore */ }
  }
}
