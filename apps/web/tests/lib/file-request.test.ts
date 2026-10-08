import { describe, expect, it } from "vitest";
import {
  calculateEncryptedSize,
  createEncryptStream,
  decodeUploadFragment,
  decryptRequestBrief,
  deriveKeys,
  deriveLinkKeys,
  encryptMetadata,
  fromBase64url,
  generateSalt,
  generateSecret,
  toBase64url,
  wrapFileSecret,
  type Argon2idHashFn,
} from "@skysend/crypto";
import { padNote, parseTemplate, serializeNote, type NoteBlock } from "@skysend/note-format";
import {
  groupBySubmission,
  inboxNeedsPassword,
  noteTooLarge,
  openInbox,
  openInboxLink,
  prepareRequest,
  readInboxNote,
  requestOutlived,
  sanitizeFilename,
  sanitizeTitle,
  NoteTooLargeError,
  type OpenedUpload,
} from "../../src/lib/file-request.js";
import type { Inbox, InboxUpload } from "../../src/lib/api.js";
import { hashWasmArgon2 } from "../../src/lib/argon2.js";
import frozen from "../fixtures/frozen-passwords.json";

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
    brief: body.brief,
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

/** What a sender stores for a note: the padded document, ECE, note metadata, the wrap. */
async function senderNote(uploadFragment: string, document: string, size?: number) {
  const { publicKey } = await decodeUploadFragment(uploadFragment);
  const uploadId = crypto.randomUUID();
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);
  const bytes = new TextEncoder().encode(document);
  const stream = new Blob([bytes]).stream().pipeThrough(createEncryptStream(keys.fileKey));
  const ciphertext = new Uint8Array(await new Response(stream).arrayBuffer());
  const meta = await encryptMetadata({ type: "note", size: size ?? bytes.length }, keys.metaKey);
  const wrapped = await wrapFileSecret(publicKey, REQUEST_ID, uploadId, secret);
  const upload: InboxUpload = {
    id: uploadId,
    size: calculateEncryptedSize(size ?? bytes.length),
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
  };
  return { upload, stream: () => new Blob([ciphertext]).stream() };
}

const MiB = 1024 * 1024;

describe("note requests in the browser", () => {
  it("writes what is asked for and the template into the brief a sender reads", async () => {
    const template: NoteBlock[] = [
      { type: "password", entries: [{ label: "PIN", value: "not for the template" }] },
    ];
    const prepared = await prepareRequest({
      title: "Bank",
      asks: ["files", "note"],
      template,
    });
    const { publicKey, linkSecret } = await decodeUploadFragment(prepared.uploadFragment);
    const { briefKey } = await deriveLinkKeys(linkSecret, publicKey);
    const brief = await decryptRequestBrief(
      {
        ciphertext: fromBase64url(prepared.body.brief.ciphertext),
        nonce: fromBase64url(prepared.body.brief.nonce),
      },
      briefKey,
    );
    expect(brief).toMatchObject({ title: "Bank", asks: ["files", "note"] });
    expect(parseTemplate(brief.template)).toEqual([
      { type: "password", entries: [{ label: "PIN", value: "" }] },
    ]);

    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body), access.keys);
    expect(opened).toMatchObject({ title: "Bank", asks: ["files", "note"] });
  });

  it("asks for files with no template when nothing else is said", async () => {
    const prepared = await prepareRequest({
      template: [{ type: "sshkey", publicKey: "", privateKey: "", passphrase: "" }],
    });
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body), access.keys);
    expect(opened.asks).toEqual(["files"]);
  });

  it("opens a note a sender put into the inbox, with every label cleaned", async () => {
    const prepared = await prepareRequest({ asks: ["note"] });
    const blocks: NoteBlock[] = [
      { type: "password", entries: [{ label: "PIN\u202Egnp", value: "4711" }] },
      { type: "text", format: "plain", text: "ok", label: "Note\u0007" },
      { type: "code", title: "a\u200Bb", language: "auto", code: "x" },
    ];
    const note = await senderNote(prepared.uploadFragment, padNote(serializeNote(blocks)));
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body, [note.upload]), access.keys);
    const file = opened.uploads[0]!.file!;
    expect(file.metadata).toEqual({ type: "note", size: 1024 });
    expect(noteTooLarge(file, MiB)).toBe(false);

    const read = await readInboxNote(file, note.stream(), MiB);
    expect(read.unreadable).toBe(false);
    expect(read.blocks).toEqual([
      { type: "password", entries: [{ label: "PINgnp", value: "4711" }] },
      { type: "text", format: "plain", text: "ok", label: "Note" },
      { type: "code", title: "ab", language: "auto", code: "x" },
    ]);
  });

  it("shows a note that does not parse as plain text, so nothing in it is lost", async () => {
    const prepared = await prepareRequest({ asks: ["note"] });
    const note = await senderNote(prepared.uploadFragment, padNote("not a document"));
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body, [note.upload]), access.keys);
    const read = await readInboxNote(opened.uploads[0]!.file!, note.stream(), MiB);
    expect(read).toEqual({
      unreadable: true,
      blocks: [{ type: "text", format: "plain", text: "not a document" }],
    });
  });

  it("stops reading a note whose stream runs past its size", async () => {
    const prepared = await prepareRequest({ asks: ["note"] });
    const note = await senderNote(prepared.uploadFragment, padNote("{}"));
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body, [note.upload]), access.keys);
    const extra = new Blob([
      new Uint8Array(await new Response(note.stream()).arrayBuffer()),
      new Uint8Array(64 * 1024),
    ]).stream();
    await expect(readInboxNote(opened.uploads[0]!.file!, extra, MiB)).rejects.toThrow(
      "longer than its size",
    );
  });

  it("refuses an inbox without a brief", async () => {
    const prepared = await prepareRequest({});
    const access = await openInboxLink(prepared.inboxFragment);
    await expect(
      openInbox(REQUEST_ID, { ...inboxFor(prepared.body), brief: null }, access.keys),
    ).rejects.toThrow("no brief");
  });

  it("refuses to read a note larger than the instance takes, before reading it", async () => {
    const prepared = await prepareRequest({ asks: ["note"] });
    const note = await senderNote(prepared.uploadFragment, padNote("x".repeat(5000)));
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body, [note.upload]), access.keys);
    const file = opened.uploads[0]!.file!;
    expect(noteTooLarge(file, 1024)).toBe(true);
    await expect(readInboxNote(file, note.stream(), 1024)).rejects.toThrow(NoteTooLargeError);
  });

  it("counts a note as damaged when its size is not padded or not what is stored", async () => {
    const prepared = await prepareRequest({ asks: ["note"] });
    const unpadded = await senderNote(prepared.uploadFragment, '{"v":1,"blocks":[]}');
    const lying = await senderNote(prepared.uploadFragment, padNote("{}"));
    lying.upload.size += 1;
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(
      REQUEST_ID,
      inboxFor(prepared.body, [unpadded.upload, lying.upload]),
      access.keys,
    );
    expect(opened.uploads.map((u) => u.file)).toEqual([null, null]);
  });

  it("does not read a file as a note", async () => {
    const prepared = await prepareRequest({});
    const file = await senderUpload(prepared.uploadFragment, "a.txt");
    const access = await openInboxLink(prepared.inboxFragment);
    const opened = await openInbox(REQUEST_ID, inboxFor(prepared.body, [file.upload]), access.keys);
    const entry = opened.uploads[0]!.file!;
    expect(noteTooLarge(entry, 0)).toBe(false);
    await expect(readInboxNote(entry, new Blob([]).stream(), MiB)).rejects.toThrow("Not a note");
  });
});

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

  it("still opens an inbox link with a password from v3.0, with the real Argon2id", async () => {
    const { fragment, password, inboxToken, ownerToken } = frozen.inbox;
    const access = await openInboxLink(fragment, password, hashWasmArgon2);
    expect(access.inboxToken).toBe(inboxToken);
    expect(access.ownerToken).toBe(ownerToken);
  }, 30_000);

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

describe("requestOutlived", () => {
  const DAY = 24 * 60 * 60_000;
  const closesAt = "2026-10-01T00:00:00.000Z";
  const closed = Date.parse(closesAt);

  it("forgets a request only a day after its last upload ran out", () => {
    const retention = 7 * 24 * 3600;
    expect(requestOutlived(closesAt, retention, closed + 8 * DAY)).toBe(false);
    expect(requestOutlived(closesAt, retention, closed + 8 * DAY + 1)).toBe(true);
    expect(requestOutlived(closesAt, retention, closed - DAY)).toBe(false);
  });

  it("forgets nothing without the retention or with a date it cannot read", () => {
    expect(requestOutlived(closesAt, undefined, closed + 365 * DAY)).toBe(false);
    // A server that sends no retention reads as 0 through the config schema.
    expect(requestOutlived(closesAt, 0, closed + 365 * DAY)).toBe(false);
    expect(requestOutlived("not a date", 604_800, closed + 365 * DAY)).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("drops bidirectional overrides that disguise an extension", () => {
    expect(sanitizeFilename("invoice‮fdp.exe")).toBe("invoicefdp.exe");
  });

  it("drops control characters and path separators", () => {
    expect(sanitizeFilename("a\u0000b\u001F\u007Fc")).toBe("abc");
    expect(sanitizeFilename("../../etc/passwd")).toBe("_.._etc_passwd");
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

  it("keeps the real extension when it cuts a long name", () => {
    const name = sanitizeFilename(`Rechnung.pdf${"_".repeat(300)}.exe`);
    expect(name).toHaveLength(255);
    expect(name.startsWith("Rechnung.pdf___")).toBe(true);
    expect(name.endsWith("_.exe")).toBe(true);
    // An extension too long to be one is not worth the room.
    expect(sanitizeFilename(`${"a".repeat(300)}.${"b".repeat(40)}`)).toBe("a".repeat(255));
  });

  it("drops dots and spaces at either end, which Windows would drop on save", () => {
    expect(sanitizeFilename("invoice.pdf.exe.")).toBe("invoice.pdf.exe");
    expect(sanitizeFilename(`Rechnung.pdf${"_".repeat(300)}.exe.`).endsWith(".exe")).toBe(true);
    expect(sanitizeFilename("report.exe . . ")).toBe("report.exe");
    expect(sanitizeFilename(" .hidden")).toBe("hidden");
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

describe("groupBySubmission", () => {
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  /** An opened upload with just what the grouping reads. */
  function entry(id: string, submission?: string, damaged = false): OpenedUpload {
    return {
      upload: { id } as InboxUpload,
      file: damaged
        ? null
        : ({
            metadata: { type: "note", size: 1024, ...(submission ? { submission } : {}) },
          } as unknown as OpenedUpload["file"]),
    };
  }
  const ids = (groups: OpenedUpload[][]) => groups.map((g) => g.map((e) => e.upload.id));

  it("puts the parts of one submission together, in the order the first one arrived", () => {
    const groups = groupBySubmission([entry("1", A), entry("2", B), entry("3", A)]);
    expect(ids(groups)).toEqual([["1", "3"], ["2"]]);
  });

  it("lets an upload without a mark and a damaged one stand alone", () => {
    const groups = groupBySubmission([entry("1"), entry("2", A, true), entry("3"), entry("4", A)]);
    expect(ids(groups)).toEqual([["1"], ["2"], ["3"], ["4"]]);
  });

  it("keeps every part a sender marked alike, a repeated note included", () => {
    const groups = groupBySubmission([entry("1", A), entry("2", A), entry("3", A)]);
    expect(ids(groups)).toEqual([["1", "2", "3"]]);
  });
});
