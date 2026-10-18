# Transfer

`@skysend/transfer` - what an upload, a download and a note need besides the cryptography, shared by the web app, the CLI client and later a mobile app. The cryptography itself stays in `@skysend/crypto`, the note content in `@skysend/note-format`.

## What lives here

```
src/api.ts      createApiClient: every route of the server, every answer parsed with Zod, ApiError
src/upload.ts   uploadEncrypted: keys, encryption, WebSocket or HTTP chunks with CHUNK_WINDOW, metadata
src/download.ts keysFromLink, decryptUploadMetadata, decryptedStream with the size and base nonce checks
src/note.ts     createEncryptedNote and openNote: the caller makes the plaintext, the package the rest
src/links.ts    buildShareLink and parseShareLink, the caller names the types it opens
src/zip.ts      The zip of several files, written while the upload reads it (stored, ZIP64)
src/archive.ts  The metadata of an upload of several files, whether the server takes it, uniqueNames
src/index.ts    The public API, the only file outside this package may import from
```

## Rules

1. **Only standard APIs.** Web Crypto, Web Streams, `fetch`, `WebSocket`, `Blob`, `TextEncoder`, Zod. No DOM, no `node:*`, nothing of Bun, no `import.meta.env`. The package runs in a page, a Web Worker, Node, a Bun binary and later React Native. What differs between them is handed in, like `fetch` and the base URL of the client.
2. **Read streams with `getReader()`.** No `for await` over a `ReadableStream` and no `ReadableStream.from`: Safari has neither, and React Native gets streams from a polyfill.
3. **The server is not trusted.** Every answer goes through a Zod schema, and an error message is the server's word. A terminal passes `cleanMessage` (the CLI passes `forTerminal`), so a message is disarmed before an `ApiError` carries it.
4. **Old servers.** The web app talks to the server it came from, the CLI and the app to instances of every version. A field a supported older server does not send gets `.optional().default(...)` or `.catch(...)`, never a plain required schema. `apps/server/tests/api-contract.test.ts` reads the real routes with this client.
5. **Error texts are part of the API.** The web app recognises errors by their text (`showKnownErrorToast` in `apps/web/src/lib/toast.tsx` looks for `S3 CORS`, among others) and by status. Keep a message when the code around it moves.
6. **OIDC only where the server guards.** `bearer` goes to the routes that create something: upload init, note, request, request limit. A download never carries it.

## Tests

The published guide is `docs/developer-guide/transfer.md`, keep both in step.

Vitest in `tests/`, run with `pnpm --filter @skysend/transfer test`. The zip tests check the output against `node:zlib` and fflate, and stream a file of 4 GiB and one byte through the writer, keeping only the records past 4 GiB, to check ZIP64.
