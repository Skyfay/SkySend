import { describe, expect, it } from "vitest";
import { withUnlockedMeta, type UploadInfo } from "../../src/lib/api.js";

const info = (overrides: Partial<UploadInfo> = {}): UploadInfo =>
  ({
    id: "f-1",
    size: 100,
    fileCount: 1,
    hasPassword: true,
    salt: "salt",
    passwordSalt: "psalt",
    passwordAlgo: "argon2id-v2",
    encryptedMeta: null,
    nonce: null,
    downloadCount: 0,
    maxDownloads: 1,
    expiresAt: "2099-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as UploadInfo;

describe("withUnlockedMeta", () => {
  it("takes the metadata the password check released, which the info holds back", () => {
    const opened = withUnlockedMeta(info(), { encryptedMeta: "meta", nonce: "nonce" });
    expect(opened.encryptedMeta).toBe("meta");
    expect(opened.nonce).toBe("nonce");
    expect(opened.salt).toBe("salt");
  });

  it("keeps the info's own metadata from a server that still sends it there", () => {
    const opened = withUnlockedMeta(info({ encryptedMeta: "old-meta", nonce: "old-nonce" }), {
      encryptedMeta: null,
      nonce: null,
    });
    expect(opened.encryptedMeta).toBe("old-meta");
    expect(opened.nonce).toBe("old-nonce");
  });
});
