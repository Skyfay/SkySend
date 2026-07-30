# Crypto

`@skysend/crypto` - the shared end-to-end encryption library. Web Crypto API only, no runtime dependencies, no WASM. It runs in the browser, in Web Workers, in Node 24, and in Bun-compiled CLI binaries, and it must keep running in all four.

Everything the product promises rests on this package. Treat a change here the way you would treat a change to a lock, not to a helper.

## Hard rules

1. **No dependencies.** `package.json` has no `dependencies` block and should not gain one. Anything that needs WASM (Argon2id) is injected by the caller as a function.
2. **Web Crypto only.** No `node:crypto`, no polyfills, no `Buffer`. `crypto.getRandomValues` and `crypto.subtle` are the whole toolbox.
3. **Never change a wire format without a migration path.** Uploads created by an older client must keep decrypting until they expire. `deriveKeys` still accepts 16-byte legacy salts for exactly that reason, and the `TODO` above it is the removal plan.
4. **Never make a key extractable.** Every `deriveKey` call passes `false`. There is no reason to export a derived key.
5. **Never add a function that moves a secret toward the server.** The package's whole job is to keep the boundary.
6. **Compare secrets with `constantTimeEqual`.** Never `===`, never `Buffer.compare`.
7. **Randomness comes from `randomBytes()` in `util.ts`**, which wraps `crypto.getRandomValues`. Never `Math.random`.

## The scheme

```
secret (32 bytes, CSPRNG)  +  salt (32 bytes, per upload)
                    |
                  HKDF-SHA256, distinct info string per key
                    |
     +--------------+--------------+------------------+
     |              |              |                  |
  fileKey        metaKey        authKey          ownerToken
  AES-256-GCM   AES-256-GCM   HMAC-SHA256        deriveBits
  ECE stream    metadata      -> authToken       -> delete/manage
```

Info strings (`keychain.ts`) provide domain separation and are part of the wire format:

| Purpose | Info string |
| :--- | :--- |
| File encryption | `skysend-file-encryption` |
| Metadata | `skysend-metadata` |
| Authentication | `skysend-authentication` |
| Owner token | `skysend-owner-token` |

`computeAuthToken` is `HMAC-SHA256(authKey, "skysend-auth-token")`, so the server can verify a reader without ever holding the secret. `computeOwnerToken` derives independently via `deriveBits`.

Changing any of these strings invalidates every existing link. Do not.

## Modules

| File | Owns |
| :--- | :--- |
| `keychain.ts` | Secret and salt generation, HKDF derivation, auth and owner tokens |
| `ece.ts` | Streaming AES-256-GCM in 64 KB records, plus exact size math |
| `metadata.ts` | AES-256-GCM over the JSON metadata blob |
| `note.ts` | AES-256-GCM over note content, with its own nonce |
| `password.ts` | Argon2id KDF plus the XOR protection layer |
| `util.ts` | base64url, UTF-8, concat, constant-time compare, random bytes, nonce XOR |
| `index.ts` | The public API. Nothing outside this package imports a submodule directly. |

## ECE stream format

```
[baseNonce 12 B] [record 0] [record 1] ... [record N]

record = ciphertext (up to 65 536 B) || GCM tag (16 B)
nonce  = baseNonce XOR counter        counter is 32-bit, so max 2^32 records
```

The base nonce is random per encryption, each record is authenticated on its own, and the final record may be short. `calculateEncryptedSize` and `calculatePlaintextSize` are the exact conversions - the download Service Worker needs the plaintext size up front so Safari streams to disk instead of buffering.

`public/download-sw.js` in the web app reimplements these constants because a Service Worker cannot import the package. Any change to `RECORD_SIZE`, `TAG_LENGTH`, or `NONCE_LENGTH` has to be mirrored there in the same commit.

## Password protection

Argon2id with OWASP parameters (`ARGON2_PARAMS`: 64 MiB, 3 iterations, parallelism 1), a 16-byte salt per upload, producing a 32-byte key. `applyPasswordProtection` XORs that key with the master secret, so decrypting needs both the URL fragment and the password.

The hash function itself is injected as `Argon2idHashFn`. The web app passes `hash-wasm` (`apps/web/src/lib/argon2.ts`), the CLI passes its own. That is what keeps this package dependency-free - do not "simplify" it by importing hash-wasm here.

`passwordAlgo` on the server is currently only `argon2id-v2`. A new algorithm means a new enum value on both sides plus a decrypt path for the old one, never a silent change of parameters.

## Types and build

`tsconfig.json` sets `"types": []` and `lib: ["ES2024", "DOM"]` on purpose - the package must not pick up Node globals. If something only typechecks with `@types/node`, it does not belong here.

Streams are Web Streams (`TransformStream`, `ReadableStream`), never `node:stream`. `Uint8Array<ArrayBuffer>` versus `Uint8Array<ArrayBufferLike>` matters under TypeScript 6, which is what `asBytes()` in `util.ts` exists to reconcile.

Build with `pnpm --filter @skysend/crypto build`. Consumers import from `dist/`, so the server and web builds need this package built first - `pnpm typecheck` at the root already does that.

## Tests

`packages/crypto/tests/`, run with `pnpm --filter @skysend/crypto test`. Around 120 cases across 7 files - the most thoroughly tested package in the repo, and it should stay that way. The house naming style here is `it("should ...")`, unlike the rest of the monorepo.

Every change needs:

- a round-trip test (encrypt then decrypt returns the input),
- a tamper test (flipping a byte in the ciphertext or the tag makes decryption throw),
- boundary cases: empty input, exactly one record, one byte over a record, the last short record,
- for key derivation, a determinism assertion plus a domain-separation assertion, so the format cannot drift silently.

`tests/integration.test.ts` exercises the full upload and download path across modules. Extend it when a new piece joins the pipeline.
