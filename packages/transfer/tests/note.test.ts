import { describe, expect, it } from "vitest";
import { argon2id } from "hash-wasm";
import { computeOwnerToken, fromBase64url, type Argon2idHashFn } from "@skysend/crypto";
import { NOTE_KIND, padNote, serializeNote, type NoteBlock } from "@skysend/note-format";
import { ApiError, type CreateNoteRequest, type NoteInfo } from "../src/api.js";
import { createEncryptedNote, openNote } from "../src/note.js";

const hashWasm: Argon2idHashFn = async (password, salt, params) =>
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

/** The note routes of a server, kept in memory, checking the auth token like the real one. */
function fakeServer() {
  const notes = new Map<string, { request: CreateNoteRequest; views: number }>();
  const noteOf = (id: string) => {
    const note = notes.get(id);
    if (!note) throw new ApiError(404, "Note not found");
    return note;
  };
  return {
    notes,
    async createNote(request: CreateNoteRequest) {
      const id = `note-${notes.size + 1}`;
      notes.set(id, { request, views: 0 });
      return { id, expiresAt: "2099-01-01T00:00:00Z" };
    },
    async verifyNotePassword(id: string, authToken: string) {
      return noteOf(id).request.authToken === authToken;
    },
    async viewNote(id: string, authToken: string) {
      const note = noteOf(id);
      if (note.request.authToken !== authToken) throw new ApiError(401, "Invalid auth token");
      note.views += 1;
      // The server keeps the bytes and answers in standard base64, whatever it was sent.
      const again = (text: string) => Buffer.from(text, "base64").toString("base64");
      return {
        encryptedContent: again(note.request.encryptedContent),
        nonce: again(note.request.nonce),
        viewCount: note.views,
        maxViews: note.request.maxViews,
      };
    },
    info(id: string): NoteInfo {
      const { request } = noteOf(id);
      return {
        id,
        contentType: request.contentType,
        hasPassword: request.hasPassword,
        passwordAlgo: request.passwordAlgo as NoteInfo["passwordAlgo"],
        passwordSalt: request.passwordSalt,
        salt: request.salt,
        maxViews: request.maxViews,
        viewCount: noteOf(id).views,
        expiresAt: "2099-01-01T00:00:00Z",
        createdAt: "2026-10-17T00:00:00Z",
      };
    },
  };
}

const blocks: NoteBlock[] = [
  { type: "text", format: "markdown", text: "# Access" },
  { type: "password", entries: [{ label: "root", value: "pw" }] },
];

async function shareNote(
  server: ReturnType<typeof fakeServer>,
  plaintext: string,
  contentType: CreateNoteRequest["contentType"],
  password = "",
) {
  return createEncryptedNote({
    api: server,
    plaintext,
    contentType,
    maxViews: 3,
    expireSec: 3600,
    password,
    argon2id: hashWasm,
  });
}

describe("createEncryptedNote and openNote", () => {
  it("sends a note of blocks encrypted and opens it from its link", async () => {
    const server = fakeServer();
    const shared = await shareNote(server, padNote(serializeNote(blocks)), NOTE_KIND);

    const request = server.notes.get(shared.id)!.request;
    expect(request.contentType).toBe("blocks");
    expect(request.hasPassword).toBe(false);
    expect(request.ownerToken).toBe(shared.ownerToken);
    // Nothing of the note and nothing of the link reach the server.
    expect(JSON.stringify(request)).not.toMatch(/markdown|password|Access|root/);
    expect(JSON.stringify(request)).not.toContain(shared.effectiveSecret);
    // The owner token is the one the link can prove.
    const ownerToken = await computeOwnerToken(
      fromBase64url(shared.effectiveSecret),
      fromBase64url(request.salt),
    );
    expect(Buffer.from(ownerToken).toString("base64url")).toBe(shared.ownerToken);

    const opened = await openNote({
      api: server,
      id: shared.id,
      info: server.info(shared.id),
      secret: shared.effectiveSecret,
      argon2id: hashWasm,
    });
    expect(opened).toEqual({ blocks, unreadable: false, viewCount: 1, maxViews: 3 });
  });

  it("opens a note with a password only with it, and a wrong one uses up no view", async () => {
    const server = fakeServer();
    const shared = await shareNote(
      server,
      padNote(serializeNote(blocks)),
      NOTE_KIND,
      "correct horse battery",
    );
    const request = server.notes.get(shared.id)!.request;
    expect(request.hasPassword).toBe(true);
    expect(request.passwordAlgo).toBe("argon2id-v2");
    expect(request.passwordSalt).toBeTruthy();

    const open = (password?: string) =>
      openNote({
        api: server,
        id: shared.id,
        info: server.info(shared.id),
        secret: shared.effectiveSecret,
        password,
        argon2id: hashWasm,
      });
    expect(await open()).toBeNull();
    expect(await open("wrong horse battery")).toBeNull();
    expect(server.notes.get(shared.id)!.views).toBe(0);
    expect((await open("correct horse battery"))?.blocks).toEqual(blocks);
  });

  // LEGACY(notes-v1): drop with the legacy readers.
  it("reads a note in the format of a server from before v3", async () => {
    const server = fakeServer();
    const shared = await shareNote(
      server,
      JSON.stringify([{ label: "", value: "old-pw" }]),
      "password",
    );
    const opened = await openNote({
      api: server,
      id: shared.id,
      info: server.info(shared.id),
      secret: shared.effectiveSecret,
      argon2id: hashWasm,
    });
    expect(opened?.blocks).toEqual([
      { type: "password", entries: [{ label: "", value: "old-pw" }] },
    ]);
  });

  it("gives a note that does not parse back as its text instead of losing it", async () => {
    const server = fakeServer();
    const shared = await shareNote(server, "not a document", NOTE_KIND);
    const opened = await openNote({
      api: server,
      id: shared.id,
      info: server.info(shared.id),
      secret: shared.effectiveSecret,
      argon2id: hashWasm,
    });
    expect(opened).toMatchObject({
      unreadable: true,
      blocks: [{ type: "text", format: "plain", text: "not a document" }],
    });
  });

  it("needs the salt of the password for a note that has one", async () => {
    const server = fakeServer();
    const shared = await shareNote(server, "x", NOTE_KIND, "correct horse battery");
    await expect(
      openNote({
        api: server,
        id: shared.id,
        info: { ...server.info(shared.id), passwordSalt: undefined },
        secret: shared.effectiveSecret,
        password: "correct horse battery",
        argon2id: hashWasm,
      }),
    ).rejects.toThrow("Missing password salt");
  });
});
