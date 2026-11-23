### 🔒 Security

- **server**: Updated `@hono/node-ws` to 1.3.2, which hardens its WebSocket upgrade listener against malformed requests on top of the guard SkySend already has.

### 🔧 CI/CD

- **infra**: `pnpm audit` no longer ignores any advisory, since the two ignored ones no longer applied. ([#115](https://github.com/Skyfay/SkySend/issues/115))
