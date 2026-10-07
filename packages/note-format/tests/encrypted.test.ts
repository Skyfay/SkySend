// The whole path of a note, with the real crypto: the format package itself never touches a
// key, so these tests are where the format and @skysend/crypto meet.
import { describe, expect, it } from "vitest";
import { argon2id } from "hash-wasm";
import {
  applyPasswordProtection,
  calculateEncryptedSize,
  computeAuthToken,
  computeOwnerToken,
  createDecryptStream,
  createEncryptStream,
  createFileRequest,
  decryptMetadata,
  decryptNoteContent,
  decryptRequestMetadata,
  deriveInboxKeys,
  deriveKeyFromPassword,
  deriveKeys,
  encryptMetadata,
  encryptNoteContent,
  expectedPlaintextSize,
  fromBase64url,
  generateSalt,
  generateSecret,
  openRequestKey,
  randomBytes,
  toBase64url,
  unwrapFileSecret,
  wrapFileSecret,
  PASSWORD_SALT_LENGTH,
  TAG_LENGTH,
  type Argon2idHashFn,
} from "@skysend/crypto";
import {
  NOTE_KIND,
  NOTE_PAD_BLOCK,
  padNote,
  parseNote,
  readNote,
  serializeNote,
  type NoteBlock,
} from "../src/index.js";
import fixtures from "./fixtures/encrypted-notes.json";

// The real Argon2id the web app and the CLI client use, with the production parameters.
const argon2: Argon2idHashFn = async (password, salt, params) =>
  new Uint8Array(
    await argon2id({
      password,
      salt,
      parallelism: params.parallelism,
      iterations: params.iterations,
      memorySize: params.memory,
      hashLength: params.hashLength,
      outputType: "binary",
    }),
  );

// The API carries ciphertext and nonce as standard base64, like the web app decodes them.
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

const BLOCKS: NoteBlock[] = [
  { type: "text", format: "plain", text: "Access to staging" },
  { type: "password", entries: [{ label: "admin", value: "Xq8!pL2#vN7@kR4m" }] },
  { type: "code", title: "", language: "auto", code: "make deploy" },
];

/** Encrypts like useNoteUpload in the web app. Returns what the server and the link hold. */
async function createNote(blocks: NoteBlock[], password = "") {
  const secret = generateSecret();
  const salt = generateSalt();
  const keys = await deriveKeys(secret, salt);
  const encrypted = await encryptNoteContent(serializeNote(blocks), keys.metaKey);
  let link = secret;
  let passwordSalt: Uint8Array | undefined;
  if (password) {
    passwordSalt = randomBytes(PASSWORD_SALT_LENGTH);
    const { key } = await deriveKeyFromPassword(password, passwordSalt, argon2);
    link = applyPasswordProtection(secret, key);
  }
  return { ...encrypted, salt, link, passwordSalt, authToken: await computeAuthToken(keys.authKey) };
}

/** Decrypts like useNoteView in the web app, starting from the secret in the link. */
async function openNote(
  note: { link: Uint8Array; salt: Uint8Array; ciphertext: Uint8Array; nonce: Uint8Array; passwordSalt?: Uint8Array },
  kind: string,
  password = "",
) {
  let secret = note.link;
  if (note.passwordSalt) {
    const { key } = await deriveKeyFromPassword(password, note.passwordSalt, argon2);
    secret = applyPasswordProtection(secret, key);
  }
  const keys = await deriveKeys(secret, note.salt);
  const plaintext = await decryptNoteContent(note.ciphertext, note.nonce, keys.metaKey);
  return { blocks: readNote(kind, plaintext), authToken: await computeAuthToken(keys.authKey) };
}

describe("notes encrypted before this version", () => {
  it.each(fixtures.notes)("still opens $name", async (fixture) => {
    const note = {
      link: fromBase64url(fixture.link),
      salt: fromBase64url(fixture.salt),
      ciphertext: fromBase64(fixture.ciphertext),
      nonce: fromBase64(fixture.nonce),
      ...("passwordSalt" in fixture ? { passwordSalt: fromBase64url(fixture.passwordSalt) } : {}),
    };
    const opened = await openNote(note, fixture.kind, "password" in fixture ? fixture.password : "");

    // The server lets the reader in only with the auth token it stored at creation.
    expect(toBase64url(opened.authToken)).toBe(fixture.authToken);
    // The owner token in "My Uploads" still matches, so the owner can still delete the note.
    expect(toBase64url(await computeOwnerToken(note.link, note.salt))).toBe(fixture.ownerToken);
    expect(opened.blocks).toEqual(fixture.blocks);
  });

  // LEGACY(notes-v1): once the legacy fixtures are gone, this checks the blocks notes only.
  it("covers every legacy kind, both password paths and both salt lengths", () => {
    const kinds = new Set(fixtures.notes.map((note) => note.kind));
    expect([...kinds].sort()).toEqual(["blocks", "code", "markdown", "password", "sshkey", "text"]);
    expect(fixtures.notes.some((note) => "password" in note && note.kind === NOTE_KIND)).toBe(true);
    expect(fixtures.notes.some((note) => "password" in note && note.kind !== NOTE_KIND)).toBe(true);
    expect(new Set(fixtures.notes.map((note) => fromBase64url(note.salt).length))).toEqual(new Set([16, 32]));
  });
});

describe("a note made of blocks", () => {
  it("round-trips through the real encryption", async () => {
    const note = await createNote(BLOCKS);
    expect((await openNote(note, NOTE_KIND)).blocks).toEqual(BLOCKS);
  });

  it("round-trips with a note password, and only with the right one", async () => {
    const note = await createNote(BLOCKS, "s3cret pass");
    const opened = await openNote(note, NOTE_KIND, "s3cret pass");
    expect(opened.blocks).toEqual(BLOCKS);
    expect(opened.authToken).toEqual(note.authToken);

    // A wrong password gives a different key: the auth token no longer matches the one the
    // server holds, and the content does not decrypt either.
    await expect(openNote(note, NOTE_KIND, "wrong pass")).rejects.toThrow();
  });

  it("does not open with the secret of another note", async () => {
    const note = await createNote(BLOCKS);
    const other = await createNote(BLOCKS);
    await expect(openNote({ ...note, link: other.link }, NOTE_KIND)).rejects.toThrow();
  });

  it("does not open with another salt", async () => {
    const note = await createNote(BLOCKS);
    await expect(openNote({ ...note, salt: generateSalt() }, NOTE_KIND)).rejects.toThrow();
  });

  it("rejects ciphertext that was changed anywhere, including the tag", async () => {
    const note = await createNote(BLOCKS);
    for (const index of [0, Math.floor(note.ciphertext.length / 2), note.ciphertext.length - 1]) {
      const changed = note.ciphertext.slice();
      changed[index]! ^= 0x01;
      await expect(openNote({ ...note, ciphertext: changed }, NOTE_KIND)).rejects.toThrow();
    }
  });

  it("rejects a changed nonce and a cut off ciphertext", async () => {
    const note = await createNote(BLOCKS);
    const nonce = note.nonce.slice();
    nonce[0]! ^= 0x01;
    await expect(openNote({ ...note, nonce }, NOTE_KIND)).rejects.toThrow();
    await expect(openNote({ ...note, ciphertext: note.ciphertext.slice(0, -1) }, NOTE_KIND)).rejects.toThrow();
  });

  it("encrypts the same note to a different nonce and ciphertext every time", async () => {
    const first = await createNote(BLOCKS);
    const keys = await deriveKeys(first.link, first.salt);
    const again = await encryptNoteContent(serializeNote(BLOCKS), keys.metaKey);
    expect(again.nonce).not.toEqual(first.nonce);
    expect(again.ciphertext).not.toEqual(first.ciphertext);
  });

  it("adds only the GCM tag to the size, so the server's size check stays the same", async () => {
    const note = await createNote(BLOCKS);
    const plaintextBytes = new TextEncoder().encode(serializeNote(BLOCKS)).length;
    expect(note.ciphertext.length).toBe(plaintextBytes + TAG_LENGTH);
  });

  it("keeps the block types out of what the server sees", async () => {
    const note = await createNote(BLOCKS);
    const visible = new TextDecoder().decode(note.ciphertext);
    for (const word of ["password", "text", "code", "admin", "staging"]) {
      expect(visible).not.toContain(word);
    }
    // All the server learns about the kind of a new note is NOTE_KIND.
    expect(NOTE_KIND).toBe("blocks");
  });
});

describe("a note sent into a file request", () => {
  it("travels padded, as an upload wrapped to the requester, and opens in the inbox", async () => {
    const requestId = crypto.randomUUID();
    const uploadId = crypto.randomUUID();
    const { local, server } = await createFileRequest({ asks: ["note"] });
    const blocks: NoteBlock[] = [
      { type: "password", entries: [{ label: "PIN", value: "4711" }] },
      { type: "text", format: "plain", text: "Behind the plant", label: "Where" },
    ];

    // The sender: padded note, ECE under a fresh file key, note metadata, the wrap.
    const bytes = new TextEncoder().encode(padNote(serializeNote(blocks)));
    expect(bytes.length % NOTE_PAD_BLOCK).toBe(0);
    const secret = generateSecret();
    const salt = generateSalt();
    const keys = await deriveKeys(secret, salt);
    const encrypted = new Blob([bytes]).stream().pipeThrough(createEncryptStream(keys.fileKey));
    const ciphertext = new Uint8Array(await new Response(encrypted).arrayBuffer());
    expect(ciphertext.length).toBe(calculateEncryptedSize(bytes.length));
    const meta = await encryptMetadata({ type: "note", size: bytes.length }, keys.metaKey);
    const wrapped = await wrapFileSecret(local.publicKey, requestId, uploadId, secret);

    // The requester: the vault, the unwrap, the metadata of a request upload, the note.
    const { inboxKey } = await deriveInboxKeys(local.inboxSecret);
    const requestKey = await openRequestKey(
      server.vault,
      server.vaultNonce,
      inboxKey,
      server.brief,
    );
    const fileKeys = await deriveKeys(
      await unwrapFileSecret(requestKey, requestId, uploadId, wrapped),
      salt,
    );
    const metadata = await decryptRequestMetadata(meta.ciphertext, meta.iv, fileKeys.metaKey);
    expect(metadata).toEqual({ type: "note", size: bytes.length });
    const plain = new Blob([ciphertext])
      .stream()
      .pipeThrough(createDecryptStream(fileKeys.fileKey, expectedPlaintextSize(metadata)!));
    const text = new TextDecoder().decode(await new Response(plain).arrayBuffer());
    expect(parseNote(text)).toEqual(blocks);
    // A download page never takes it for a file.
    await expect(decryptMetadata(meta.ciphertext, meta.iv, fileKeys.metaKey)).rejects.toThrow();
  });
});
