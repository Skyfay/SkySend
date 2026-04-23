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
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import type { createReadStream } from "node:fs";
import type { StorageBackend } from "./types.js";

/** Minimum part size for S3 multipart uploads (5 MB - S3 requirement for non-final parts). */
const MIN_PART_SIZE = 5 * 1024 * 1024;

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  presignedExpiry: number;
  publicUrl?: string;
  partSize: number;
  concurrency: number;
}

interface MultipartSession {
  uploadId: string;
  parts: Array<{ PartNumber: number; ETag: string }>;
  /** Buffered chunks waiting to reach partSize. Avoids repeated full-buffer copies. */
  bufferChunks: Uint8Array[];
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
  private readonly multipartSessions = new Map<string, MultipartSession>();

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.presignedExpiry = config.presignedExpiry;
    this.partSize = Math.max(config.partSize, MIN_PART_SIZE);
    this.concurrency = config.concurrency;

    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      ...(config.endpoint && { endpoint: config.endpoint }),
      forcePathStyle: config.forcePathStyle,
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
   * Save a ReadableStream to S3 using managed multipart upload.
   * Streams data directly to S3 without buffering on disk.
   */
  async save(id: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    const nodeStream = Readable.fromWeb(stream as ReadableStream);

    let bytesWritten = 0;
    nodeStream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: this.key(id),
        Body: nodeStream,
      },
      // Use configured part size and parallelism for better throughput
      partSize: this.partSize,
      queueSize: this.concurrency,
    });

    await upload.done();
    return bytesWritten;
  }

  /**
   * Create a multipart upload session for chunked uploads.
   * S3 requires at least 5MB per part (except the last part).
   */
  async createEmpty(id: string): Promise<void> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.key(id),
      }),
    );

    if (!result.UploadId) {
      throw new Error("S3 CreateMultipartUpload did not return an UploadId");
    }

    this.multipartSessions.set(id, {
      uploadId: result.UploadId,
      parts: [],
      bufferChunks: [],
      bufferSize: 0,
      partNumber: 1,
      activeUploads: new Set(),
      uploadError: null,
    });
  }

  /**
   * Append a chunk to a multipart upload session.
   * Buffers data until the target part size is reached, then uploads parts
   * to S3 concurrently. Applies smooth backpressure by waiting for one
   * S3 upload to complete when all concurrency slots are full, instead of
   * draining the entire pipeline.
   */
  async appendChunk(id: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    const session = this.multipartSessions.get(id);
    if (!session) {
      throw new Error(`No multipart session found for ${id}`);
    }

    // Propagate any error from previous background uploads
    if (session.uploadError) throw session.uploadError;

    // Read incoming stream chunks (keep as-is, no extra copy)
    const reader = stream.getReader();
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      session.bufferChunks.push(value);
      session.bufferSize += value.byteLength;
      bytesRead += value.byteLength;
    }

    // Collect parts to upload (>= partSize each)
    const partsToUpload: Array<{ data: Uint8Array; partNumber: number }> = [];
    while (session.bufferSize >= this.partSize) {
      // Concatenate only as much as needed for one part
      const partData = new Uint8Array(this.partSize);
      let offset = 0;
      while (offset < this.partSize) {
        const chunk = session.bufferChunks[0]!;
        const needed = this.partSize - offset;
        if (chunk.byteLength <= needed) {
          partData.set(chunk, offset);
          offset += chunk.byteLength;
          session.bufferChunks.shift();
        } else {
          partData.set(chunk.subarray(0, needed), offset);
          session.bufferChunks[0] = chunk.subarray(needed);
          offset += needed;
        }
      }
      session.bufferSize -= this.partSize;
      partsToUpload.push({ data: partData, partNumber: session.partNumber });
      session.partNumber++;
    }

    // Upload each part concurrently with a semaphore
    for (const part of partsToUpload) {
      // Wait for a free slot if all are in use (smooth backpressure)
      while (session.activeUploads.size >= this.concurrency) {
        await Promise.race(session.activeUploads);
        if (session.uploadError) throw session.uploadError;
      }

      // Start this part upload (fire-and-forget, tracked via Set)
      const p = this.client
        .send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: this.key(id),
            UploadId: session.uploadId,
            PartNumber: part.partNumber,
            Body: part.data,
          }),
        )
        .then((result) => {
          session.parts.push({
            PartNumber: part.partNumber,
            ETag: result.ETag!,
          });
        })
        .catch((err) => {
          if (!session.uploadError) {
            session.uploadError =
              err instanceof Error ? err : new Error(String(err));
          }
        })
        .finally(() => {
          session.activeUploads.delete(p);
        });
      session.activeUploads.add(p);
    }

    // Smooth backpressure: if all slots are full, wait for ONE to finish.
    // This delays the HTTP response, throttling the client to ~S3 speed.
    if (session.activeUploads.size >= this.concurrency) {
      await Promise.race(session.activeUploads);
      if (session.uploadError) throw session.uploadError;
    }

    return bytesRead;
  }

  /**
   * Finalize the multipart upload.
   * Flushes remaining buffer as the last part and completes the upload.
   */
  async finalizeChunkedUpload(id: string): Promise<void> {
    const session = this.multipartSessions.get(id);
    if (!session) {
      throw new Error(`No multipart session found for ${id}`);
    }

    try {
      // Wait for all active S3 part uploads to complete
      await Promise.all(session.activeUploads);
      if (session.uploadError) throw session.uploadError;

      // Upload remaining buffer as the last part (can be < 5MB)
      if (session.bufferSize > 0) {
        // Concatenate remaining buffer chunks into a single Uint8Array
        const remaining = new Uint8Array(session.bufferSize);
        let offset = 0;
        for (const chunk of session.bufferChunks) {
          remaining.set(chunk, offset);
          offset += chunk.byteLength;
        }
        session.bufferChunks.length = 0;
        session.bufferSize = 0;

        const result = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: this.key(id),
            UploadId: session.uploadId,
            PartNumber: session.partNumber,
            Body: remaining,
          }),
        );

        session.parts.push({
          PartNumber: session.partNumber,
          ETag: result.ETag!,
        });
      }

      // Complete the multipart upload
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.key(id),
          UploadId: session.uploadId,
          MultipartUpload: { Parts: session.parts },
        }),
      );
    } finally {
      this.multipartSessions.delete(id);
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
   * S3 storage always uses presigned download URLs, even when S3_PUBLIC_URL is configured.
   *
   * L-5 (Security Audit): Returning a permanent public URL (via getPublicDownloadUrl) is a
   * security bug - the URL remains valid indefinitely after the DB record is deleted, allowing
   * downloads past the expiry or max-download limit by anyone who recorded the URL.
   * Presigned URLs have a short TTL (configurable, default 1 hour) and expire automatically.
   * Trade-off: presigned URLs bypass CDN caching - this is an accepted trade-off for
   * correct access-control enforcement.
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

  /**
   * Always returns null - permanent public URLs are not used for downloads.
   * See supportsPresignedUrls() for the rationale.
   * S3_PUBLIC_URL is still used for upload operations where needed.
   */
  getPublicDownloadUrl(_id: string): string | null {
    return null;
  }

  /** Abort a multipart upload in progress. */
  async abortChunkedUpload(id: string): Promise<void> {
    const session = this.multipartSessions.get(id);
    if (session) {
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: this.bucket,
            Key: this.key(id),
            UploadId: session.uploadId,
          }),
        );
      } catch {
        // Best-effort abort
      }
      this.multipartSessions.delete(id);
    }
  }
}
