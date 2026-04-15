import type { createReadStream } from "node:fs";

/**
 * Abstract storage backend interface.
 *
 * Both the filesystem and S3 backends implement this interface,
 * allowing the server to switch storage strategies via configuration.
 */
export interface StorageBackend {
  /** Initialize the storage backend. Call once at startup. */
  init(): Promise<void>;

  /**
   * Save a ReadableStream (Web API) to storage.
   * Returns the total number of bytes written.
   */
  save(id: string, stream: ReadableStream<Uint8Array>): Promise<number>;

  /** Create an empty entry for chunked uploads. */
  createEmpty(id: string): Promise<void>;

  /**
   * Append a chunk to an existing entry.
   * Returns the number of bytes appended.
   */
  appendChunk(id: string, stream: ReadableStream<Uint8Array>): Promise<number>;

  /**
   * Finalize a chunked upload. For filesystem this is a no-op.
   * For S3 this completes the multipart upload.
   */
  finalizeChunkedUpload(id: string): Promise<void>;

  /**
   * Create a Node.js ReadStream for downloading.
   * Used as fallback when presigned URLs are not available.
   */
  createReadStream(id: string): ReturnType<typeof createReadStream>;

  /** Delete an entry from storage. Ignores missing entries. */
  delete(id: string): Promise<void>;

  /** Check if an entry exists. */
  exists(id: string): Promise<boolean>;

  /** Get entry size in bytes. Returns null if the entry does not exist. */
  size(id: string): Promise<number | null>;

  /** Remove all entries. Used for testing cleanup. */
  clear(): Promise<void>;

  /** Whether this backend supports presigned download URLs. */
  supportsPresignedUrls(): boolean;

  /**
   * Generate a presigned download URL for direct client access.
   * Returns null if not supported.
   */
  getPresignedDownloadUrl(id: string, expiresInSec?: number): Promise<string | null>;

  /**
   * Abort a chunked upload that is in progress.
   * For filesystem this deletes the partial file.
   * For S3 this aborts the multipart upload.
   */
  abortChunkedUpload(id: string): Promise<void>;

  /**
   * Get the public download URL for an object.
   * Returns null if public URLs are not configured.
   */
  getPublicDownloadUrl(id: string): string | null;
}
