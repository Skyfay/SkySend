# Crypto

`@skysend/crypto` - the shared end-to-end encryption library. Web Crypto API only, no runtime dependencies, no WASM. It runs in the browser, in Web Workers, in Node 24, and in Bun-compiled CLI binaries, and it must keep running in all four.

Everything the product promises rests on this package. Treat a change here the way you would treat a change to a lock, not to a helper.

## Hard rules

1. **No dependencies.** `package.json` has no `dependencies` block and should not gain one. Anything that needs WASM (Argon2id) is injected by the caller as a function.
2. **Web Crypto only.** No `node:crypto`, no polyfills, no `Buffer`. `crypto.getRandomValues` and `crypto.subtle` are the whole toolbox.
3. **Never change a wire format without a migration path.** Uploads created by an older client must keep decrypting until they expire. `deriveKeys` still accepts 16-byte legacy salts for exactly that reason, and the `TODO` above it is the removal plan.
4. **Never make a key extractable.** Every `deriveKey` call passes `false`. There is no reason to export a derived key. The one exception is the private key of a file request in `createFileRequest()`, which has to be sealed into the vault once. Only its scalar leaves that function, inside the vault. After `openRequestKey()` it is imported non-extractable, for `deriveBits` only.
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

## File requests

A requester asks for files or a note, senders drop them in, only the requester reads them (`request.ts`, on top of `hpke.ts`). The requester's browser makes a P-256 key pair, an `inboxSecret` and a `linkSecret`. The private key is sealed into the vault with a key from `inboxSecret` and stored on the server. The public key and `linkSecret` travel only in the fragment of the upload link, `inboxSecret` only in the fragment of the inbox link. A sender uploads with a fresh file secret as usual and wraps it to the public key with HPKE.

`createFileRequest()` returns `{ local, server }`. Only `server` is ever sent. Both secrets are 32 uniform bytes, so their keys are derived without a salt: each link is self-contained, and no endpoint has to answer before its token is checked. The upload token and the brief key also take the public key, so a link rewritten with another key is rejected by the server.

Every request carries a brief: versioned JSON with the title, what is asked for (`files`, `note`) and an optional note template, padded with spaces to whole 1 KiB blocks, at most 8 KiB, encrypted with the brief key. It is mandatory, so a sender whose brief does not open sees a broken request. A reader of version 1 leaves out fields and asks it does not know, and `v` only goes up for a change it has to refuse. The template is an object here and nothing more. `@skysend/note-format` validates it. A note sent into a request is an upload whose metadata is `{ type: "note", size }`. Only `decryptRequestMetadata` reads it, `decryptMetadata` refuses it.

HPKE is RFC 9180 base mode, single-shot, for one suite: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-256-GCM. P-256 because every browser a sender might use has it. The KEM binds enc and the recipient key into the shared secret, which is what stops a negated ephemeral point (P-256 ECDH only yields x) from opening the same wrap. Never replace it with a hand-rolled ECDH plus HKDF, a review proved that malleable.

The public key must only ever come from the fragment, and the server must never learn it. A server that hands it out could swap in its own key and read every upload. A server that knows it could put uploads into the inbox, because base-mode HPKE does not authenticate senders.

| Purpose | Info string or label |
| :--- | :--- |
| Vault key | `skysend-inbox-key` |
| Inbox auth token | `skysend-inbox-auth` |
| Inbox owner token | `skysend-inbox-owner-token` |
| Upload token | `skysend-request-upload-token` followed by the public key |
| Brief key | `skysend-request-brief` followed by the public key |
| HPKE info | `skysend-request-v1` followed by the 16 bytes of the request ID |
| HPKE aad | the 16 bytes of the upload ID |
| Vault AAD | `skysend-inbox-privkey-v1` followed by SHA-256 of the brief nonce and ciphertext, checked for their lengths first |
| Brief AAD | `skysend-request-brief-v1` |

The suite byte `REQUEST_SUITE` (`0x01`) opens the upload fragment and the vault, and a version byte opens the inbox fragment, so a later suite (X25519, or a hybrid with ML-KEM) can be added without breaking existing links. With a password, the inbox fragment carries the protected secret plus the 16-byte password salt. The vault holds only the 32-byte private scalar, so its length is fixed (`REQUEST_VAULT_LENGTH`). The server checks every length against the exported `REQUEST_*` and `WRAP_*` constants. `tests/fixtures/file-request.json` freezes the whole format and `tests/fixtures/hpke-p256-sha256-aes256gcm.json` holds the CFRG test vector. **From the first release on, never regenerate or edit either file.**

## Modules

| File | Owns |
| :--- | :--- |
| `keychain.ts` | Secret and salt generation, HKDF derivation, auth and owner tokens |
| `ece.ts` | Streaming AES-256-GCM in 64 KB records, plus exact size math |
| `metadata.ts` | AES-256-GCM over the JSON metadata blob, and the note metadata of request uploads |
| `note.ts` | AES-256-GCM over note content, with its own nonce |
| `password.ts` | Argon2id KDF plus the XOR protection layer |
| `hpke.ts` | RFC 9180 HPKE, base mode, single-shot, one P-256 suite |
| `request.ts` | File requests: vault, wrapped file secrets, tokens, brief, upload fragment |
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

`packages/crypto/tests/`, run with `pnpm --filter @skysend/crypto test`. Around 180 cases across 9 files - the most thoroughly tested package in the repo, and it should stay that way. `tests/helpers.ts` holds the hex and point helpers of the HPKE and request tests. The house naming style here is `it("should ...")`, unlike the rest of the monorepo. `tsconfig.test.json` typechecks the tests with the same strict settings as the code, as part of `pnpm typecheck`. A direct `crypto.subtle` call in a test wraps its bytes in `asBytes` from `src/util.ts`, and a byte is flipped with `flipped` from `tests/helpers.ts`.

Every change needs:

- a round-trip test (encrypt then decrypt returns the input),
- a tamper test (flipping a byte in the ciphertext or the tag makes decryption throw),
- boundary cases: empty input, exactly one record, one byte over a record, the last short record,
- for key derivation, a determinism assertion plus a domain-separation assertion, so the format cannot drift silently.

`tests/integration.test.ts` exercises the full upload and download path across modules. Extend it when a new piece joins the pipeline.
