# Transfer Core

`@skysend/transfer` in `packages/transfer` holds what an upload, a download, a note and a file request need besides the cryptography: the API client, the links, the zip of several files, the upload pipeline with both transports, the decryption of a download with its checks, the creating and opening of a note, and both sides of a file request. The web app, the CLI client and the server's contract tests use it, and a mobile app can later. The cryptography itself stays in [`@skysend/crypto`](/developer-guide/crypto/), the note content in [`@skysend/note-format`](/developer-guide/crypto/note-format).

Before this package, the web app and the CLI each had their own copy of the upload, the download, the notes, the links, the cleaning of names and the API schemas, and the copies drifted apart: the CLI read whole files into memory on a slow connection, packed several files with fflate in memory and broke them past 4 GiB, put no stream nonce into the metadata and did not check one on download.

## What it holds

| File | What it does |
| --- | --- |
| `src/api.ts` | `createApiClient`: every route of the server, every answer parsed with Zod, failures as `ApiError` |
| `src/upload.ts` | `uploadEncrypted`: keys, encryption, WebSocket or HTTP chunks, metadata at the end, for a share and for a file request |
| `src/download.ts` | `keysFromLink`, `decryptUploadMetadata`, `decryptedStream`: from the link to the checked plaintext |
| `src/links.ts` | `buildShareLink` and `parseShareLink`: `<server>/<type>/<id>#<secret>` for a share, a note, a request and an inbox, `/d/<id>` as the old form of a file link |
| `src/request.ts` | `prepareRequest` and `briefFits` for making a request, `openRequestLink` and `newSubmission` for a sender |
| `src/inbox.ts` | `openInboxLink`, `openInbox`, `groupBySubmission`, `readInboxNote`: the inbox opened with the key in its link |
| `src/names.ts` | `sanitizeFilename` and `sanitizeTitle` for names and titles from someone else |
| `src/note.ts` | `createEncryptedNote` and `openNote`: a note from its plaintext to the link, and from the link back to its blocks |
| `src/zip.ts` | The zip of several files, stored without compression, written while the upload reads it, ZIP64 from 4 GiB on |
| `src/archive.ts` | The metadata of several files, whether it fits the server's limit, and unique names in the zip |
| `src/index.ts` | The public API. Nothing outside the package imports anything else |

## What each platform hands in

The package uses only standard APIs: Web Crypto, Web Streams, `fetch`, `WebSocket`, `Blob`, `TextEncoder` and Zod. It runs in a page, a Web Worker, Node, a Bun binary and later React Native, and what differs between them is handed in:

| Part | Web app | CLI |
| --- | --- | --- |
| `fetch` and base URL | The page's own origin, `""` | The server of the command or the TUI |
| `openWebSocket(url)` | `new WebSocket(url)`, the session cookie goes along | A WebSocket with `Authorization: Bearer` when the server wants OIDC |
| `argon2id` | hash-wasm in the browser | hash-wasm in Node or Bun |
| A file, `SourceFile` | A `File` of the file input | `fs.openAsBlob`, which reads only what the upload takes |
| Where a download goes | The four download tiers of the browser | A hidden `.part` file next to the target, renamed at the end |

Streams are read with `getReader()`, never with `for await` or `ReadableStream.from`, which Safari does not have.

## Upload

`uploadEncrypted` takes the plaintext as a stream of exactly the size the metadata names: one file as it is, or the zip that `plaintextOf` writes while the upload reads it, under the names of the metadata. It derives the keys, sends the stream over the WebSocket when the server offers it and `openWebSocket` is given, and over HTTP chunks otherwise or when the WebSocket handshake fails, then saves the encrypted metadata with the base nonce of the stream in it.

The WebSocket keeps between 8 and 16 MiB in flight. The HTTP transport sends 10 MiB chunks, as many at once as the server's `fileUploadConcurrentChunks` allows, and never more than `CHUNK_WINDOW` (32) chunks past the oldest one still open. The server writes chunks in order and holds at most 64 of them back. Without the window, one chunk that a reverse proxy held for a few seconds let the client run into that limit, the server answered 429 and Nginx turned it into a 502, which broke CLI uploads above about 640 MB behind the Nginx of the docs.

The events of an upload, `onPhase`, `onProgress`, `onTransport`, `onStorage` and `onSession`, are what the web app's upload worker turns into messages for the page and what the CLI turns into its progress bar. The errors keep the texts the web app recognises, like `S3 CORS` and the keys of a file request (`full`, `gone`, `quota`, `closed`, `tooLarge`).

## Download

`keysFromLink` turns the fragment of a link, and the password where there is one, into the keys and the auth token. `decryptUploadMetadata` decrypts the metadata, and `decryptedStream` decrypts the ciphertext and checks it against the metadata: the size, and the base nonce of the stream where the uploader named it. A server that cuts the ciphertext short, swaps records or reorders them so that each record still decrypts fails the download. An upload of an older client without a base nonce still opens, without that check.

## Notes

`createEncryptedNote` takes the plaintext of a note and its content type, encrypts it, puts the password over the secret the same way an upload does, and creates the note. The plaintext is what `@skysend/note-format` makes of the blocks, padded to whole blocks, so the server learns only that the note is made of blocks. The CLI hands in a note in the format from before v3 for a server that does not report `noteBlocks`, which is why the caller makes the plaintext and not the package.

`openNote` checks the password of a protected note before it asks for the view, so a wrong password uses up no view and comes back as `null`. The view counts on the server, and with a limit of one it destroys the note, so a note that does not parse comes back as its plain text with `unreadable` set instead of being lost. Notes from before v3 read through the legacy readers of `readNote`.

## File Requests

`openRequestLink` reads an upload link the way every sender does: the keys from its fragment, then from the server how much the request still takes and its brief, which only the key from the link opens. It answers `invalid` for a link that does not decode, `gone` for a request the server does not have, `broken` for a brief that is missing or does not open, and otherwise the request with its cleaned title, what it asks for and its note template. The public key of the request comes from the link and never from the server, which could swap in its own. The upload itself is `uploadEncrypted` with a `request` target, its metadata marked with a `newSubmission`.

`openInbox` opens the vault of an inbox and every upload in it, each on its own, so a damaged or crafted upload shows as damaged and does not hide the others. `readInboxNote` checks the size of a note before it reads it and cleans every label a sender wrote. Names and titles go through `sanitizeFilename` and `sanitizeTitle` before anyone sees them. The CLI adds what a local disk needs on top.

Making a request stays in the web app, which keeps its links in the browser. The CLI sends into requests that ask for files and opens inboxes, see the [CLI commands](/user-guide/client-cli/commands#inbox).

## The API client and older servers

`createApiClient({ baseUrl, fetch, bearer, cleanMessage })` returns one method per route. Every answer goes through a Zod schema before the caller sees it, since the server is not trusted. The web app always talks to the server it came from, the CLI to instances of every version, so a field that an older supported server does not send gets `.optional().default(...)` or `.catch(...)`, never a plain required schema. `bearer` goes only to the routes that create something, and `cleanMessage` lets a terminal disarm a server's error message before `ApiError` carries it.

`apps/server/tests/api-contract.test.ts` reads the real routes of the server with this client, so a change to a route that the clients would no longer read fails before a release.

## Tests

```bash
pnpm --filter @skysend/transfer test
```

| File | Tests |
| --- | --- |
| `zip.test.ts` | The zip against `node:zlib` and fflate, and a file of 4 GiB and one byte streamed through the writer for ZIP64 |
| `archive.test.ts` | The metadata of several files, its size check, unique names in the zip |
| `upload.test.ts` | Both transports against a fake server, the fallback, the chunk window with a chunk held back, the error texts |
| `download.test.ts` | Keys from a link with and without a password, the checks of size and base nonce |
| `links.test.ts` | Links of every type built and read, the old `/d/` path, a link without its fragment, a type the caller does not open |
| `requests.test.ts` | A request made and its brief read, an upload link opened, gone or with a swapped brief, inboxes with and without a password, damaged uploads, notes in an inbox, names and titles cleaned |
| `note.test.ts` | A note through a fake server and back, with and without a password, a wrong password that uses up no view, a legacy note and one that does not parse |

The end-to-end tests send shares between the browser and the CLI in both directions, see the [Testing Guide](/developer-guide/reference/testing#end-to-end-tests).
