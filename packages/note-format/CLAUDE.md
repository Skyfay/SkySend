# Note format

`@skysend/note-format` - the format of a note's content before it is encrypted, shared by the web app and the CLI client. Pure TypeScript plus Zod, no keys, no Web Crypto, no DOM. It runs in the browser and in Node 24 and Bun-compiled CLI binaries.

## Where it sits

```
blocks --serializeNote--> JSON document --encryptNoteContent (@skysend/crypto)--> ciphertext
ciphertext --decryptNoteContent--> plaintext --readNote(kind, plaintext)--> blocks
```

The encryption never sees blocks, only a string. This package never sees a key. Keep it that way: nothing in `src/` may import `@skysend/crypto` or touch a secret. Only the tests use it, as a dev dependency, to run the whole path.

`kind` is the `contentType` the server stores. New notes use `NOTE_KIND` (`"blocks"`), so which blocks a note holds stays inside the ciphertext.

## Hard rules

1. **The document is a wire format.** Notes encrypted today have to open for as long as they live. A new version may add block types and optional fields. It may never rename, retype or remove an existing field, and `v` only goes up.
2. **Every decrypted document is untrusted.** Anyone with a link can send a crafted note. `parseNote` validates with Zod, caps the number of blocks and entries, and turns any block it cannot read into `{ type: "unsupported" }` instead of failing the whole note or passing it through.
3. **Renderers stay safe for every block.** This package only returns data. The web app renders text as text, Markdown through `rehype-sanitize`, code through DOMPurify. A server that lies about `kind` must only ever pick the wrong reader, never unlock unsafe rendering.
4. **`serializeNote` validates too**, so an editor bug cannot write a note its recipient cannot read.

## Templates

`template.ts` holds the templates of file requests: a note document without values, which a requester lays out and a sender fills in. `parseTemplate` treats one as untrusted input like a note, throws every value away and cleans every label with `cleanLabel`. `padNote` pads a note sent into a request to whole 1 KiB blocks. A template is shaped like a note, so a filled-in template is a note and needs no format of its own.

## Legacy notes

Before v3 every note had one content type with a plaintext format of its own. `legacy.ts` turns those into blocks, following the v2 web app's parsing exactly, and `tests/legacy.test.ts` pins it with the formats v2 wrote.

Every piece that only exists for those notes is marked `LEGACY(notes-v1)`, and the exported ones are `@deprecated`. `grep -rn "LEGACY(notes-v1)"` across the repo finds all of them. They go once no legacy note can exist anymore, following the removal checklist in [docs/developer-guide/crypto/note-format.md](../../docs/developer-guide/crypto/note-format.md#legacy-removal-checklist). Do not extend them.

## Tests

`tests/`, run with `pnpm --filter @skysend/note-format test`. Coverage is 100% and should stay there. `tsconfig.test.json` typechecks the tests as part of `pnpm typecheck`. Every format change needs a round-trip test, a test that a reader of the previous version still copes, and a test for what a crafted document does.

`tests/encrypted.test.ts` runs the real path with `@skysend/crypto` and hash-wasm's Argon2id: link secret, note password, HKDF, auth and owner token, AES-256-GCM, reader. `tests/fixtures/encrypted-notes.json` holds notes encrypted with the v2 code and the v3.0 format, one per legacy kind, with a note password, and with a 16-byte salt. **Never regenerate or edit that file.** A failing fixture means real notes on real servers stop opening. Add a new fixture when a new format version ships, and leave the old ones in place. The one exception is phase 2 of the removal checklist, which removes the legacy fixtures.
