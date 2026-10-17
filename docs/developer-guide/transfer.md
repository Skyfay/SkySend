# Transfer Core

`@skysend/transfer` in `packages/transfer` holds what an upload and a download need besides the cryptography: the API client, the zip of several files, the upload pipeline with both transports, and the decryption of a download with its checks. The web app, the CLI client and the server's contract tests use it, and a mobile app can later. The cryptography itself stays in [`@skysend/crypto`](/developer-guide/crypto/), the note content in [`@skysend/note-format`](/developer-guide/crypto/note-format).

Before this package, the web app and the CLI each had their own copy of the upload, the download and the API schemas, and the copies drifted apart: the CLI read whole files into memory on a slow connection, packed several files with fflate in memory and broke them past 4 GiB, put no stream nonce into the metadata and did not check one on download.

## What it holds

| File | What it does |
| --- | --- |
| `src/api.ts` | `createApiClient`: every route of the server, every answer parsed with Zod, failures as `ApiError` |
| `src/upload.ts` | `uploadEncrypted`: keys, encryption, WebSocket or HTTP chunks, metadata at the end, for a share and for a file request |
| `src/download.ts` | `keysFromLink`, `decryptUploadMetadata`, `decryptedStream`: from the link to the checked plaintext |
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

The end-to-end tests send shares between the browser and the CLI in both directions, see the [Testing Guide](/developer-guide/reference/testing#end-to-end-tests).
