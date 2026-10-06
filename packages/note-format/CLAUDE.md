# Note format

`@skysend/note-format` - the format of a note's content before it is encrypted, shared by the web app and the CLI client. Pure TypeScript plus Zod, no keys, no Web Crypto, no DOM. It runs in the browser and in Node 24 and Bun-compiled CLI binaries.

## Where it sits

```
blocks --serializeNote--> JSON document --encryptNoteContent (@skysend/crypto)--> ciphertext
ciphertext --decryptNoteContent--> plaintext --readNote(kind, plaintext)--> blocks
```

The encryption never sees blocks, only a string. This package never sees a key. Keep it that way: nothing here may import `@skysend/crypto` or touch a secret.

`kind` is the `contentType` the server stores. New notes use `NOTE_KIND` (`"blocks"`), so which blocks a note holds stays inside the ciphertext.

## Hard rules

1. **The document is a wire format.** Notes encrypted today have to open for as long as they live. A new version may add block types and optional fields. It may never rename, retype or remove an existing field, and `v` only goes up.
2. **Every decrypted document is untrusted.** Anyone with a link can send a crafted note. `parseNote` validates with Zod, caps the number of blocks and entries, and turns any block it cannot read into `{ type: "unsupported" }` instead of failing the whole note or passing it through.
3. **Renderers stay safe for every block.** This package only returns data. The web app renders text as text, Markdown through `rehype-sanitize`, code through DOMPurify. A server that lies about `kind` must only ever pick the wrong reader, never unlock unsafe rendering.
4. **`serializeNote` validates too**, so an editor bug cannot write a note its recipient cannot read.

## Legacy notes

Before v3 every note had one content type with a plaintext format of its own. `legacy.ts` turns those into blocks, following the v2 web app's parsing exactly, and `tests/legacy.test.ts` pins it with the formats v2 wrote.

Every piece that only exists for those notes is marked `LEGACY(notes-v1)`, and the exported ones are `@deprecated`. `grep -rn "LEGACY(notes-v1)"` across the repo finds all of them. They go once no legacy note can exist anymore, following the removal checklist in the developer docs. Do not extend them.

## Tests

`tests/`, run with `pnpm --filter @skysend/note-format test`. Coverage is 100% and should stay there. Every format change needs a round-trip test, a test that a reader of the previous version still copes, and a test for what a crafted document does.
