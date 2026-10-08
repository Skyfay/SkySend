import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { createTestStorage } from "./helpers.js";
import type { FileStorage } from "../src/storage/filesystem.js";

vi.mock("../src/lib/config.js", () => ({
  getConfig: vi.fn(),
  loadConfig: vi.fn(),
}));

import { getConfig, type Config } from "../src/lib/config.js";
import { createChunkedUploads, MIN_PROGRESS_BYTES } from "../src/lib/chunked-upload.js";

const MINUTE = 60 * 1000;

/** The only settings the session layer reads. */
function useConfig(overrides: { FILE_UPLOAD_SPEED_LIMIT?: number } = {}) {
  vi.mocked(getConfig).mockReturnValue({
    FILE_UPLOAD_CONCURRENT_CHUNKS: 3,
    FILE_UPLOAD_SPEED_LIMIT: 0,
    ...overrides,
  } as unknown as Config);
}

/**
 * A chunk body that hands over `bytes` bytes and then stays open until the test closes or
 * breaks it. `reading` resolves once the upload reads past the first piece, so the request
 * is inside its body by then.
 */
function heldBody(bytes: number) {
  let pulls = 0;
  let markReading!: () => void;
  let end!: (how: Error | null) => void;
  const reading = new Promise<void>((resolve) => (markReading = resolve));
  const ended = new Promise<Error | null>((resolve) => (end = resolve));
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // The first pull fills the queue before anyone reads, the second comes from the reader.
      if (pulls++ === 0) {
        controller.enqueue(new Uint8Array(bytes));
        return;
      }
      markReading();
      const error = await ended;
      if (error) controller.error(error);
      else controller.close();
    },
  });
  return { stream, reading, close: () => end(null), breakOff: (error: Error) => end(error) };
}

describe("chunked upload sessions", () => {
  let storageCtx: Awaited<ReturnType<typeof createTestStorage>>;
  let storage: FileStorage;
  let chunkDir: string;

  beforeEach(async () => {
    storageCtx = await createTestStorage();
    storage = storageCtx.storage;
    chunkDir = join(storageCtx.tempDir, "chunks");
    useConfig();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    storageCtx.cleanup();
  });

  /** A session layer with its chunk endpoint mounted, as the upload and request routes do. */
  function setup() {
    const onAbandon = vi.fn();
    const sessions = createChunkedUploads<{ owner: string }>(storage, { chunkDir, onAbandon });
    const app = new Hono();
    app.post("/:id/chunk", (c) => sessions.receiveChunk(c, c.req.param("id")));
    const post = async (id: string, index: number, body?: RequestInit["body"]) =>
      app.request(`/${id}/chunk?index=${index}`, {
        method: "POST",
        body,
        duplex: "half",
      } as RequestInit);
    return { sessions, onAbandon, post };
  }

  it("refuses a chunk request without a body and keeps its index free", async () => {
    const { sessions, post } = setup();
    const id = await sessions.open(10, { owner: "a" });

    const res = await post(id, 0);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing chunk body" });
    const retry = await post(id, 0, new Uint8Array(10));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ bytesWritten: 10 });
  });

  it("aborts a session with its storage entry and waiting chunks, and tells the owner once", async () => {
    const { sessions, onAbandon, post } = setup();
    const meta = { owner: "a" };
    const id = await sessions.open(20, meta);
    expect((await post(id, 1, new Uint8Array(10))).status).toBe(200);
    expect(readdirSync(chunkDir)).toEqual([`${id}.1`]);

    expect(await sessions.abort(id)).toBe(true);

    expect(onAbandon).toHaveBeenCalledWith(id, meta);
    expect(sessions.meta(id)).toBeUndefined();
    expect(await storage.exists(id)).toBe(false);
    await vi.waitFor(() => expect(readdirSync(chunkDir)).toEqual([]));
    expect((await post(id, 0, new Uint8Array(10))).status).toBe(404);
    // Nothing is left to end, so nobody is told twice.
    expect(await sessions.abort(id)).toBe(false);
    expect(await sessions.abort("never-opened")).toBe(false);
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it("refuses a chunk whose session ended while its body was read, and keeps no file of it", async () => {
    const { sessions, onAbandon, post } = setup();
    const id = await sessions.open(10, { owner: "a" });
    const body = heldBody(4);
    const pending = post(id, 0, body.stream);
    await body.reading;

    expect(await sessions.abort(id)).toBe(true);
    body.close();
    const res = await pending;

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Upload session not found or expired" });
    expect(readdirSync(chunkDir)).toEqual([]);
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it("drops the session when a chunk body breaks off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sessions, onAbandon, post } = setup();
    const meta = { owner: "a" };
    const id = await sessions.open(10, meta);
    const body = heldBody(4);
    const pending = post(id, 0, body.stream);
    await body.reading;

    body.breakOff(new Error("connection reset"));

    expect((await pending).status).toBe(500);
    expect(sessions.meta(id)).toBeUndefined();
    expect(onAbandon).toHaveBeenCalledWith(id, meta);
    expect(await storage.exists(id)).toBe(false);
    await vi.waitFor(() => expect(readdirSync(chunkDir)).toEqual([]));
  });

  it("gives a session back only once when its body breaks off after the session was aborted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sessions, onAbandon, post } = setup();
    const id = await sessions.open(10, { owner: "a" });
    const body = heldBody(4);
    const pending = post(id, 0, body.stream);
    await body.reading;

    expect(await sessions.abort(id)).toBe(true);
    body.breakOff(new Error("connection reset"));

    expect((await pending).status).toBe(500);
    // A second abandon would hand a request slot or a quota reservation back twice.
    expect(onAbandon).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(readdirSync(chunkDir)).toEqual([]));
  });

  it("drops the session when storage counts more bytes than were declared", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sessions, onAbandon, post } = setup();
    const meta = { owner: "a" };
    const id = await sessions.open(10, meta);
    const append = storage.appendChunk.bind(storage);
    vi.spyOn(storage, "appendChunk").mockImplementationOnce(
      async (uploadId, stream) => (await append(uploadId, stream)) + 1,
    );

    const res = await post(id, 0, new Uint8Array(10));

    expect(res.status).toBe(500);
    expect(sessions.meta(id)).toBeUndefined();
    expect(onAbandon).toHaveBeenCalledWith(id, meta);
    expect(await storage.exists(id)).toBe(false);
  });

  it("holds back the answer to a chunk that arrives faster than FILE_UPLOAD_SPEED_LIMIT", async () => {
    // A frozen clock: the chunk arrives no time after the first one, so it waits in full.
    vi.useFakeTimers({ toFake: ["Date"] });
    useConfig({ FILE_UPLOAD_SPEED_LIMIT: 1000 });
    const { sessions, post } = setup();
    const id = await sessions.open(100, { owner: "a" });

    const started = performance.now();
    const res = await post(id, 0, new Uint8Array(100));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ bytesWritten: 100 });
    // 100 bytes at 1000 bytes per second take 100 ms.
    expect(performance.now() - started).toBeGreaterThanOrEqual(90);
  });

  it("does not hold back a sender that stays under FILE_UPLOAD_SPEED_LIMIT", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    useConfig({ FILE_UPLOAD_SPEED_LIMIT: 10 });
    const { sessions, post } = setup();
    const id = await sessions.open(200, { owner: "a" });
    const held = <T>(answer: Promise<T>) =>
      Promise.race([
        answer,
        new Promise<"held">((resolve) => setTimeout(() => resolve("held"), 1000)),
      ]);

    // An out-of-order chunk writes nothing yet, so there is nothing to slow down.
    const waiting = await held(post(id, 1, new Uint8Array(100)));
    expect(waiting).not.toBe("held");
    expect(await (waiting as Response).json()).toEqual({ bytesWritten: 0 });

    // 200 bytes at 10 bytes per second take 20 s, and a minute has passed since the first chunk.
    vi.setSystemTime(Date.now() + MINUTE);
    const first = await held(post(id, 0, new Uint8Array(100)));
    expect(first).not.toBe("held");
    expect(await (first as Response).json()).toEqual({ bytesWritten: 200 });
  });

  it("ends a session that keeps making progress once it is older than an hour", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { sessions, onAbandon, post } = setup();
    const meta = { owner: "a" };
    const id = await sessions.open(8 * MIN_PROGRESS_BYTES, meta);
    const progress = (index: number) => post(id, index, new Uint8Array(MIN_PROGRESS_BYTES));

    // One MiB every ten minutes is enough progress, so only its age can end the session.
    for (let index = 0; index < 6; index++) {
      expect((await progress(index)).status).toBe(200);
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
    }
    // Exactly an hour old, which the sweep does not count as expired yet.
    expect(sessions.meta(id)).toBe(meta);

    expect((await progress(6)).status).toBe(200);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);

    expect(sessions.meta(id)).toBeUndefined();
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(onAbandon).toHaveBeenCalledWith(id, meta);
    await vi.waitFor(async () => expect(await storage.exists(id)).toBe(false));
    expect((await progress(7)).status).toBe(404);
  });
});
