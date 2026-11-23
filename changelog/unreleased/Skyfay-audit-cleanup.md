### 🔒 Security

- **server**: Updated `@hono/node-ws` to 1.3.2, which hardens its upgrade listener against malformed requests. SkySend already guards that listener itself, so this adds a second layer.
- **web**: Updated dompurify to 3.5.0, which fixes further `SAFE_FOR_TEMPLATES` and `IN_PLACE` bypasses. SkySend sanitizes strings without either option, so it was not affected.

### 🔧 CI/CD

- **infra**: Removed the two ignored advisories from the pnpm audit config. The overrides already keep `brace-expansion` on patched versions and the `braces` advisory was withdrawn, so `pnpm audit` now reports every advisory again. ([#115](https://github.com/Skyfay/SkySend/issues/115))
- **infra**: Added pnpm overrides for `minimatch` under Stryker and `qs` under `typed-rest-client`, so the mutation testing tools resolve to patched versions (GHSA-g3hv-75wg-m249, GHSA-q8mj-m7cp-5q26, GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g, GHSA-6pq8-jhm2-2vcw).
- **infra**: Updated i18next to 27, react-i18next to 18 and jsdom to 31, plus the patch and minor releases of hono, the AWS SDK, lucide-react, wrangler and the Workers types.
