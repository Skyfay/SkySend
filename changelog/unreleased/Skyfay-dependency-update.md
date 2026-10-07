### 🔒 Security

- **server**: Updated `@hono/node-server` to 2.1.3 to patch a middleware bypass in static file serving (GHSA-rmxm-3fg6-px4f).
- **website**: Updated next and eslint-config-next to 16.4.0 to patch a remote code execution in `next/og` image responses (GHSA-vcvr-r3jv-pc5j).
- **web**: Updated dompurify to 3.4.16 to fix two XSS issues in in-place sanitizing (GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2).
- **docs**: Updated vue to 3.5.43 to patch an XSS in server-side rendering of attribute names (GHSA-g2v6-rqmx-r4w6).
- **infra**: Updated wrangler to 4.148.0 and refreshed the lockfile, so undici in the local worker runtime and source-map-js in the build tooling resolve to patched versions (GHSA-rfgv-xxqx-mfg5, GHSA-w293-vg96-wgc3, GHSA-3wwx-pv8p-q78v, GHSA-pmjh-fq2x-6v4x, GHSA-3xpg-4rpp-hhhm, GHSA-2jfj-6hjv-fm6j, GHSA-rx4f-c7p8-82vq, GHSA-r53p-7pc4-xj5r, GHSA-2gqq-gqf2-x968, GHSA-8436-99hf-9mmv, GHSA-68fv-2mgg-jv7q).
- **infra**: `pnpm audit` ignores the braces advisory GHSA-vfj7-8cjw-p6xm, which has no patched release and only reaches the lint tooling of the website.
- **infra**: Raised the pnpm overrides for `sharp` and `brace-expansion` and added overrides for `postcss-selector-parser` under `@tailwindcss/typography` and `argparse` under `js-yaml` to clear transitive advisories (GHSA-wq5f-xc86-pv6w, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p, GHSA-rj75-hqrm-r3gf, GHSA-hp3w-g68c-fv3c).

### 📝 Documentation

- **docs**: The development setup covers the macOS setup script, the Node version and the platforms the server runs on outside Docker.

### 🧪 Tests

- **web**: The toast test expects a toast fired before the Toaster mounts to arrive, since Sonner now replays it.

### 🔧 CI/CD

- **infra**: Bumped minor and patch dependencies across the monorepo, among them the AWS SDK, hono, radix-ui, react 19.3, react-router, i18next, lucide-react, zod 4.6, vite 8.3, tailwindcss, typescript-eslint and prettier.
- **docker**: The image keeps only the SQLite binary for its own platform, which makes it about 29 MB smaller.
- **server**: Updated better-sqlite3 to 13, which ships its prebuilt binaries in the package, so an install no longer downloads or compiles one. Outside Docker the server now needs Linux, macOS or Windows on x64 or arm64.
- **client**: Updated ink to 8.
- **infra**: Updated vitest and `@vitest/coverage-v8` to 5 and jsdom to 30.
- **website**: Updated eslint to 10, typescript to 6 and `@types/node` to 26, in line with the rest of the repository.
- **infra**: A `.node-version` file pins Node 24 for local development, the version CI and the Docker image use.
- **infra**: `scripts/setup-dev-macos.sh` sets up a Mac for development with fnm, the Node of `.node-version`, pnpm and the dependencies.
- **infra**: pnpm allows ESLint 10 for three lint plugins of Next and `@hono/node-server` 2 for `@hono/node-ws`, so an install runs without peer warnings.
