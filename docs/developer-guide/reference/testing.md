# Testing Guide

SkySend uses [Vitest](https://vitest.dev/) for unit and integration testing and [Playwright](https://playwright.dev/) for end-to-end tests in Chromium, Firefox and WebKit. See [End-to-End Tests](#end-to-end-tests).

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/crypto && pnpm test
cd apps/server && pnpm test
```

## Test Structure

### Crypto Tests (`packages/crypto/tests/`)

| File | Tests |
| --- | --- |
| `keychain.test.ts` | Secret/salt generation, HKDF key derivation, token computation |
| `ece.test.ts` | Streaming encryption/decryption, nonce handling, size calculation |
| `metadata.test.ts` | Metadata encryption/decryption, schema validation |
| `password.test.ts` | Argon2id key derivation, password protection XOR |
| `util.test.ts` | Base64url encoding, constant-time comparison, byte utilities |
| `integration.test.ts` | Full encrypt-decrypt roundtrip |

### Transfer Tests (`packages/transfer/tests/`)

| File | Tests |
| --- | --- |
| `zip.test.ts` | The zip against `node:zlib` and fflate, ZIP64 past 4 GiB |
| `archive.test.ts` | Metadata of several files, its size check, unique names |
| `upload.test.ts` | Both transports against a fake server, the fallback, the chunk window |
| `download.test.ts` | Keys from a link, the checks of size and base nonce |

See [Transfer Core](/developer-guide/transfer).

### Server Tests (`apps/server/tests/`)

| File | Tests |
| --- | --- |
| `routes.test.ts` | All API route handlers |
| `db.test.ts` | Database operations |
| `storage.test.ts` | Filesystem storage layer |
| `cleanup.test.ts` | Expired upload cleanup |
| `config.test.ts` | Environment variable parsing and validation |
| `rate-limit.test.ts` | Rate limiter behavior |
| `quota.test.ts` | Upload quota enforcement |

## Writing Tests

### Conventions

- Test files are named `*.test.ts`
- Tests are placed in a `tests/` directory next to the source
- Use `describe` blocks to group related tests
- Use `it` or `test` for individual test cases
- Prefer `expect` assertions

### Example

```typescript
import { describe, it, expect } from 'vitest'
import { generateSecret, SALT_LENGTH } from '@skysend/crypto'

describe('generateSecret', () => {
  it('should generate 32 bytes', () => {
    const secret = generateSecret()
    expect(secret).toBeInstanceOf(Uint8Array)
    expect(secret.byteLength).toBe(32)
  })

  it('should generate unique values', () => {
    const a = generateSecret()
    const b = generateSecret()
    expect(a).not.toEqual(b)
  })
})
```

## Test Helpers

The server tests use a shared `helpers.ts` file that provides:

- Test database setup/teardown
- Pre-configured Hono app instances
- Helper functions for creating test uploads

## End-to-End Tests

The end-to-end tests in `e2e/` drive the real app in Chromium, Firefox and WebKit, the way a person would: share a file or a note, open the link in a second browser that knows nothing of the sender, download or read it and compare it with what was shared.

```bash
# Once: the three browsers, on Linux the system libraries they need (asks for sudo), and Caddy
pnpm test:e2e:install

# Build the server and the SPA, then run every test in all three browsers and every setup
pnpm test:e2e

# Build, then pick tests and watch them run, step by step, at http://localhost:9323
pnpm test:e2e:ui

# Build, then send a file of 5 GiB up and down, see below. Needs about 11 GB of free disk.
pnpm test:e2e:large

# The report of the last run, with screenshots, videos and traces of failed tests
pnpm --filter @skysend/e2e exec playwright show-report
```

The UI is a web page on `http://localhost:9323`. It needs a secure context for its Service Worker, so open it through `localhost`, not through the IP address or hostname of the machine. On a machine without a display, like a VM, use a browser on that machine or forward the port. The UI starts with the `chromium` project only, the Projects filter at the top of the test list adds the others.

### How a run works

The tests run against the production build, where the server serves the SPA and the API from one origin, the way an instance does. `e2e/scripts/serve.mjs` starts a server on an empty data directory in the system temp folder and puts a small recording proxy in front of it, which passes everything on to the server one port above.

Each setup is a server of its own. The direct one runs every test of the app in all three browsers. The setups behind a reverse proxy run what goes over the wire, in Chromium and Firefox: files, file requests, links and transports, plus the notes behind Caddy and the guard wherever there is a WebSocket. WebKit on Linux speaks HTTP/2 and TLS through a network stack of its own that no Safari uses, so behind a proxy it would only test that. It runs in the direct setup, with S3 and against the snapshots instead.

| Setup | Projects | Browser to SkySend | Uploads |
| --- | --- | --- | --- |
| direct | `chromium`, `firefox`, `webkit` | HTTP/1.1 to `http://localhost:3170` | WebSocket |
| behind Caddy | `chromium-caddy`, ... | HTTPS and HTTP/2 to `https://localhost:3443` | WebSocket, upgraded through Caddy |
| behind Caddy, chunks | `chromium-caddy-chunks`, ... | HTTPS and HTTP/2 to `https://localhost:3444` | Chunks over HTTP/2, `FILE_UPLOAD_WS=false` |
| behind Nginx | `chromium-nginx`, ... | HTTPS and HTTP/2 to `https://localhost:3445` | WebSocket, upgraded through Nginx |
| behind Nginx, chunks | `chromium-nginx-chunks`, ... | HTTPS and HTTP/2 to `https://localhost:3446` | Chunks over HTTP/2, `FILE_UPLOAD_WS=false` |

A few more setups each change one setting of the server and run their part of `config.spec.ts` in Chromium only, since a server setting acts the same in every browser: `forced-passwords` with `FORCE_FILE_PASSWORD`, `FORCE_NOTE_PASSWORD` and `FORCE_REQUEST_PASSWORD`, `files-only`, `notes-only` and `requests-only` with `ENABLED_SERVICES`, and `slow-uploads` with `FILE_UPLOAD_SPEED_LIMIT`, slow enough to cancel an upload halfway. The direct server also offers an expiry of 5 seconds next to the defaults, for `expiry.spec.ts`.

Two setups bring a service of their own:

- **`s3`** keeps the ciphertext in an S3 store, SeaweedFS in Docker, pinned by digest, since MinIO no longer publishes images. Downloads then come from the bucket through presigned URLs, which the file and request tests check, in Chromium for the Service Worker and in WebKit for the page.
- **`oidc`** puts uploads behind a login with `OIDC_PROTECT_FILES` and `OIDC_PROTECT_NOTES`. `e2e/scripts/oidc.mjs` runs a test provider with [oidc-provider](https://github.com/panva/node-oidc-provider) over HTTPS with a certificate of its own, since the server only accepts an issuer over HTTPS. Only this server of the tests skips the certificate check, through `NODE_TLS_REJECT_UNAUTHORIZED=0`.

A run never reuses a server it finds running, since that one would answer with its old configuration. A taken port fails the run instead. To run next to an open UI mode, shift every port, data directory and container: `E2E_PORT_OFFSET=1000 pnpm test:e2e`.

Uploads that stalled behind reverse proxies, like the HTTP/2 problems fixed in v2.2.2 and v2.2.3, only show up when a proxy speaks HTTP/2 to the browser. Both proxies are set up the way [Reverse Proxy](/user-guide/self-hosting/reverse-proxy) tells operators to, with a certificate of their own that the browsers are told to accept:

- **Caddy** gets nothing but the `reverse_proxy` line per site, see `e2e/proxies/Caddyfile`. `pnpm test:e2e:install` downloads it into `e2e/.tools/` and checks it against a pinned SHA-512.
- **Nginx** runs the example of the docs page itself. `e2e/scripts/nginx.mjs` reads the `nginx` block out of `reverse-proxy.md` on every start and only replaces the port, the certificate and the upstream, so a change to that example is tested by the next run. It runs the official Nginx image, pinned by digest, on the host network, which takes Docker, and on a Mac the host networking of Docker Desktop.

Without Caddy or Docker, a local run leaves out the setups behind them and says so. CI fails instead.

Three checks run wherever a test shares, uploads or downloads:

- **Nothing secret reaches the server.** Each test names what only the sender and the recipient may know: the key from the link fragment, the filenames, passwords, note text and a stretch of each file. After the test, everything the proxy recorded is searched for them, in URLs, headers, request bodies and WebSocket frames. The search runs on the server side because Playwright does not see all traffic in every browser. `guard.spec.ts` makes sure the recording sees what a leak would look like.
- **The download takes the path meant for the browser.** Chromium and Firefox download through the Service Worker (tier 1), WebKit through the Blob fallback (tier 4), since its OPFS on Linux reads back an empty file, see [Download Modes](/developer-guide/download-modes). Safari on a Mac takes OPFS (tier 3), which `service-worker.spec.ts` covers in Firefox with Service Workers blocked. A tier that fails falls through to the next and the download still arrives, so the tests check the tier the app logged as well.
- **Uploads take the transport of the setup.** A broken WebSocket would fall back to chunks without a word, so every upload has to log the transport its setup offers.

| File | Tests |
| --- | --- |
| `files.spec.ts` | A file byte for byte, one of 32 MB in several chunks, several files as a zip, a password, a download limit |
| `archive.spec.ts` | A folder keeps its subfolders in the zip, and names too long together for the server stop an upload before it starts |
| `notes.spec.ts` | A note of text, password and code blocks, a password, burn after reading |
| `requests.spec.ts` | Files into a request and out of the inbox, files and a note as one submission, an inbox with a password |
| `request-lifecycle.spec.ts` | A closed request and a full one turn senders away, an inbox deletes one file and then the request |
| `links.spec.ts` | A `/d/` link of v1, and links a mail filter rewrote, which open and warn that the key reached the server |
| `expiry.spec.ts` | A file, a note and a request stop working once their time runs out |
| `my-links.spec.ts` | Shares and requests show in My Links, open from there and are deleted there |
| `templates.spec.ts` | A template saved from the form starts a request, a sealed templates link moves one to another browser |
| `mobile.spec.ts` | Sharing through the sheets of a phone screen, and no page wider than the screen |
| `config.spec.ts` | Forced passwords, a single enabled service, a cancelled upload, sharing behind an OIDC login, and the CLI logging in through the browser to send over the WebSocket |
| `crafted-note.spec.ts` | A note full of markup that would run, load or restyle shows inert in every engine, checked in the rendered page |
| `large.spec.ts` | A file of 5 GiB up and down byte for byte, in a job of its own, see below |
| `cli.spec.ts` | The CLI and the browser open each other's shares, with a password both ways, a zip of several files both ways, a folder from the CLI, a note made in the CLI, and the checks of the stream nonce |
| `cli-requests.spec.ts` | The CLI sends files and a folder into a request made in the browser, stops at a full request and at one that asks for a note, and lists and saves an inbox a browser sent to, with and without a password |
| `guard.spec.ts` | The recording of the proxy sees headers, bodies and WebSocket frames |
| `transport.spec.ts` | The page arrives over HTTP/1.1 or HTTP/2 as its setup promises, and an upload takes its transport |
| `service-worker.spec.ts` | The download Service Worker controls no page, a registration of an older release for the whole origin is replaced and downloads still take tier 1, and a download without a Service Worker goes through OPFS |
| `compat.spec.ts` | Every link of an older release still opens after an update, see below |

The CLI tests run the CLI built with Node by default. `E2E_CLI=binary` runs them against the Bun binary instead, which is what people install, so run that before a change to the CLI is done:

```bash
pnpm client:compile
E2E_CLI=binary E2E_BROWSER=chromium pnpm test:e2e tests/cli.spec.ts tests/cli-requests.spec.ts tests/config.spec.ts
```

The **E2E Tests** jobs in `.github/workflows/validate.yml` run them on pull requests, one job per browser. A pull request into `dev` that changes nothing they build, run or read skips them, like one that only touches the website, the Workers or other docs. The **Changes** job decides that from the changed files in a few seconds. Pull requests into `main`, the release and a run started by hand always run them. `E2E_BROWSER` picks the engine, and a run then starts only the servers, proxies and containers that engine's projects need, so the Firefox job never pulls the S3 store. Each job keeps its browser in the cache of the Playwright version, and its install is cut off after eight minutes and started again up to three times, since the Ubuntu mirror of the runners sometimes delivers the system libraries at a crawl. The same works locally, like `E2E_BROWSER=webkit pnpm test:e2e`, or with a list like `chromium,webkit`. When a job fails, its report with screenshots, videos and traces is attached to the run as the `e2e-report-<browser>` artifact. A trace opens with `pnpm --filter @skysend/e2e exec playwright show-trace <trace.zip>`.

### A file of 5 GiB

Sizes overflow where they pass 2 GiB and 4 GiB, which no other test reaches. `large.spec.ts` writes a file of 5 GiB for the run, in which every block of a MiB differs so a swapped, repeated or lost block shows, sends it up through Nginx with TLS and HTTP/2, downloads it through the Service Worker of Chromium and compares the SHA-256. It runs alone, in the **E2E Large File** job beside the others, and the log of the run notes how fast each step went. WebKit is left out, since it assembles a download in memory, which a file this size does not fit, and the recording proxy keeps headers only, since no memory holds the bodies.

```bash
pnpm test:e2e:large

# A smaller file to try the setup, in bytes
E2E_LARGE_SIZE=314572800 pnpm test:e2e:large
```

`pnpm test:e2e` leaves it out. The run needs about 11 GB of free disk, since the server holds the ciphertext while the download arrives beside it, and checks that before it writes anything. It keeps everything on the disk of the checkout, the source in `e2e/test-results/` and the server data and the download in `e2e/.large-files/`, never in the temp folder, which some systems keep in memory. A finished run leaves none of it behind.

### Measuring uploads and downloads

The tests check that a transfer works, `e2e/bench/` measures how well. `transfer.mjs` sends a file up through the real app in a real browser and downloads it again, against the built server, and records the speed of every hop over time: what the upload worker reports and the UI shows, what reaches the server, and with S3 what the server sends to the bucket and the browser downloads from it. Two plain TCP relays count those bytes without changing them. It also samples the CPU and memory of the server and the browser, compares the download with the source, and with S3 lists the multipart uploads a run left in the bucket. It is not a test and runs in no CI job.

```bash
# Build first
pnpm test:e2e:build

# 2 GiB up and down in Firefox against a local SeaweedFS
pnpm --filter @skysend/e2e bench --browser firefox --storage s3 --size 2048

# The timeline of the last run, every 500 ms
node e2e/bench/timeline.mjs

# A slower network: 1 Gbit/s to the server, 400 Mbit/s with 30 ms round trip to the bucket
sudo e2e/bench/shape.sh apply 1gbit 5ms 400mbit 15ms
sudo e2e/bench/shape.sh clear
```

With `--uploads N --downloads M` it runs that many transfers at the same time, each in a context of its own, or with `--separate` in a browser of its own like people on other machines, and reports each one's speed while all ran and how evenly they shared (Jain's index, 1 is perfectly even), plus what the disk read and wrote.

`pipeline.mjs` measures the stages of the browser alone, in a Web Worker like the app's: reading the file, `createEncryptStream`, raw AES-GCM and sending over a WebSocket to a sink that throws the bytes away. The stage that is slowest alone is the one that caps an upload. `e2e/bench/README.md` lists every option.

### Links from older releases

An update must not break the links an instance handed out before it. `compat.spec.ts` checks that for every release with a snapshot in `e2e/compat/snapshots/<version>/`:

- `data.tar.gz` holds the data directory and the uploads of a server of that release, right after it shared files, notes and file requests through its own UI.
- `links.json` lists what was shared: the links with their keys, the passwords, the names, and the seeds the file contents are made from, so the snapshot does not have to keep the original files.

A run starts the current server on a copy of each snapshot, moves every expiry a year ahead and lets the server migrate the database the way it does after an update. Then every link is opened in all three browsers. Files are downloaded and compared byte for byte, notes and inboxes are opened, and a request made before the update takes a new upload.

A snapshot is made once and committed. After a release, run:

```bash
pnpm --filter @skysend/e2e compat:seed v3.0.2
```

It starts the published image of that version with Docker, shares through its UI with `e2e/compat/seed/release.spec.ts`, and writes the snapshot. A release whose UI the current test helpers no longer fit gets a seed of its own, `e2e/compat/seed/<version>.spec.ts`, written against that UI.

### Writing an end-to-end test

- Import `test` and `expect` from `./support/fixtures.js`, not from `@playwright/test`, so the guard runs.
- Tell the guard what has to stay secret: `guard.secretOf(link)`, `guard.requestLinks(uploadLink, inboxLink)` for a file request, `guard.text(...)` and `guard.content(name, data)`.
- Open the recipient with `openRecipient()`, a browser of its own without the IndexedDB and storage of the sender.
- Share and download through the helpers in `support/flows.ts`, and work with file requests through `support/requests.ts`. Generate the data with `randomFile`, `randomText` and `randomPassword`, so every value is unique and a hit cannot be a coincidence.
- Find elements by role and label, like a screen reader would. The browsers run with the `en-US` locale, so the labels are the English strings of the SPA.

WebKit on Linux is close to Safari but not the same. Behavior of Safari on an iPhone or iPad, like the early end of a Service Worker or the memory a large download takes, still needs a check on a real device.
