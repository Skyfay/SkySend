import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, unlink, stat, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StorageBackend } from "./types.js";

/**
 * Filesystem-based storage layer for encrypted upload blobs.
 *
 * Files are stored as: <dataDir>/uploads/<id>.bin
 * This keeps the flat structure simple and avoids nested directories.
 */
export class FileStorage implements StorageBackend {
  private readonly uploadsDir: string;

  constructor(uploadsDir: string) {
    this.uploadsDir = uploadsDir;
  }

  /** Ensure the uploads directory exists. Call once at startup. */
  async init(): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
  }

  /** Get the absolute file path for an upload ID. */
  getPath(id: string): string {
    // Prevent path traversal by validating the id format
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error("Invalid upload ID format");
    }
    return join(this.uploadsDir, `${id}.bin`);
  }

  /**
   * Save a ReadableStream (Web API) to disk.
   * Returns the total number of bytes written.
   */
  async save(id: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    const filePath = this.getPath(id);
    const nodeStream = Readable.fromWeb(stream as ReadableStream);
    const writeStream = createWriteStream(filePath);

    let bytesWritten = 0;
    nodeStream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    await pipeline(nodeStream, writeStream);
    return bytesWritten;
  }

  /** Create an empty file for chunked uploads. */
  async createEmpty(id: string): Promise<void> {
    const filePath = this.getPath(id);
    const ws = createWriteStream(filePath);
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.on("finish", resolve);
      ws.on("error", reject);
    });
  }

  /**
   * Append a chunk (Buffer or ReadableStream) to an existing file.
   * Returns the number of bytes appended.
   */
  async appendChunk(id: string, stream: ReadableStream<Uint8Array>): Promise<number> {
    const filePath = this.getPath(id);
    const nodeStream = Readable.fromWeb(stream as ReadableStream);
    const writeStream = createWriteStream(filePath, { flags: "a" });

    let bytesWritten = 0;
    nodeStream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    await pipeline(nodeStream, writeStream);
    return bytesWritten;
  }

  /**
   * Create a Node.js ReadStream for downloading.
   * The caller is responsible for converting to a web ReadableStream if needed.
   */
  createReadStream(id: string): ReturnType<typeof createReadStream> {
    return createReadStream(this.getPath(id));
  }

  /** Delete an upload file from disk. Ignores missing files. */
  async delete(id: string): Promise<void> {
    try {
      await unlink(this.getPath(id));
    } catch (err) {
      // Ignore ENOENT - file already deleted
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  /** Check if a file exists. */
  async exists(id: string): Promise<boolean> {
    try {
      await access(this.getPath(id));
      return true;
    } catch {
      return false;
    }
  }

  /** Get file size in bytes. Returns null if the file does not exist. */
  async size(id: string): Promise<number | null> {
    try {
      const s = await stat(this.getPath(id));
      return s.size;
    } catch {
      return null;
    }
  }

  /** Remove the entire uploads directory. Used for testing cleanup. */
  async clear(): Promise<void> {
    await rm(this.uploadsDir, { recursive: true, force: true });
    await this.init();
  }

  /** Finalize a chunked upload. No-op for filesystem. */
  async finalizeChunkedUpload(_id: string): Promise<void> {
    // Filesystem writes are already finalized on each appendChunk call
  }

  /** Filesystem does not support presigned URLs. */
  supportsPresignedUrls(): boolean {
    return false;
  }

  /** Not supported - returns null. */
  async getPresignedDownloadUrl(_id: string, _expiresInSec?: number): Promise<string | null> {
    return null;
  }

  /** Abort a chunked upload by deleting the partial file. */
  async abortChunkedUpload(id: string): Promise<void> {
    await this.delete(id);
  }

  /** Filesystem does not support public download URLs. */
  getPublicDownloadUrl(_id: string): string | null {
    return null;
  }
}
