import { useState, useCallback } from "react";
import {
  generateSecret,
  generateSalt,
  deriveKeys,
  computeAuthToken,
  computeOwnerToken,
  createEncryptStream,
  encryptMetadata,
  calculateEncryptedSize,
  toBase64url,
  applyPasswordProtection,
  deriveKeyFromPassword,
  type FileMetadata,
  type Argon2idHashFn,
  PASSWORD_SALT_LENGTH,
} from "@skysend/crypto";
import { randomBytes } from "@skysend/crypto";
import * as api from "@/lib/api";
import { saveUpload } from "@/lib/upload-store";
import { zipFiles } from "@/lib/zip";

export type UploadPhase =
  | "idle"
  | "zipping"
  | "encrypting"
  | "uploading"
  | "saving-meta"
  | "done"
  | "error";

interface UploadState {
  phase: UploadPhase;
  progress: number;
  shareLink: string | null;
  error: string | null;
  uploadId: string | null;
}

interface UploadOptions {
  files: File[];
  maxDownloads: number;
  expireSec: number;
  password: string;
  argon2id?: Argon2idHashFn;
}

export function useUpload() {
  const [state, setState] = useState<UploadState>({
    phase: "idle",
    progress: 0,
    shareLink: null,
    error: null,
    uploadId: null,
  });

  const reset = useCallback(() => {
    setState({
      phase: "idle",
      progress: 0,
      shareLink: null,
      error: null,
      uploadId: null,
    });
  }, []);

  const upload = useCallback(async (options: UploadOptions) => {
    const { files, maxDownloads, expireSec, password, argon2id } = options;

    try {
      // Generate crypto keys
      const secret = generateSecret();
      const salt = generateSalt();
      const keys = await deriveKeys(secret, salt);

      // Handle password protection
      let effectiveSecret = secret;
      let hasPassword = false;
      let passwordSalt: Uint8Array | undefined;
      let passwordAlgo: "argon2id" | "pbkdf2" | undefined;

      if (password.length > 0) {
        hasPassword = true;
        passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
        const { key: passwordKey, algorithm } = await deriveKeyFromPassword(
          password,
          passwordSalt,
          argon2id,
        );
        passwordAlgo = algorithm;
        effectiveSecret = applyPasswordProtection(secret, passwordKey);
      }

      // Prepare payload
      let payload: Uint8Array;
      let metadata: FileMetadata;
      const fileNames: string[] = [];

      if (files.length === 1) {
        setState((s) => ({ ...s, phase: "encrypting", progress: 0 }));
        const file = files[0]!;
        payload = new Uint8Array(await file.arrayBuffer());
        metadata = {
          type: "single",
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        fileNames.push(file.name);
      } else {
        setState((s) => ({ ...s, phase: "zipping", progress: 0 }));
        const fileEntries = await Promise.all(
          files.map(async (f) => ({
            name: f.webkitRelativePath || f.name,
            data: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        payload = zipFiles(fileEntries);
        metadata = {
          type: "archive",
          files: files.map((f) => ({
            name: f.webkitRelativePath || f.name,
            size: f.size,
          })),
          totalSize: files.reduce((sum, f) => sum + f.size, 0),
        };
        for (const f of files) {
          fileNames.push(f.webkitRelativePath || f.name);
        }
      }

      // Encrypt the payload
      setState((s) => ({ ...s, phase: "encrypting", progress: 0 }));
      const plaintextStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      });
      const encryptedStream = plaintextStream.pipeThrough(
        createEncryptStream(keys.fileKey),
      );

      const encryptedSize = calculateEncryptedSize(payload.byteLength);

      // Compute tokens
      const authToken = await computeAuthToken(keys.authKey);
      const ownerToken = await computeOwnerToken(effectiveSecret, salt);

      // Upload
      setState((s) => ({ ...s, phase: "uploading", progress: 0 }));
      const headers: Record<string, string> = {
        "X-Auth-Token": toBase64url(authToken),
        "X-Owner-Token": toBase64url(ownerToken),
        "X-Salt": toBase64url(salt),
        "X-Max-Downloads": String(maxDownloads),
        "X-Expire-Sec": String(expireSec),
        "X-File-Count": String(files.length),
        "X-Has-Password": String(hasPassword),
        "Content-Length": String(encryptedSize),
      };

      if (hasPassword && passwordSalt && passwordAlgo) {
        headers["X-Password-Salt"] = toBase64url(passwordSalt);
        headers["X-Password-Algo"] = passwordAlgo;
      }

      const result = await api.uploadFile(
        encryptedStream,
        headers,
        (loaded) => {
          setState((s) => ({
            ...s,
            progress: Math.min(99, Math.round((loaded / encryptedSize) * 100)),
          }));
        },
      );

      // Save metadata
      setState((s) => ({ ...s, phase: "saving-meta", progress: 100 }));
      const encMeta = await encryptMetadata(metadata, keys.metaKey);
      await api.saveMeta(
        result.id,
        toBase64url(ownerToken),
        btoa(String.fromCharCode(...encMeta.ciphertext)),
        btoa(String.fromCharCode(...encMeta.iv)),
      );

      // Build share link with secret in fragment
      const secretB64 = toBase64url(effectiveSecret);
      const shareLink = `${window.location.origin}/d/${result.id}#${secretB64}`;

      // Store in IndexedDB
      await saveUpload({
        id: result.id,
        ownerToken: toBase64url(ownerToken),
        secret: secretB64,
        fileNames,
        createdAt: new Date().toISOString(),
      });

      setState({
        phase: "done",
        progress: 100,
        shareLink,
        error: null,
        uploadId: result.id,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : "Upload failed",
      }));
    }
  }, []);

  return { ...state, upload, reset };
}
