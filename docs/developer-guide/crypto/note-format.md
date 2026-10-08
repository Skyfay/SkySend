# Note Format

Since v3 a note is made of blocks: text, passwords, code and SSH keys, in any order. Before it is encrypted, a note is serialized into a JSON document, and that document is the plaintext that `encryptNoteContent()` encrypts with AES-256-GCM and the `metaKey`.

The format lives in `@skysend/note-format` (`packages/note-format`), which the web app and the CLI client share. The package never sees a key, and the encryption never sees a block:

```
blocks --serializeNote()--> JSON document --encryptNoteContent(document, metaKey)--> ciphertext
ciphertext --decryptNoteContent(ciphertext, nonce, metaKey)--> plaintext --readNote(kind, plaintext)--> blocks
```

`kind` is the `contentType` the server stores for the note. Every note created since v3 has the content type `blocks`, so which blocks a note holds stays inside the ciphertext.

## Document

```json
{
  "v": 1,
  "blocks": [
    { "type": "text", "format": "markdown", "text": "# Staging server" },
    { "type": "password", "entries": [{ "label": "root", "value": "s3cret" }] },
    { "type": "code", "title": "deploy.sh", "language": "bash", "code": "make deploy" },
    { "type": "sshkey", "publicKey": "ssh-ed25519 AAAA...", "privateKey": "", "passphrase": "" }
  ]
}
```

| Field | Description |
| --- | --- |
| `v` | Format version, a positive integer. This version writes `1` and reads `1` and every later version. |
| `blocks` | The blocks in the order they are shown. At least 1, at most 50. |

## Block Types

```typescript
interface TextBlock {
  type: "text"
  format: "plain" | "markdown"
  text: string
  label?: string // what the text is about, shown above it, optional since it came after v1
}

interface PasswordBlock {
  type: "password"
  entries: Array<{ label: string; value: string; secret?: false }> // at most 100, label may be empty
  label?: string // the title of the block, like "Server access", optional like the text label
}

interface CodeBlock {
  type: "code"
  title: string    // may be empty
  language: string // a highlight.js language name, or "auto" to detect it, at most 40 characters
  code: string
}

interface SshKeyBlock {
  type: "sshkey"
  publicKey: string  // either key may be empty
  privateKey: string
  passphrase: string // the passphrase of the private key, may be empty
  label?: string     // the title of the block, like "Deploy key", optional like the text label
}
```

Every field but the labels of the blocks and `secret` is required. A code block has a `title` for its file name instead, so it needs no label. A writer that has nothing for a field writes an empty string. `secret: false` marks a password entry whose value is no secret, like a username or an address. Readers show it in clear, and an entry without it is a secret, as every entry was before the field existed.

## Writing

```typescript
const document = serializeNote(blocks)
const { ciphertext, nonce } = await encryptNoteContent(document, metaKey)
```

`serializeNote()` validates every block before the note is encrypted, so an editor bug cannot write a note its recipient fails to read. It drops fields that are not part of the format, such as the ids an editor keeps for its own bookkeeping, and throws a `NoteFormatError` for an empty note, more than 50 blocks or an invalid block.

`NOTE_MAX_SIZE` applies to the whole document, not to each block.

## Reading

```typescript
const plaintext = await decryptNoteContent(ciphertext, nonce, metaKey)
const blocks = readNote(contentType, plaintext)
```

`readNote()` picks the reader by the content type the server reports:

- `blocks` goes to `parseNote()`. It parses the JSON, checks `v` and the number of blocks, and then checks each block on its own. A block it cannot read, of a type from a later version or malformed, comes back as `{ type: "unsupported" }` and is shown as a notice, while the other blocks are shown as usual.
- A content type from before v3 goes to the legacy reader, see [Content Types](#content-types).
- Anything else throws a `NoteFormatError`.

When reading throws, the web app and the CLI client show the decrypted plaintext as plain text with a warning. The view is counted by then, and a note with a view limit of 1 is already deleted, so the content must not be lost.

`noteToText(blocks)` joins the blocks into one text, for "Copy all" in the web app and for saving a note in the CLI client.

## Templates

A file request can ask a sender for a note and lay out the fields the sender fills in. That template is a note document without values:

```typescript
const template = serializeTemplate(blocks) // { v: 1, blocks } with every value emptied
const fields = parseTemplate(template)     // the blocks a sender fills in
```

- `serializeTemplate()` validates the blocks like `serializeNote()`, empties every value and cleans every label.
- `parseTemplate()` treats the template as untrusted, since the requester wrote it and every sender reads it. It drops blocks it cannot read and throws away any value a crafted template carries, so a template can never put words into an answer. A language name that is not plain letters, digits and `_+#.-` becomes `auto`.
- `cleanLabel()` keeps a label to one line of at most 100 characters, without control, format or reordering characters, blank fillers or towers of combining marks. The zero-width joiner and non-joiner stay.

The template travels inside the encrypted brief of the request, see [File Requests](/developer-guide/crypto/file-requests#the-brief). Every note made of blocks, a shared note as well as one sent into a request, is padded with `padNote()` to a multiple of 1024 bytes before it is encrypted, so its length tells little about how long a password in it is. JSON allows the trailing spaces, so `parseNote()` reads it like any other note, and older readers do too. A note in the legacy format is never padded. A client checks the padded size against the note limit of the instance, so a padded note fits every version of the server.

## Security Properties

- **The server learns less.** Before v3 the server stored whether a note held text, a password, code or an SSH key. Since v3 it stores `blocks` for every note.
- **Every decrypted document is untrusted.** Anyone can create a note with a crafted document. `parseNote()` validates the whole shape with Zod and caps the number of blocks, the number of password entries and the length of the language name.
- **Legacy notes are capped too.** A note from before v3 with more than 50 code blocks or 100 passwords is shown as plain text, like a document that cannot be read. The private key in an SSH key note is found in linear time with `findPrivateKey()`, which returns exactly what the regex of v2 matched. That regex backtracked catastrophically on crafted notes.
- **Rendering is bounded.** The web app highlights code up to 16KB per block and 32KB per note, because highlight.js takes quadratic time on crafted code. Markdown images are never loaded. The CLI client shows control characters and bidirectional overrides as a replacement character instead of passing them to the terminal.
- **The content type is untrusted.** A server that reports the wrong content type only picks the wrong reader. Every reader returns plain data, and the web app renders text as text, Markdown through `rehype-sanitize` and highlighted code through DOMPurify, which only lets `span` elements with a `class` through.
- **The encryption is unchanged.** Notes made of blocks use the same `encryptNoteContent()`, keys, nonce and password protection as the notes before v3.

## Versioning Rules

The document is a wire format. A note encrypted today has to open for as long as it lives.

1. A new version may add block types and optional fields.
2. It may never rename, retype or remove an existing field, and `v` only goes up.
3. A reader of an older version shows the blocks it knows and marks the others as unsupported. It ignores fields it does not know.
4. Every format change needs a round-trip test, a test that a reader of the previous version still copes, a test for a crafted document, and a new encrypted fixture in `packages/note-format/tests/fixtures/encrypted-notes.json`.

## Content Types

| contentType | Written by | Plaintext |
| --- | --- | --- |
| `blocks` | Web app and CLI client since v3 | The note document |
| `text` | Before v3 | The text |
| `markdown` | Before v3 | The Markdown |
| `password` | Before v3 | A JSON array of `{ label, value }`. The oldest notes hold passwords separated by a blank line. |
| `code` | Before v3 | A JSON array of `{ title, language, code }`. The oldest notes hold the code itself. |
| `sshkey` | Before v3 | Public key, private key and a `Passphrase: ...` line, separated by blank lines |

The legacy readers turn each of these into blocks and follow the parsing of the v2 web app exactly. `packages/note-format/tests/fixtures/encrypted-notes.json` holds real notes encrypted with the v2 code, one per content type, with a note password and with the older 16-byte salt, and the tests open each of them with the real crypto.

## Compatibility

The web app always comes from the server it talks to. The CLI client does not:

| | Server before v3 | Server v3 |
| --- | --- | --- |
| **CLI client before v3** | Creates and opens notes before v3 | Creates notes before v3, cannot open notes made of blocks |
| **CLI client v3** | Creates and opens notes before v3 | Creates and opens notes made of blocks, opens notes before v3 |

A v3 server reports `noteBlocks: true` in [`/api/config`](/developer-guide/api/#get-api-config). A CLI client from v3 on creates a note made of blocks when the flag is there, and a note in the format before v3 when it is missing.

## Legacy Removal Checklist

Everything that only exists for notes from before v3 is marked with the comment `LEGACY(notes-v1)`, and every legacy export of `@skysend/note-format` is `@deprecated`. It goes in two phases.

```bash
grep -rn "LEGACY(notes-v1)" apps packages
```

### Phase 1: Stop Accepting Legacy Content Types

**When:** a v3.x release, no earlier than three months after v3.0.0. CLI clients before v3 can no longer create notes from then on, so the release notes need a breaking change.

1. `apps/server/src/routes/note.ts`: remove the legacy values from `NOTE_CONTENT_TYPES`. Stored legacy notes keep opening, reading does not depend on this list.
2. `apps/server/tests/notes.test.ts`: remove the test that accepts every content type from before v3, and add those content types to the rejected ones.
3. `apps/client/src/lib/note.ts`: remove `toLegacyNote()` and the fallback in `prepareNote()`. The client then refuses a server that does not report `noteBlocks` with a message to update the server.
4. `apps/client/src/lib/api.ts`: `CreateNoteRequest.contentType` becomes `typeof NOTE_KIND`.
5. `apps/client/tests/lib/note.test.ts`: remove the `toLegacyNote` tests, the fallback test and the `false` case of the round trip.
6. Docs: the content types the [notes API](/developer-guide/api/notes) accepts, the [compatibility table](#compatibility), and the fallback in the [CLI client commands](/user-guide/client-cli/commands#note).

### Phase 2: Stop Reading Legacy Notes

**When:** v4.0.0 at the earliest, and no earlier than the longest note expiry after phase 1 shipped. Phase 1 stops new legacy notes, so the last one expires within the largest value of `NOTE_EXPIRE_OPTIONS_SEC` (7 days by default). An instance that skips phase 1 can still hold legacy notes, so the release notes need a breaking change.

1. `packages/note-format/src/legacy.ts`: delete the file, its exports in `src/index.ts` and the legacy branch in `src/read.ts`.
2. `packages/note-format/tests/`: delete `legacy.test.ts` and the legacy cases in `read.test.ts`. Remove the fixtures whose `kind` is not `blocks` from `fixtures/encrypted-notes.json` and keep the others. This is the only edit that file may ever get. Adjust the coverage test in `encrypted.test.ts` to the fixtures that are left.
3. `apps/web/src/lib/api.ts` and `apps/client/src/lib/api.ts`: the `contentType` of the note info becomes `z.string()`. A legacy note that outlived phase 2 then opens as unreadable plain text instead of failing.
4. `apps/web/src/lib/note-editor.ts`: remove the legacy branch of `storedNoteKinds()`, and its test in `apps/web/tests/lib/note-editor.test.ts`. In `apps/web/src/lib/upload-store.ts`, `StoredNote.contentType` becomes `typeof NOTE_KIND`. Old entries in a browser's "My Uploads" only lose their type icon.
5. `apps/web/tests/hooks/useNoteView.test.ts` and `apps/client/tests/lib/note.test.ts`: remove the cases that read a legacy note.
6. `packages/crypto/src/note.ts` and `src/index.ts`: remove the types `NoteContentType` and `NoteMetadata`. They are not marked, they describe the format before v3 and nothing uses them.
7. `apps/server/src/db/schema.ts`: the comment on `content_type`.
8. Docs: the legacy rows of [Content Types](#content-types) on this page and in [Encryption](/user-guide/security/encryption#content-types), the notes API, and this checklist.

### Verifying

- After phase 1, `grep -rn "LEGACY(notes-v1)" apps packages` only finds the pieces of phase 2. After phase 2 it finds nothing.
- `pnpm validate` passes.
- Before phase 2 ships, `skysend-cli list` on an instance shows the content type of every note that can still be opened. Every note should show `blocks`.
