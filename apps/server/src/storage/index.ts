import type { StorageBackend } from "./types.js";
import type { Config } from "../lib/config.js";
import { FileStorage } from "./filesystem.js";

/**
 * Create a storage backend based on the server configuration.
 *
 * - `STORAGE_BACKEND=filesystem` (default): Local filesystem storage
 * - `STORAGE_BACKEND=s3`: S3-compatible object storage (AWS, R2, Hetzner, MinIO, etc.)
 */
export async function createStorage(config: Config): Promise<StorageBackend> {
  if (config.STORAGE_BACKEND === "s3") {
    // Dynamic import to avoid loading AWS SDK when not needed
    const { S3Storage } = await import("./s3.js");
    // These are guaranteed to be set by cross-field validation in loadConfig()
    return new S3Storage({
      bucket: config.S3_BUCKET!,
      region: config.S3_REGION!,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY!,
      secretAccessKey: config.S3_SECRET_KEY!,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      presignedExpiry: config.S3_PRESIGNED_EXPIRY,
      partSize: config.S3_PART_SIZE,
      concurrency: config.S3_CONCURRENCY,
    });
  }

  return new FileStorage(config.UPLOADS_DIR);
}

export type { StorageBackend } from "./types.js";
