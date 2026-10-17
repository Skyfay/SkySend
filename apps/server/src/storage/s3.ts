import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { mkdirSync, rmSync, type createReadStream } from "node:fs";
import { open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { describeError } from "../lib/log-error.js";
import type { StorageBackend } from "./types.js";

const MIB = 1024 * 1024;

/** Minimum part size for S3 multipart uploads (5 MB - S3 requirement for non-final parts). */
const MIN_PART_SIZE = 5 * MIB;

/** Most parts S3 accepts in one multipart upload. */
const MAX_PARTS = 10_000;

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignedExpiry: number;
  partSize: number;
  concurrency: number;
  /**
   * Most bytes all uploads together hold in parts on their way to the bucket. Parts that are
   * still filling up may hold half of it again, see FillMemory.
   */
  memoryLimit?: number;
  /**
   * Where a part that is still filling up waits once FillMemory is full, one file per upload.
   * Emptied when the storage is created, so it must belong to this storage alone.
   */
  partDir: string;
}

/**
 * The bytes of parts that are still filling up, over every upload, held to a limit. It never
 * waits: a session that finds no room moves the part it is filling into a file in partDir and
 * fills it there. Waiting for room here could leave every upload waiting for room that only
 * more data would free, and without any limit an upload that stopped one byte short of a part
 * held almost a part in memory for as long as its session lived, and every new session added
 * one. Kept in memory while there is room, since a round trip through a file costs a part's
 * worth of copies in the kernel, which cut the speed to a local bucket by up to a third.
 */
class FillMemory {
  private used = 0;

  constructor(private readonly limit: number) {}

  tryTake(bytes: number): boolean {
    if (this.used + bytes > this.limit) return false;
    this.used += bytes;
    return true;
  }

  give(bytes: number): void {
    this.used -= bytes;
  }
}

/**
 * The bytes of all parts on their way to the bucket, over every upload, held to a limit.
 * A part waits for room in the order it asked, so every upload gets its turn. A part larger
 * than the whole limit still goes when nothing else is on its way, so a small limit slows
 * uploads down but never stops them.
 */
class PartMemory {
  private used = 0;
  private readonly waiting: Array<{ bytes: number; go: () => void }> = [];

  constructor(private readonly limit: number) {}

  private fits(bytes: number): boolean {
    return this.used === 0 || this.used + bytes <= this.limit;
  }

  take(bytes: number): Promise<void> {
    if (this.waiting.length === 0 && this.fits(bytes)) {
      this.used += bytes;
      return Promise.resolve();
    }
    return new Promise((go) => this.waiting.push({ bytes, go }));
  }

  give(bytes: number): void {
    this.used -= bytes;
    while (this.waiting.length > 0 && this.fits(this.waiting[0]!.bytes)) {
      const next = this.waiting.shift()!;
      this.used += next.bytes;
      next.go();
    }
  }
}

interface MultipartSession {
  /** Size of every part but the last, fixed for the whole upload. */
  partSize: number;
  /**
   * The multipart upload, null until it is started: for an upload that fits into one part it
   * never is, and finalize stores it with a single PutObject.
   */
  uploadId: Promise<string> | null;
  /** In the order the parts finished, which with parallel uploads is not their own order. */
  parts: Array<{ PartNumber: number; ETag: string }>;
  /** Cancels the part uploads still running when the upload is aborted. */
  abort: AbortController;
  /**
   * What the session read and has not sent yet, counted in FillMemory: the part that is
   * filling up, or up to two parts while appendChunk reads ahead.
   */
  chunks: Uint8Array[];
  /** True while the part that is filling up is in partFile, after FillMemory had no room. */
  onDisk: boolean;
  /** Opened by the first part that moves to disk, kept for the rest of the upload. */
  partFile: FileHandle | null;
  /** Bytes in chunks, or in partFile while onDisk. */
  bufferSize: number;
  partNumber: number;
  /** Active S3 part upload promises. Used for concurrency limiting + backpressure. */
  activeUploads: Set<Promise<void>>;
  /** First error from a background upload, re-thrown on next appendChunk or finalize. */
  uploadError: Error | null;
}

/**
 * S3-compatible object storage backend.
 *
 * Works with AWS S3, Cloudflare R2, Hetzner Object Storage,
 * MinIO, Wasabi, Backblaze B2, DigitalOcean Spaces, and any
 * S3-compatible provider.
 *
 * Files are stored as: <bucket>/<id>.bin
 */
export class S3Storage implements StorageBackend {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly presignedExpiry: number;
  private readonly partSize: number;
  private readonly concurrency: number;
  private readonly partMemory: PartMemory;
  private readonly fillMemory: FillMemory;
  private readonly partDir: string;
  private readonly multipartSessions = new Map<string, MultipartSession>();

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.presignedExpiry = config.presignedExpiry;
    this.partSize = Math.max(config.partSize, MIN_PART_SIZE);
    this.concurrency = config.concurrency;
    this.partMemory = new PartMemory(config.memoryLimit ?? Infinity);
    this.fillMemory = new FillMemory((config.memoryLimit ?? Infinity) / 2);
    // No session survives a restart, so whatever a previous process left there is garbage.
    this.partDir = config.partDir;
    rmSync(this.partDir, { recursive: true, force: true });
    mkdirSync(this.partDir, { recursive: true });

    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      forcePathStyle: config.forcePathStyle,
      // AWS SDK v3 >=3.679 enables checksum calculation by default ("WHEN_SUPPORTED").
      // S3-compatible providers (R2, MinIO, etc.) may return checksum fields containing
      // characters like &#xD; (carriage return) in XML responses that the SDK XML
      // parser cannot handle, causing "[EntityReplacer] Invalid character '#'" errors.
      // Setting both to WHEN_REQUIRED disables this behavior for non-AWS providers.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      // With "Expect: 100-continue", which the SDK sends for every body over 2 MB, it opens
      // a new connection without keep-alive per request, so each part pays a DNS lookup and a
      // TLS handshake. Behind a resolver that answers parallel lookups slowly, that held
      // uploads to R2 at 10 MiB/s instead of 68 MiB/s. All the header saves is sending a part
      // the bucket would reject.
      expectContinueHeader: false,
    });
  }

  private key(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error("Invalid upload ID format");
    }
    return `${id}.bin`;
  }

  /** Verify bucket exists and test read/write connectivity. Call once at startup. */
  async init(): Promise<void> {
    // 1. Verify bucket exists
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));

    // 2. Write a small test object to verify write permissions
    const testKey = ".skysend-connectivity-test";
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: testKey,
        Body: Buffer.from("ok"),
      }),
    );

    // 3. Delete the test object to verify delete permissions
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: testKey,
      }),
    );

    console.log(`[s3] Connected to bucket: ${this.bucket} (read/write OK)`);
  }

  /**
   * Save a ReadableStream to S3. Goes through the same session as a chunked upload, so its
   * parts count against the memory limit too, and `size`, the declared size, lets an upload
   * that fits into one part go out with one PutObject.
   */
  async save(id: string, stream: ReadableStream<Uint8Array>, size?: number): Promise<number> {
    await this.createEmpty(id, size);
    try {
      const bytesWritten = await this.appendChunk(id, stream);
      await this.finalizeChunkedUpload(id);
      return bytesWritten;
    } catch (err) {
      await this.abortChunkedUpload(id);
      throw err;
    }
  }

  /**
   * Opens an upload session. `size`, the declared size of the upload, sets the part size and
   * the way the upload is stored: one that fits into a single part is stored with one
   * PutObject at finalize, which takes one request instead of three and leaves nothing in the
   * bucket when it is abandoned. A larger one starts its multipart upload now, in the
   * background, so the first part does not wait for it.
   */
  async createEmpty(id: string, size?: number): Promise<void> {
    const key = this.key(id);
    // S3 caps a multipart upload at MAX_PARTS parts, so a large upload takes larger parts.
    // Every part but the last has this size, which R2 requires.
    const partSize =
      size === undefined
        ? this.partSize
        : Math.max(this.partSize, Math.ceil(size / MAX_PARTS / MIB) * MIB);
    const session: MultipartSession = {
      partSize,
      uploadId: null,
      parts: [],
      abort: new AbortController(),
      chunks: [],
      onDisk: false,
      partFile: null,
      bufferSize: 0,
      partNumber: 1,
      activeUploads: new Set(),
      uploadError: null,
    };
    if (size === undefined || size > partSize) this.createMultipartUpload(key, session);
    this.multipartSessions.set(id, session);
  }

  /**
   * Starts the multipart upload of a session once. Its error reaches the parts that wait for
   * it. Not cancelled by an abort, so an upload that S3 created is always known and aborted.
   */
  private createMultipartUpload(key: string, session: MultipartSession): Promise<string> {
    session.uploadId ??= this.client
      .send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key }))
      .then((result) => {
        if (!result.UploadId) {
          throw new Error("S3 CreateMultipartUpload did not return an UploadId");
        }
        return result.UploadId;
      });
    // Handled where it is awaited. This only keeps a failure before then from going unhandled.
    session.uploadId.catch(() => {});
    return session.uploadId;
  }

  /**
   * Uploads the next part of a session in the background, tracked in activeUploads: a whole
   * part, or what is left at finalize. Waits for room in the memory limit first, which holds
   * back the caller and with it the sender, and gives it back once the part settled, stored or
   * not.
   */
  private async sendPart(id: string, session: MultipartSession, partNumber: number) {
    const size = Math.min(session.bufferSize, session.partSize);
    await this.partMemory.take(size);
    let data: Uint8Array;
    try {
      data = await this.takePart(session, size);
    } catch (err) {
      this.partMemory.give(size);
      throw err;
    }
    this.startPart(id, session, data, partNumber);
  }

  private startPart(id: string, session: MultipartSession, data: Uint8Array, partNumber: number) {
    const key = this.key(id);
    const p = this.createMultipartUpload(key, session)
      .then((uploadId) =>
        this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: data,
          }),
          { abortSignal: session.abort.signal },
        ),
      )
      .then((result) => {
        session.parts.push({ PartNumber: partNumber, ETag: result.ETag! });
      })
      .catch((err) => {
        if (!session.uploadError) {
          session.uploadError = err instanceof Error ? err : new Error(String(err));
        }
      })
      .finally(() => {
        session.activeUploads.delete(p);
        this.partMemory.give(data.byteLength);
      });
    session.activeUploads.add(p);
  }

  /** Waits until a session may start another part, and passes on a part that failed. */
  private async freeSlot(session: MultipartSession): Promise<void> {
    while (session.activeUploads.size >= this.concurrency) {
      await Promise.race(session.activeUploads);
      if (session.uploadError) throw session.uploadError;
    }
  }

  /** Sends every whole part a session holds. */
  private async sendWholeParts(id: string, session: MultipartSession): Promise<void> {
    while (session.bufferSize >= session.partSize) {
      await this.freeSlot(session);
      await this.sendPart(id, session, session.partNumber++);
    }
  }

  /**
   * Adds bytes to a session part by part, for when FillMemory had no room for all of them: what
   * finds room stays in memory, the rest goes into the part file, and each part goes out as
   * soon as it is whole.
   */
  private async addInParts(id: string, session: MultipartSession, data: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < data.byteLength) {
      if (session.bufferSize >= session.partSize) await this.sendWholeParts(id, session);
      const take = Math.min(session.partSize - session.bufferSize, data.byteLength - offset);
      const piece = data.subarray(offset, offset + take);
      if (!session.onDisk && this.fillMemory.tryTake(take)) {
        session.chunks.push(piece);
        session.bufferSize += take;
      } else {
        if (!session.onDisk) await this.moveToDisk(id, session);
        await this.writeToPart(id, session, piece);
      }
      offset += take;
    }
  }

  /** The file a part that is still filling up waits in once FillMemory is full. */
  private partPath(id: string): string {
    return join(this.partDir, `${this.key(id)}.part`);
  }

  /**
   * Moves the part a session is filling, less than a whole one, from memory into its file and
   * gives the room back.
   */
  private async moveToDisk(id: string, session: MultipartSession): Promise<void> {
    const held = session.bufferSize;
    session.bufferSize = 0;
    for (const chunk of session.chunks) await this.writeToPart(id, session, chunk);
    session.chunks = [];
    session.onDisk = true;
    this.fillMemory.give(held);
  }

  /** Writes bytes after the ones already in the part file of a session. */
  private async writeToPart(id: string, session: MultipartSession, data: Uint8Array): Promise<void> {
    session.partFile ??= await open(this.partPath(id), "w+");
    let written = 0;
    while (written < data.byteLength) {
      const { bytesWritten } = await session.partFile.write(
        data,
        written,
        data.byteLength - written,
        session.bufferSize + written,
      );
      written += bytesWritten;
    }
    session.bufferSize += data.byteLength;
  }

  /**
   * The first `size` bytes a session holds, as one piece of memory. A part in the file is all
   * the file holds and is read back, and the next part starts in memory again, written over it
   * from the start of the file if it moves there too. The caller takes room in the memory limit
   * for it first.
   */
  private async takePart(session: MultipartSession, size: number): Promise<Uint8Array> {
    if (session.onDisk) {
      const data = Buffer.allocUnsafe(size);
      let read = 0;
      while (read < size) {
        const { bytesRead } = await session.partFile!.read(data, read, size - read, read);
        if (bytesRead === 0) throw new Error("Buffered part is shorter than expected");
        read += bytesRead;
      }
      session.bufferSize = 0;
      session.onDisk = false;
      return data;
    }
    session.bufferSize -= size;
    this.fillMemory.give(size);
    const first = session.chunks[0];
    if (first?.byteLength === size) {
      session.chunks.shift();
      return first;
    }
    const data = Buffer.allocUnsafe(size);
    let filled = 0;
    while (filled < size) {
      const chunk = session.chunks[0]!;
      const n = Math.min(chunk.byteLength, size - filled);
      data.set(n === chunk.byteLength ? chunk : chunk.subarray(0, n), filled);
      if (n === chunk.byteLength) session.chunks.shift();
      else session.chunks[0] = chunk.subarray(n);
      filled += n;
    }
    return data;
  }

  /** Gives back the memory of what a session holds and deletes its part file. */
  private async discardPart(id: string, session: MultipartSession): Promise<void> {
    this.fillMemory.give(session.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    session.chunks = [];
    const file = session.partFile;
    if (!file) return;
    session.partFile = null;
    await file.close().catch(() => {});
    await rm(this.partPath(id), { force: true });
  }

  /**
   * Append a chunk to a multipart upload session.
   * Buffers data until the part size is reached, then uploads parts to S3 concurrently.
   * Applies backpressure by waiting for one part to complete when all concurrency slots are
   * full, so the caller slows down to the speed of the bucket.
   */
  async appendChunk(id: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    const session = this.multipartSessions.get(id);
    if (!session) {
      throw new Error(`No multipart session found for ${id}`);
    }

    // Propagate any error from previous background uploads
    if (session.uploadError) throw session.uploadError;

    // Reads two parts ahead while FillMemory has room and cuts them after, the way a chunk of the
    // chunked transport, two parts of 8 MiB, was handled before the limit: sending each part
    // between two reads of the same stream cost that transport a fifth more CPU, and reading a
    // long stream further ahead only held more memory. Every byte read counts against
    // FillMemory, so a session that waits for room in the memory limit holds no more than
    // FillMemory allows.
    const reader = stream.getReader();
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (!session.onDisk && this.fillMemory.tryTake(value.byteLength)) {
        session.chunks.push(value);
        session.bufferSize += value.byteLength;
        if (session.bufferSize >= 2 * session.partSize) await this.sendWholeParts(id, session);
        continue;
      }
      // No room: the whole parts read so far go out first, which gives their room back.
      await this.sendWholeParts(id, session);
      await this.addInParts(id, session, value);
    }
    await this.sendWholeParts(id, session);

    // If all slots are full, wait for ONE to finish. This delays the caller, which throttles
    // the client to the speed of the bucket.
    if (session.activeUploads.size >= this.concurrency) {
      await Promise.race(session.activeUploads);
      if (session.uploadError) throw session.uploadError;
    }

    return bytesRead;
  }

  /**
   * Finalize the upload: one PutObject for an upload that never filled a part, otherwise the
   * rest goes out as the last part beside the parts still in flight and the multipart upload is
   * completed. A finalize that fails aborts the upload itself, so no parts are left in the
   * bucket.
   */
  async finalizeChunkedUpload(id: string): Promise<void> {
    const session = this.multipartSessions.get(id);
    if (!session) {
      throw new Error(`No multipart session found for ${id}`);
    }

    try {
      if (session.uploadError) throw session.uploadError;

      if (session.uploadId === null) {
        // In memory only while it goes out, so it counts against the limit like a part.
        const size = session.bufferSize;
        await this.partMemory.take(size);
        try {
          const body = await this.takePart(session, size);
          await this.client.send(
            new PutObjectCommand({ Bucket: this.bucket, Key: this.key(id), Body: body }),
            { abortSignal: session.abort.signal },
          );
        } finally {
          this.partMemory.give(size);
        }
        this.multipartSessions.delete(id);
        await this.discardPart(id, session);
        return;
      }

      // The last part (can be < 5MB) need not wait for the parts before it.
      if (session.bufferSize > 0) await this.sendPart(id, session, session.partNumber++);
      await Promise.all(session.activeUploads);
      if (session.uploadError) throw session.uploadError;

      // S3 refuses a list that is not in ascending order (InvalidPartOrder), and parallel
      // parts finish in any order: one that is retried or simply slower finishes after the
      // parts behind it.
      const parts = [...session.parts].sort((a, b) => a.PartNumber - b.PartNumber);
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.key(id),
          UploadId: await session.uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      this.multipartSessions.delete(id);
      await this.discardPart(id, session);
    } catch (err) {
      // The caller's abortChunkedUpload finds no session after this, so the abort happens here.
      await this.abortSession(id, session);
      throw err;
    }
  }

  /**
   * Create a Node.js ReadStream from S3.
   * Used as fallback when presigned URLs are not desired.
   */
  createReadStream(id: string): ReturnType<typeof createReadStream> {
    // We return a passthrough approach: create a Readable that
    // fetches from S3 on demand.
    const client = this.client;
    const bucket = this.bucket;
    const key = this.key(id);

    const readable = new Readable({
      async read() {
        try {
          const result = await client.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
          );
          const body = result.Body;
          if (!body) {
            this.destroy(new Error("Empty S3 response body"));
            return;
          }
          // Stream the S3 body through
          const webStream = body.transformToWebStream();
          const reader = webStream.getReader();
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                this.push(null);
                return;
              }
              if (!this.push(value)) {
                // Backpressure: wait for drain
                await new Promise<void>((resolve) => this.once("drain", resolve));
              }
            }
          };
          pump().catch((err) => this.destroy(err));
        } catch (err) {
          this.destroy(err as Error);
        }
      },
    });

    // Override read to only fetch once
    let fetched = false;
    const origRead = readable._read.bind(readable);
    readable._read = function (size) {
      if (!fetched) {
        fetched = true;
        origRead(size);
      }
    };

    return readable as ReturnType<typeof createReadStream>;
  }

  /** Delete an object from S3. Ignores missing objects. */
  async delete(id: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.key(id),
        }),
      );
    } catch (err) {
      // S3 DeleteObject is idempotent for most providers,
      // but handle NotFound gracefully just in case
      if ((err as { name?: string }).name === "NotFound") return;
      throw err;
    }
  }

  /** Check if an object exists in S3. */
  async exists(id: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(id),
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound" ||
          (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /** Get object size in bytes. Returns null if it does not exist. */
  async size(id: string): Promise<number | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.key(id),
        }),
      );
      return result.ContentLength ?? null;
    } catch (err) {
      if ((err as { name?: string }).name === "NotFound" ||
          (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /** Remove all objects in the bucket. Used for testing cleanup. */
  async clear(): Promise<void> {
    let continuationToken: string | undefined;

    do {
      const list = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ContinuationToken: continuationToken,
        }),
      );

      if (list.Contents && list.Contents.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: list.Contents.map((obj) => ({ Key: obj.Key })),
            },
          }),
        );
      }

      continuationToken = list.NextContinuationToken;
    } while (continuationToken);
  }

  /**
   * S3 storage always uses presigned download URLs.
   *
   * Presigned URLs have a short TTL (configurable, default 300s) and expire automatically,
   * enforcing download limits and expiry even if a URL is recorded by a client.
   */
  supportsPresignedUrls(): boolean {
    return true;
  }

  /** Generate a presigned GET URL for direct client download. */
  async getPresignedDownloadUrl(id: string, expiresInSec?: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key(id),
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSec ?? this.presignedExpiry,
    });
  }

  /** Abort a multipart upload in progress. */
  async abortChunkedUpload(id: string): Promise<void> {
    const session = this.multipartSessions.get(id);
    if (session) await this.abortSession(id, session);
  }

  /**
   * Cancels the parts still being uploaded, waits until none is in flight, then aborts the
   * multipart upload. A part that is still uploading while the abort runs may be stored after
   * it, and its bytes would be billed until a lifecycle rule removes them.
   */
  private async abortSession(id: string, session: MultipartSession): Promise<void> {
    this.multipartSessions.delete(id);
    session.abort.abort();
    await Promise.allSettled(session.activeUploads);
    await this.discardPart(id, session);
    // An upload that was stored with one PutObject, or whose creation failed, has nothing to abort.
    const uploadId = await session.uploadId?.catch(() => null);
    if (!uploadId) return;
    try {
      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.key(id),
          UploadId: uploadId,
        }),
      );
    } catch (err) {
      // Best effort. A lifecycle rule for incomplete multipart uploads catches what is left.
      console.warn("[s3] Aborting a multipart upload failed:", describeError(err));
    }
  }
}
