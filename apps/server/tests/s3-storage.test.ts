import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Storage } from "../src/storage/s3.js";

const MIB = 1024 * 1024;
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A stand-in for one part upload: the test decides when it finishes. */
interface PendingPart {
  partNumber: number;
  size: number;
  body: Uint8Array;
  signal: AbortSignal | undefined;
  finish: () => void;
  fail: (err: Error) => void;
}

/**
 * Replaces S3Client.send with a bucket that behaves like S3 in what these tests need: it refuses
 * a CompleteMultipartUpload whose parts are not in ascending order with InvalidPartOrder, which
 * AWS and SeaweedFS both do, and it lets the test finish each part upload when it wants to.
 */
function fakeBucket() {
  const events: string[] = [];
  const settled = new Set<string>();
  const parts = new Map<number, PendingPart>();
  const partsByKey = new Map<string, PendingPart>();
  const completed: Array<Array<{ PartNumber?: number }>> = [];
  const putBodies: Uint8Array[] = [];
  let completeError: Error | null = null;

  vi.spyOn(S3Client.prototype, "send").mockImplementation((async (
    command: unknown,
    options?: { abortSignal?: AbortSignal },
  ) => {
    if (command instanceof CreateMultipartUploadCommand) {
      events.push("create");
      return { UploadId: "upload-1" };
    }
    if (command instanceof PutObjectCommand) {
      events.push(`put ${(command.input.Body as Uint8Array).byteLength}`);
      putBodies.push(command.input.Body as Uint8Array);
      return {};
    }
    if (command instanceof UploadPartCommand) {
      const partNumber = command.input.PartNumber!;
      return new Promise((resolve, reject) => {
        const settle = (outcome: string) => {
          events.push(`part ${partNumber} ${outcome}`);
          settled.add(`${command.input.Key}:${partNumber}`);
        };
        const part: PendingPart = {
          partNumber,
          size: (command.input.Body as Uint8Array).byteLength,
          body: command.input.Body as Uint8Array,
          signal: options?.abortSignal,
          finish: () => {
            settle("stored");
            resolve({ ETag: `"etag-${partNumber}"` });
          },
          fail: (err) => {
            settle("failed");
            reject(err);
          },
        };
        options?.abortSignal?.addEventListener("abort", () =>
          part.fail(Object.assign(new Error("Request aborted"), { name: "AbortError" })),
        );
        parts.set(partNumber, part);
        partsByKey.set(`${command.input.Key}:${partNumber}`, part);
      });
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const list = command.input.MultipartUpload?.Parts ?? [];
      completed.push(list);
      events.push("complete");
      const numbers = list.map((p) => p.PartNumber!);
      if (numbers.some((n, i) => i > 0 && n <= numbers[i - 1]!)) {
        throw Object.assign(new Error("The list of parts was not in ascending order."), {
          name: "InvalidPartOrder",
        });
      }
      if (completeError) throw completeError;
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      events.push(`abort ${command.input.UploadId}`);
      return {};
    }
    throw new Error(`Unexpected command ${(command as object).constructor.name}`);
  }) as never);

  return {
    events,
    parts,
    completed,
    putBodies,
    failCompleteWith(err: Error) {
      completeError = err;
    },
    partsByKey,
    /** The parts sent so far that have not settled. */
    open() {
      return [...partsByKey.entries()].filter(([key]) => !settled.has(key)).map(([key]) => key);
    },
    /** Waits until the part upload with this number has been sent. */
    async part(partNumber: number) {
      await vi.waitFor(() => expect(parts.has(partNumber)).toBe(true));
      return parts.get(partNumber)!;
    },
  };
}

/** Where the storages of a test keep the start of their parts. */
let partDir: string;

function storage(memoryLimit?: number) {
  return new S3Storage({
    bucket: "bucket",
    region: "us-east-1",
    accessKeyId: "key",
    secretAccessKey: "secret",
    forcePathStyle: true,
    presignedExpiry: 300,
    partSize: 5 * MIB,
    concurrency: 4,
    memoryLimit,
    partDir,
  });
}

const ID_B = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function streamOf(size: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

describe("S3Storage multipart uploads", () => {
  let bucket: ReturnType<typeof fakeBucket>;

  beforeEach(() => {
    bucket = fakeBucket();
    partDir = join(mkdtempSync(join(tmpdir(), "skysend-s3-")), "parts");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(join(partDir, ".."), { recursive: true, force: true });
  });

  it("completes with the parts in ascending order when they finish out of order", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    // Three full parts go out at once. The first one finishes last, like a part the SDK had
    // to retry or one that simply took longer.
    await s3.appendChunk(ID, streamOf(15 * MIB + 1024));
    (await bucket.part(3)).finish();
    (await bucket.part(2)).finish();
    (await bucket.part(1)).finish();

    const finalized = s3.finalizeChunkedUpload(ID);
    (await bucket.part(4)).finish();
    await finalized;

    expect(bucket.completed).toHaveLength(1);
    expect(bucket.completed[0]!.map((p) => p.PartNumber)).toEqual([1, 2, 3, 4]);
    expect(bucket.events.some((e) => e.startsWith("abort"))).toBe(false);
  });

  it("aborts the multipart upload when completing it fails", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(5 * MIB + 1024));
    (await bucket.part(1)).finish();
    bucket.failCompleteWith(
      Object.assign(new Error("We encountered an internal error."), { name: "InternalError" }),
    );

    const finalized = s3.finalizeChunkedUpload(ID);
    (await bucket.part(2)).finish();
    await expect(finalized).rejects.toThrow("internal error");

    expect(bucket.events).toContain("abort upload-1");
    // What the routes do after a failed finalize. The upload is gone by then.
    await expect(s3.abortChunkedUpload(ID)).resolves.toBeUndefined();
    expect(bucket.events.filter((e) => e.startsWith("abort"))).toHaveLength(1);
  });

  it("aborts the multipart upload when a part upload failed", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(10 * MIB + 1024));
    (await bucket.part(1)).finish();
    (await bucket.part(2)).fail(new Error("socket hang up"));
    // Lets the failure reach the upload before finalize starts.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(s3.finalizeChunkedUpload(ID)).rejects.toThrow("socket hang up");
    expect(bucket.events).toContain("abort upload-1");
    expect(bucket.completed).toHaveLength(0);
  });

  it("stores an upload that fits into one part with a single PutObject", async () => {
    const s3 = storage();
    await s3.createEmpty(ID, 3 * MIB);
    await s3.appendChunk(ID, streamOf(MIB));
    await s3.appendChunk(ID, streamOf(2 * MIB));
    await s3.finalizeChunkedUpload(ID);
    expect(bucket.events).toEqual([`put ${3 * MIB}`]);
  });

  it("leaves nothing to abort when an upload that fits into one part is abandoned", async () => {
    const s3 = storage();
    await s3.createEmpty(ID, 3 * MIB);
    await s3.appendChunk(ID, streamOf(MIB));
    await s3.abortChunkedUpload(ID);
    expect(bucket.events).toEqual([]);
  });

  it("sends the last part beside the parts still in flight", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(10 * MIB + 1024));
    const first = await bucket.part(1);
    const second = await bucket.part(2);

    const finalized = s3.finalizeChunkedUpload(ID);
    // The last part goes out while the two before it are still uploading.
    const last = await bucket.part(3);
    expect(last.size).toBe(1024);
    expect(bucket.events.filter((e) => e.startsWith("part"))).toEqual([]);
    first.finish();
    second.finish();
    last.finish();
    await finalized;
    expect(bucket.completed[0]!.map((p) => p.PartNumber)).toEqual([1, 2, 3]);
  });

  it("picks parts large enough to keep a large upload within 10000 parts", async () => {
    const s3 = storage();
    // 100 GiB in 10000 parts takes 10.24 MiB each, which rounds up to 11 MiB.
    await s3.createEmpty(ID, 100 * 1024 * MIB);
    await s3.appendChunk(ID, streamOf(11 * MIB - 1));
    expect(bucket.parts.size).toBe(0);
    await s3.appendChunk(ID, streamOf(2));
    expect((await bucket.part(1)).size).toBe(11 * MIB);
    await s3.abortChunkedUpload(ID);
  });

  it("holds the parts of all uploads together to the memory limit, in the order they asked", async () => {
    const s3 = storage(10 * MIB);
    await s3.createEmpty(ID);
    await s3.createEmpty(ID_B);
    // Two parts of the first upload fill the limit, its third waits and so does its caller.
    let firstDone = false;
    const first = s3.appendChunk(ID, streamOf(15 * MIB)).then(() => (firstDone = true));
    await vi.waitFor(() => expect(bucket.open()).toHaveLength(2));
    let secondDone = false;
    const second = s3.appendChunk(ID_B, streamOf(5 * MIB)).then(() => (secondDone = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bucket.open()).toHaveLength(2);
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);

    // Room for one part: the third part of the first upload asked first and goes first.
    bucket.partsByKey.get(`${ID}.bin:1`)!.finish();
    await vi.waitFor(() => expect(bucket.open()).toContain(`${ID}.bin:3`));
    await first;
    expect(bucket.open()).not.toContain(`${ID_B}.bin:1`);
    bucket.partsByKey.get(`${ID}.bin:2`)!.finish();
    await second;
    expect(bucket.open()).toEqual([`${ID}.bin:3`, `${ID_B}.bin:1`]);
    await s3.abortChunkedUpload(ID);
    await s3.abortChunkedUpload(ID_B);
  });

  it("gives the memory of a part back when it fails or is aborted", async () => {
    const s3 = storage(5 * MIB);
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(5 * MIB));
    await s3.abortChunkedUpload(ID);

    await s3.createEmpty(ID_B);
    await s3.appendChunk(ID_B, streamOf(5 * MIB));
    expect(bucket.open()).toEqual([`${ID_B}.bin:1`]);
    await s3.abortChunkedUpload(ID_B);
  });

  it("lets a part larger than the whole limit go once nothing else is on its way", async () => {
    const s3 = storage(MIB);
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(5 * MIB));
    expect(bucket.open()).toEqual([`${ID}.bin:1`]);
    await s3.abortChunkedUpload(ID);
  });

  it("cancels the parts in flight and aborts only once none is left", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    await s3.appendChunk(ID, streamOf(10 * MIB));
    const first = await bucket.part(1);
    const second = await bucket.part(2);

    await s3.abortChunkedUpload(ID);

    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(true);
    // A part still uploading while the abort runs can be stored after it and stay billed.
    expect(bucket.events).toEqual(["create", "part 1 failed", "part 2 failed", "abort upload-1"]);
  });
  /** A stream of `size` bytes where byte i is (from + i) % 251, in chunks of `chunk` bytes. */
  function patterned(size: number, chunk: number, from = 0) {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= size) return controller.close();
        const length = Math.min(chunk, size - sent);
        const data = new Uint8Array(length);
        for (let i = 0; i < length; i++) data[i] = (from + sent + i) % 251;
        sent += length;
        controller.enqueue(data);
      },
    });
  }

  function expectPattern(data: Uint8Array, from: number) {
    for (let i = 0; i < data.byteLength; i += 4099) expect(data[i]).toBe((from + i) % 251);
    expect(data[data.byteLength - 1]).toBe((from + data.byteLength - 1) % 251);
  }

  it("keeps parts that are filling up in memory while there is room for them", async () => {
    // Half of the limit, 16 MiB, is room for parts that are filling up.
    const s3 = storage(32 * MIB);
    for (const id of [ID, ID_B]) {
      await s3.createEmpty(id);
      await s3.appendChunk(id, streamOf(5 * MIB - 1));
    }
    expect(bucket.parts.size).toBe(0);
    expect(readdirSync(partDir)).toEqual([]);
    await s3.abortChunkedUpload(ID);
    await s3.abortChunkedUpload(ID_B);
  });

  it("moves a part that is filling up to disk once their room is used up", async () => {
    // Room for 6 MiB of parts that are filling up. One byte short of a part used to wait in
    // memory, which no limit counted, and every new session added one.
    const s3 = storage(12 * MIB);
    for (const id of [ID, ID_B]) {
      await s3.createEmpty(id);
      await s3.appendChunk(id, patterned(5 * MIB - 1, 1_000_003));
    }
    expect(existsSync(join(partDir, `${ID}.bin.part`))).toBe(false);
    expect(statSync(join(partDir, `${ID_B}.bin.part`)).size).toBe(5 * MIB - 1);

    // The first upload gives its room back, the part from disk goes out whole and the next part
    // of the same upload fills up in memory again.
    await s3.abortChunkedUpload(ID);
    await s3.appendChunk(ID_B, patterned(MIB + 1, 300_000, 5 * MIB - 1));
    const finalized = s3.finalizeChunkedUpload(ID_B);
    const parts = [await bucket.part(1), await bucket.part(2)];
    for (const part of parts) part.finish();
    await finalized;
    expect(parts.map((p) => p.size)).toEqual([5 * MIB, MIB]);
    parts.forEach((part, i) => expectPattern(part.body, i * 5 * MIB));
    expect(readdirSync(partDir)).toEqual([]);
  });

  it("reads a long stream at most two parts ahead of the parts in flight", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= 100 * MIB) return controller.close();
          pulled += MIB;
          controller.enqueue(new Uint8Array(MIB));
        },
      },
      { highWaterMark: 0 },
    );
    const appending = s3.appendChunk(ID, stream);
    // All four slots taken and none finished: the stream stops two parts after them.
    await vi.waitFor(() => expect(bucket.open()).toHaveLength(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pulled).toBeLessThanOrEqual((4 + 2) * 5 * MIB + MIB);
    for (let n = 1; n <= 20; n++) (await bucket.part(n)).finish();
    expect(await appending).toBe(100 * MIB);
    await s3.abortChunkedUpload(ID);
  });

  it("sends every byte in its place when every part fills up on disk", async () => {
    // A limit of 1 MiB leaves 512 KiB for parts that are filling up, less than any part.
    const s3 = storage(MIB);
    await s3.createEmpty(ID);
    const upload = (async () => {
      await s3.appendChunk(ID, patterned(7 * MIB + 3, 1_000_003));
      await s3.appendChunk(ID, patterned(9 * MIB, 65_536, 7 * MIB + 3));
      await s3.finalizeChunkedUpload(ID);
    })();
    // The limit lets one part out at a time.
    const parts = [];
    for (let n = 1; n <= 4; n++) {
      const part = await bucket.part(n);
      if (n === 1) expect(existsSync(join(partDir, `${ID}.bin.part`))).toBe(true);
      parts.push(part);
      part.finish();
    }
    await upload;
    expect(parts.map((p) => p.size)).toEqual([5 * MIB, 5 * MIB, 5 * MIB, MIB + 3]);
    parts.forEach((part, i) => expectPattern(part.body, i * 5 * MIB));
    expect(readdirSync(partDir)).toEqual([]);
  });

  it("sends every byte in its place across chunks and parts", async () => {
    const s3 = storage();
    await s3.createEmpty(ID);
    // Chunks that end neither on a part nor on each other, over three parts and a rest.
    await s3.appendChunk(ID, patterned(7 * MIB + 3, 1000_003));
    await s3.appendChunk(ID, patterned(9 * MIB, 65_536, 7 * MIB + 3));
    const finalized = s3.finalizeChunkedUpload(ID);
    const parts = [await bucket.part(1), await bucket.part(2), await bucket.part(3), await bucket.part(4)];
    for (const part of parts) part.finish();
    await finalized;
    expect(parts.map((p) => p.size)).toEqual([5 * MIB, 5 * MIB, 5 * MIB, MIB + 3]);
    parts.forEach((part, i) => expectPattern(part.body, i * 5 * MIB));
  });

  it("stores a small upload with one PutObject", async () => {
    const s3 = storage();
    await s3.createEmpty(ID, 2 * MIB + 5);
    await s3.appendChunk(ID, patterned(2 * MIB + 5, 300_000));
    await s3.finalizeChunkedUpload(ID);
    expect(bucket.events).toEqual([`put ${2 * MIB + 5}`]);
    expectPattern(bucket.putBodies[0]!, 0);
    expect(readdirSync(partDir)).toEqual([]);
  });

  it("saves a single-request upload through the same session as a chunked one", async () => {
    const s3 = storage();
    expect(await s3.save(ID, patterned(MIB, 100_000), MIB)).toBe(MIB);
    expect(bucket.events).toEqual([`put ${MIB}`]);

    const saving = s3.save(ID_B, patterned(6 * MIB, 100_000), 6 * MIB);
    (await bucket.part(1)).finish();
    (await bucket.part(2)).finish();
    expect(await saving).toBe(6 * MIB);
    expect(bucket.completed).toHaveLength(1);
  });

  it("empties its part directory when it is created", () => {
    mkdirSync(partDir, { recursive: true });
    writeFileSync(join(partDir, "left-over.part"), "x");
    storage();
    expect(readdirSync(partDir)).toEqual([]);
  });
});

