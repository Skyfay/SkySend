# Testing Guide

SkySend uses [Vitest](https://vitest.dev/) for unit and integration testing.

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
| `password.test.ts` | Argon2id/PBKDF2 key derivation, password protection XOR |
| `util.test.ts` | Base64url encoding, constant-time comparison, byte utilities |
| `integration.test.ts` | Full encrypt-decrypt roundtrip |

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
