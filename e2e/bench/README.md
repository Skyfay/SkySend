# Transfer benchmark

Measures large uploads and downloads through the real app in a real browser. Not a test: it fails only when a transfer fails or a file comes back different. The guide is the "Measuring uploads and downloads" section of `docs/developer-guide/reference/testing.md`.

Build first with `pnpm test:e2e:build`. Everything a run writes stays in `e2e/.large-files/bench/`, which git ignores: the source files (kept between runs, one per size), the server data and the downloads (removed after a run), and one JSON file per run in `results/`.

## transfer.mjs

```
browser --> [proxy A :3900] --> server :3901 --> [proxy B :3902] --> S3 :3903
```

| Option | Default | What it does |
| :--- | :--- | :--- |
| `--browser` | `chromium` | `chromium`, `firefox` or `webkit` |
| `--channel` | `chromium` for Chromium | The full Chromium in its new headless mode, which is what people run. `chrome` takes an installed Google Chrome, `shell` the headless shell of the end-to-end tests. |
| `--executable` | | Another Chromium build with `--browser chromium`, like `/usr/bin/brave-browser` |
| `--storage` | `fs` | `fs` or `s3` |
| `--s3` | `local` | `local` starts SeaweedFS in Docker, or an `http://host:port` of a store that takes unsigned requests, like SeaweedFS without identities. `env` uses the real bucket of the `S3_*` lines in `--s3-env`, with no counter towards it. Its CORS policy has to allow the origin of the run, `http://127.0.0.1:3900` by default, `http://127.0.0.1:3901` with `--direct` and `https://localhost:3906` with `--proxy nginx`. Afterwards the run aborts the multipart uploads it left and deletes the objects of its own uploads, by the IDs in its database, and nothing else |
| `--s3-env` | `.env.dev` | The env file `--s3 env` reads, relative to the repository or absolute. Its keys are never printed |
| `--transport` | `ws` | `ws` or `http`, through `FILE_UPLOAD_WS` |
| `--size` | `1024` | MiB |
| `--env KEY=VALUE` | | Any server variable, repeatable, like `--env S3_PART_SIZE=10MB` |
| `--parallel N` | `1` | N senders upload at once, nothing is downloaded |
| `--cancel-after S` | | Closes the sender S seconds into the upload |
| `--no-download` | | Upload only |
| `--no-verify` | | Skips the SHA-256 of the download |
| `--profile` | | Writes a CPU profile of the server to `profiles/` |
| `--label` | from the options | Name of the result file |
| `--uploads N`, `--downloads M` | | Runs N uploads and M downloads at the same time. The files to download are shared first, every page is ready before all of them start, and the result has each transfer's speed while all ran and Jain's fairness index |
| `--separate` | | With `--uploads` or `--downloads`, a browser of its own per transfer instead of a context of one browser |
| `--drop-caches` | | Empties the page cache before a mixed run starts (sudo), so files come from the disk |
| `--direct` | | The browser talks to the server without proxy A, which runs in this process and costs some speed at several hundred MiB/s. Upload speeds then come from the worker alone |
| `--proxy nginx` | | Puts the Nginx of the reverse proxy guide in front, in Docker, with TLS and HTTP/2 on port 3906, the way an instance runs |
| `--port` | `3900` | First of the four ports |
| `--client cli` | `web` | The end-user CLI instead of a browser: `skysend upload` and `skysend download` with `--json`, behind the same relays. The sampler counts the CLI process where it counts the browser, so `browserCpuPercent` and `browserPeakRssMiB` are the CLI's. One upload and its download only |
| `--cli-bin` | `apps/client/dist/skysend` | The CLI to run, the Bun binary of `pnpm client:compile` by default, which is what people install |
| `--files N` | `1` | Sends N files of `--size` at once, which the app and the CLI pack into one zip. They are hard links to the one source file under names of their own. A download of several files counts as intact when every entry of the zip has the hash of the source |

What a result holds: total time and speed per direction, the time from the click to the first byte and from 100 % in the UI to the link (`tailSeconds`), rates in windows of 250 ms, 500 ms and 1 s with their spread (`cv`) for the UI, the wire and the bucket, CPU and peak memory of server and browser, the download tier, whether the download matched, and with S3 the multipart uploads left in the bucket.

`shown` is what the page displayed, read every half second from the text beside its progress bar, for the upload and the download: the speeds it showed (10th percentile, median, 90th percentile and spread), the largest jump between two readings, whether the percent ever went back, how long it stood at its last value before the transfer ended, and the average the finished page showed, next to the speed the transfer really had. `shown.timeline` keeps every reading as seconds, percent and speed, numbers only. While an upload is processed the page shows no bar with a percent, so no reading covers that phase. A screenshot of the page at half the transfer lands in `screenshots/`.

## summary.mjs

`node e2e/bench/summary.mjs [--last 5] [result.json ...]` prints one line per run: speed, total, startup and tail time, the spread of UI, wire and bucket, the download, server memory and CPU, and what was left in the bucket.

## timeline.mjs

`node e2e/bench/timeline.mjs [result.json] [--step 500]` prints a result as a table over time. Without a file it takes the newest.

## shape.sh

`sudo e2e/bench/shape.sh apply <client rate> <client delay> <s3 rate> <s3 delay>` gives the hop to the server and the hop to the bucket a rate and a delay each way with `tc netem` on the loopback device, matched by port, so nothing else on the machine slows down. `none` leaves a hop as it is, a delay like `"15ms 10ms"` adds jitter. `clear` removes it, `show` prints it.

## pipeline.mjs

`node e2e/bench/pipeline.mjs [--browser chromium] [--size 1024] [--only read,encrypt,encrypt-64k,raw,ws-plain,ws-encrypt,ws-encrypt-64k,ws2-plain,ws2-encrypt,post,post-plain,post-encrypt]` measures the stages of the browser one by one in a Web Worker, on a page of its own without the app. It needs a source file of that size, which `transfer.mjs` writes. `ws-*` is the send loop of the app before 2026-10, `ws2-*` the one it has now, `*-64k` cuts the file into the chunks Firefox reads before encrypting. `--sw` registers a Service Worker shaped like `download-sw.js` first, `--routes` gives it static routes that send every other request to the network, and `--persistent` uses a normal profile instead of an incognito one.

## profile-top.mjs

`node e2e/bench/profile-top.mjs <profile or directory> [--top 25]` lists the functions that took the most CPU time in a server profile written with `--profile`.

## pageload.mjs

`node e2e/bench/pageload.mjs <url> [browser]` lists every request of a page load with its timing.

## ece.mjs

`node e2e/bench/ece.mjs [--size 256] [--chunks 64K,1M,8M,32M]` measures `createEncryptStream` and `createDecryptStream` in Node, fed with chunks of one size each. Browsers hand out very different ones: Firefox reads a file in 64 KiB, Chromium in up to 2 MiB, and a fetch body can arrive in pieces of many MiB.
