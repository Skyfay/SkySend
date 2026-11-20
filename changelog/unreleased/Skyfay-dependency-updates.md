### 🔒 Security

- **server**: Updated `@hono/node-server` to 2.1.11 to patch an unauthenticated crash when a connection resets during a WebSocket upgrade, and a path-based access control bypass at a reverse proxy through backslashes in the request path (GHSA-qv5m-9pm6-hqp3, GHSA-jpvv-r467-5p4w).
- **server**: Updated hono to 4.13.19 to patch wildcard middleware that the RegExpRouter skipped for some routes, and further advisories in `mount()`, `csrf()`, `validator('form')` and the `css` helper that SkySend does not use (GHSA-h7mg-cq63-vhpq, GHSA-4m76-xfj5-7975, GHSA-46wx-v44x-9hh2, GHSA-4h7h-rv7c-7m2v, GHSA-3gg2-335m-rxc6).
- **server**: Updated zod to 4.6.7 to patch memory exhaustion while validating oversized collections with size limits (GHSA-mrhx-c7xc-m3w5).
- **web**: Updated zod to 4.6.7 to patch memory exhaustion while validating oversized collections with size limits (GHSA-mrhx-c7xc-m3w5).
- **web**: Updated dompurify to 3.4.18 to fix three sanitizer bypasses in XHTML parsing, template-safe output and in-place sanitizing (GHSA-c6gr-qvv4-5v3f, GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr).
- **client**: Updated zod to 4.6.7 to patch memory exhaustion while validating oversized collections with size limits (GHSA-mrhx-c7xc-m3w5).
- **website**: Updated next and eslint-config-next to 16.4.6 to patch two remote code execution vulnerabilities and further cache and denial of service advisories. The site is a static export and never ran the affected server features (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r, GHSA-mfr8-8qww-v76h, GHSA-vc7v-qv4w-wrv8, GHSA-7qx7-33qx-rqx2, GHSA-f3mh-rxg3-f5g2, GHSA-pc58-hwjq-p385, GHSA-rhh4-g77r-r9qj, GHSA-vvgp-ww4w-46vf).
- **infra**: Refreshed the lockfile and raised the `vitepress>vite` override to `>=6.4.5 <7`, so undici in jsdom and the local worker runtime, vite in the docs build and minimatch in ESLint resolve to patched versions (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm, GHSA-9fm3-97px-rjf6, GHSA-55wc-3pg8-jfw6, GHSA-8g5g-mxqh-grgj, GHSA-g3hv-75wg-m249).

### 🔧 CI/CD

- **infra**: Updated the minor and patch releases across the monorepo, among them the AWS SDK, better-sqlite3, jose, openid-client, drizzle-orm, react 19.3.1, the Radix components, lucide-react, react-router 8.5, i18next 26.7, vite 8.3.8, tailwindcss, vitest 5.1, eslint, prettier, Playwright 1.65 and wrangler.
