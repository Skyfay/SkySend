import { describe, expect, it } from "vitest";
import {
  deriveKeys,
  encryptMetadata,
  fromBase64url,
  generateSalt,
  generateSecret,
  toBase64url,
  wrapFileSecret,
  type Argon2idHashFn,
} from "@skysend/crypto";
import {
  inboxNeedsPassword,
  openInbox,
  openInboxLink,
  prepareRequest,
  sanitizeFilename,
  sanitizeMimeType,
  sanitizeTitle,
} from "../../src/lib/file-request.js";
import type { Inbox, InboxUpload } from "../../src/lib/api.js";

/** Stands in for Argon2id: deterministic, so the same password always gives the same key. */
const fakeArgon2: Argon2idHashFn = async (password, salt, params) => {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array([...password, ...salt]));
  return new Uint8Array(digest).slice(0, params.hashLength);
};

const REQUEST_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";

/** The inbox response a server would send for a prepared request. */
function inboxFor(
  body: Awaited<ReturnType<typeof prepareRequest>>["body"],
  uploads: InboxUpload[] = [],
): Inbox {
  return {
    vault: body.vault,
    vaultNonce: body.vaultNonce,
    title: body.title,
    hasPassword: body.hasPassword,
    open: true,
    closesAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    maxUploads: 3,
    maxSize: 4096,
    usedUploads: uploads.length,
    usedBytes: 0,
    uploads,
  };
}

/** What a sender stores for one file: a wrapped secret and metadata under the file keys. */
async function senderUpload(
  uploadFragment: string,
  name: string,
): Promise<{ upload: InboxUpload; secret: Uint8Array }> {
  const bytes = fromBase64url(uploadFragment);
  const publicKey = bytes.slice(1, 66);
  const uploadId = crypto.randomUUID();
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);
  const meta = await encryptMetadata(
    { type: "single", name, size: 5, mimeType: "text/plain" },
    keys.metaKey,
  );
  const wrapped = await wrapFileSecret(publicKey, REQUEST_ID, uploadId, secret);
  return {
    secret,
    upload: {
      id: uploadId,
      size: 50,
      fileCount: 1,
      salt: toBase64url(salt),
      wrapEnc: toBase64url(wrapped.enc),
      wrapCiphertext: toBase64url(wrapped.ciphertext),
      encryptedMeta: toBase64url(meta.ciphertext),
      metaNonce: toBase64url(meta.iv),
      downloadCount: 0,
      maxDownloads: 5,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("file requests in the browser", () => {
  it("opens the inbox a new request made, with its title and the upload link", async () => {
    const prepared = await prepareRequest({ title: "Tax documents" });
    expect(prepared.body.hasPassword).toBe(false);
    expect(inboxNeedsPassword(prepared.inboxFragment)).toBe(false);

    const access = await openInboxLink(prepared.inboxFragment);
    expect(access.inboxToken).toBe(prepared.body.inboxAuthToken);
    expect(access.ownerToken).toBe(prepared.body.inboxOwnerToken);

    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body), access.keys);
    expect(opened.title).toBe("Tax documents");
    expect(opened.uploadFragment).toBe(prepared.uploadFragment);
    expect(opened.uploads).toEqual([]);
  });

  it("keeps the inbox shut without the right password", async () => {
    const prepared = await prepareRequest({ password: "correct horse", argon2id: fakeArgon2 });
    expect(prepared.body.hasPassword).toBe(true);
    expect(inboxNeedsPassword(prepared.inboxFragment)).toBe(true);
    await expect(openInboxLink(prepared.inboxFragment)).rejects.toThrow("needs its password");

    const right = await openInboxLink(prepared.inboxFragment, "correct horse", fakeArgon2);
    expect(right.inboxToken).toBe(prepared.body.inboxAuthToken);
    const wrong = await openInboxLink(prepared.inboxFragment, "wrong", fakeArgon2);
    expect(wrong.inboxToken).not.toBe(prepared.body.inboxAuthToken);
  });

  it("never puts a secret of the links into the body for the server", async () => {
    const prepared = await prepareRequest({ title: "x" });
    const body = JSON.stringify(prepared.body);
    const upload = fromBase64url(prepared.uploadFragment);
    expect(body).not.toContain(toBase64url(upload.slice(1, 66)));
    expect(body).not.toContain(toBase64url(upload.slice(66)));
    expect(body).not.toContain(toBase64url(fromBase64url(prepared.inboxFragment).slice(1, 33)));
  });

  it("unwraps what a sender uploaded and skips an entry that does not open", async () => {
    const prepared = await prepareRequest({});
    const good = await senderUpload(prepared.uploadFragment, "report.pdf");
    const broken = await senderUpload(prepared.uploadFragment, "other.pdf");
    broken.upload.wrapCiphertext = toBase64url(new Uint8Array(48));

    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(
      REQUEST_ID,
      inboxFor(prepared.body, [good.upload, broken.upload]),
      access.keys,
    );
    expect(opened.title).toBeNull();
    expect(opened.uploads[0]!.file?.secret).toEqual(good.secret);
    expect(opened.uploads[0]!.file?.metadata).toMatchObject({ type: "single", name: "report.pdf" });
    expect(opened.uploads[1]!.file).toBeNull();
  });

  it("counts an archive without its size as damaged", async () => {
    const prepared = await prepareRequest({});
    const archive = await senderUpload(prepared.uploadFragment, "x");
    const salt = fromBase64url(archive.upload.salt);
    const keys = await deriveKeys(archive.secret, salt);
    const meta = await encryptMetadata(
      { type: "archive", files: [{ name: "a", size: 1 }], totalSize: 1 },
      keys.metaKey,
    );
    archive.upload.encryptedMeta = toBase64url(meta.ciphertext);
    archive.upload.metaNonce = toBase64url(meta.iv);
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(
      REQUEST_ID,
      inboxFor(prepared.body, [archive.upload]),
      access.keys,
    );
    expect(opened.uploads[0]!.file).toBeNull();
  });

  it("refuses an upload moved in from another request", async () => {
    const prepared = await prepareRequest({});
    const moved = await senderUpload(prepared.uploadFragment, "a.txt");
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(
      crypto.randomUUID(),
      inboxFor(prepared.body, [moved.upload]),
      access.keys,
    );
    expect(opened.uploads[0]!.file).toBeNull();
  });

  it("rejects a link that is not an inbox link", () => {
    expect(() => inboxNeedsPassword("not-a-link")).toThrow();
  });
});

describe("sanitizeFilename", () => {
  it("drops bidirectional overrides that disguise an extension", () => {
    expect(sanitizeFilename("invoice‮fdp.exe")).toBe("invoicefdp.exe");
  });

  it("drops control characters and path separators", () => {
    expect(sanitizeFilename("a\u0000b\u001F\u007Fc")).toBe("abc");
    expect(sanitizeFilename("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFilename("dir\\file.txt")).toBe("dir_file.txt");
  });

  it("drops zero-width characters and lone surrogates", () => {
    expect(sanitizeFilename("in\u200Bvoice\uFEFF.pdf")).toBe("invoice.pdf");
    expect(sanitizeFilename("a\ud800b")).toBe("ab");
  });

  it("collapses runs of spaces that would hide the real extension", () => {
    expect(sanitizeFilename("invoice.pdf          .exe")).toBe("invoice.pdf .exe");
  });

  it("treats blank fillers as spaces, so they cannot hide the extension either", () => {
    expect(sanitizeFilename("invoice.pdf\u3164\u2800\uFFA0\u115F\u1160.exe")).toBe(
      "invoice.pdf .exe",
    );
    expect(sanitizeFilename("\u3164\u3164")).toBe("file");
  });

  it("cuts a tower of combining marks down to three", () => {
    expect(sanitizeFilename(`a${"\u0301".repeat(40)}.pdf`)).toBe("a\u0301\u0301\u0301.pdf");
    expect(sanitizeFilename("Vi\u1EC7t.txt".normalize("NFD"))).toBe(
      "Vi\u1EC7t.txt".normalize("NFD"),
    );
  });

  it("cuts a long name without splitting a character", () => {
    const name = sanitizeFilename("😀".repeat(300));
    expect(Array.from(name)).toHaveLength(255);
    expect(name.isWellFormed()).toBe(true);
  });

  it("never returns an empty name", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("‮")).toBe("file");
    expect(sanitizeFilename("..")).toBe("file");
  });

  it("keeps an ordinary name as it is", () => {
    expect(sanitizeFilename("Steuererklärung 2026.pdf")).toBe("Steuererklärung 2026.pdf");
  });
});

describe("sanitizeMimeType", () => {
  it("keeps a plain type and drops anything else", () => {
    expect(sanitizeMimeType("application/pdf")).toBe("application/pdf");
    expect(sanitizeMimeType("image/svg+xml")).toBe("image/svg+xml");
    expect(sanitizeMimeType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(sanitizeMimeType("")).toBe("application/octet-stream");
  });
});

describe("sanitizeTitle", () => {
  it("keeps line breaks but no run of empty lines", () => {
    expect(sanitizeTitle("First\r\n\n\n\n\nSecond")).toBe("First\n\nSecond");
  });

  it("drops control and reordering characters", () => {
    expect(sanitizeTitle("a\u202Eb\u0007c\u200Bd")).toBe("abcd");
  });

  it("keeps a tab between words as a space", () => {
    expect(sanitizeTitle("a\tb  \u3164\u2800 c")).toBe("a b c");
  });

  it("cuts a tower of combining marks, even one split by invisible characters", () => {
    const tower = `${"\u0301".repeat(3)}\u200B`.repeat(10);
    expect(sanitizeTitle(`Z${tower}`)).toBe("Z\u0301\u0301\u0301");
  });

  it("keeps an ordinary title as it is", () => {
    expect(sanitizeTitle("Unterlagen für die Steuererklärung 2026")).toBe(
      "Unterlagen für die Steuererklärung 2026",
    );
  });
});
