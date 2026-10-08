> ⚠️ **Breaking:** A CLI from before this release cannot download a password-protected file from an updated server. Run `skysend update` first.

### 🔒 Security

- **server**: The metadata of a password-protected file is released only after a correct password, so a link holder can no longer test password guesses offline. Thanks @NotAFlightRisk ([GHSA-rxxj-c5wr-phqp](https://github.com/Skyfay/SkySend/security/advisories/GHSA-rxxj-c5wr-phqp))
- **server**: A wrong token at the download of a password-protected file counts against the password lockout like a wrong password. Thanks @NotAFlightRisk ([GHSA-rxxj-c5wr-phqp](https://github.com/Skyfay/SkySend/security/advisories/GHSA-rxxj-c5wr-phqp))
- **server**: An IPv6 client counts per /64 network in the rate limit, the upload quota, the password lockout and the daily request limit, so a new address from the same network no longer starts a fresh count.
- **web**: A new file or note password needs at least 8 characters. Thanks @NotAFlightRisk ([GHSA-rxxj-c5wr-phqp](https://github.com/Skyfay/SkySend/security/advisories/GHSA-rxxj-c5wr-phqp))
- **client**: The CLI and the TUI ask for at least 8 characters for a new file or note password and take the metadata from the password check. Thanks @NotAFlightRisk ([GHSA-rxxj-c5wr-phqp](https://github.com/Skyfay/SkySend/security/advisories/GHSA-rxxj-c5wr-phqp))
- **web**: Notes are padded to whole kilobytes before they are encrypted, so the server no longer learns how long a password in a note is.
- **client**: The CLI and the TUI pad notes to whole kilobytes like the web app.
- **crypto**: File metadata is padded to whole kilobytes before it is encrypted, so its length no longer reveals how long a file name is.
- **client**: The CLI keeps its history, config and session files readable for the current user only, and narrows the permissions of files an older version created. Thanks @lissy93 ([GHSA-5vjq-2637-p33f](https://github.com/Skyfay/SkySend/security/advisories/GHSA-5vjq-2637-p33f))
- **client**: Password prompts of the CLI no longer show what is typed, and a pasted password no longer keeps its line break.
- **client**: `skysend note` without text asks for the note at a prompt that does not show it, or reads it from a pipe, so a secret no longer has to go into the shell history.
- **server**: Updated `@hono/node-server` to 2.1.3 to patch a middleware bypass in static file serving (GHSA-rmxm-3fg6-px4f).
- **website**: Updated next and eslint-config-next to 16.4.0 to patch a remote code execution in `next/og` image responses (GHSA-vcvr-r3jv-pc5j).
- **web**: Updated dompurify to 3.4.16 to fix two XSS issues in in-place sanitizing (GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2).
- **docs**: Updated vue to 3.5.43 to patch an XSS in server-side rendering of attribute names (GHSA-g2v6-rqmx-r4w6).
- **infra**: Updated wrangler to 4.148.0 and refreshed the lockfile, so undici in the local worker runtime and source-map-js in the build tooling resolve to patched versions (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-3wwx-pv8p-q78v, GHSA-pmjh-fq2x-6v4x, GHSA-3xpg-4rpp-hhhm, GHSA-2jfj-6hjv-fm6j, GHSA-rx4f-c7p8-82vq, GHSA-r53p-7pc4-xj5r, GHSA-2gqq-gqf2-x968, GHSA-8436-99hf-9mmv, GHSA-68fv-2mgg-jv7q).
- **infra**: `pnpm audit` ignores the braces advisory GHSA-vfj7-8cjw-p6xm, which has no patched release and only reaches the lint tooling of the website.
- **infra**: Raised the pnpm overrides for `sharp` and `brace-expansion` and added overrides for `postcss-selector-parser` under `@tailwindcss/typography` and `argparse` under `js-yaml` to clear transitive advisories (GHSA-wq5f-xc86-pv6w, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-rj75-hqrm-r3gf, GHSA-hp3w-g68c-fv3c).
- **client**: The CLI and the TUI save a download under a cleaned file name inside the chosen folder and add a number instead of replacing an existing file, so a crafted name can no longer write elsewhere on disk. Thanks @lissy93 ([GHSA-2gh8-5c87-87jx](https://github.com/Skyfay/SkySend/security/advisories/GHSA-2gh8-5c87-87jx))
- **client**: File names, error messages and the server title are shown with their control characters made visible, so a sender or a server can no longer rewrite terminal output or the clipboard through escape sequences.
- **client**: The TUI packs a multi-file upload into a temporary file only the current user can read and removes it even when the TUI is closed with Ctrl+C.
- **server**: An upload reserves its size in the upload quota when it starts, so uploads running side by side can no longer store more than the quota allows.
- **server**: The single-request upload requires the OIDC login when `OIDC_PROTECT_FILES` is on, like every other way to upload a file.
- **server**: The single-request upload stops at the size it declared, so a client can no longer fill the disk with a body that never ends.
- **server**: A chunked HTTP upload that receives less than 1 MiB in 10 minutes is ended like a WebSocket upload, so a stalled upload no longer holds its share of the quota or a slot of a request.

### 📝 Documentation

- **docs**: The threat model covers an instance that serves modified code, and the instance list says what that means for trusting an operator.
- **website**: The zero-knowledge section and the blog post promise that the server holds nothing readable instead of that an operator can never read along.
- **docs**: The development setup covers the macOS setup script, the Node version and the platforms the server runs on outside Docker.

### 🧪 Tests

- **web**: The toast test expects a toast fired before the Toaster mounts to arrive, since Sonner now replays it.

### 🔧 CI/CD

- **infra**: The release thanks the author of a pull request from outside the project at the end of each of its changelog entries, with a link to the pull request.
- **infra**: Updated the GitHub Actions of every workflow to their newest major versions, which run on Node 24, among them checkout 7, setup-node 7, pnpm/action-setup 6, the artifact actions 7 and 8, codecov 7 and the Docker actions.
- **infra**: Bumped minor and patch dependencies across the monorepo, among them the AWS SDK, hono, radix-ui, react 19.3, react-router, i18next, lucide-react, zod 4.6, vite 8.3, tailwindcss, typescript-eslint and prettier.
- **docker**: The image keeps only the SQLite binary for its own platform, which makes it about 29 MB smaller.
- **server**: Updated better-sqlite3 to 13, which ships its prebuilt binaries in the package, so an install no longer downloads or compiles one. Outside Docker the server now needs Linux, macOS or Windows on x64 or arm64.
- **client**: Updated ink to 8.
- **infra**: Updated vitest and `@vitest/coverage-v8` to 5 and jsdom to 30.
- **website**: Updated eslint to 10, typescript to 6 and `@types/node` to 26, in line with the rest of the repository.
- **infra**: A `.node-version` file pins Node 24 for local development, the version CI and the Docker image use.
- **infra**: `scripts/setup-dev-macos.sh` sets up a Mac for development with fnm, the Node of `.node-version`, pnpm and the dependencies.
- **infra**: pnpm allows ESLint 10 for three lint plugins of Next and `@hono/node-server` 2 for `@hono/node-ws`, so an install runs without peer warnings.
