# Password Protection

SkySend supports optional password protection using Argon2id (WASM, memory-hard, GPU-resistant).

## How It Works

Password protection adds an extra layer on top of the encryption secret. The secret is XOR'd with a password-derived key, making it unrecoverable without the password.

```
Upload:   protectedSecret = secret XOR passwordKey
Download: secret = protectedSecret XOR passwordKey
```

The XOR operation is reversible, so the original secret can be recovered by applying the same password key.

## Key Derivation Function

### Argon2id

Argon2id is a memory-hard KDF that is resistant to GPU and ASIC attacks. SkySend uses it via a WASM implementation in the browser.

| Parameter | Value |
| --- | --- |
| Memory | 65,536 KiB (64 MiB) |
| Iterations | 3 |
| Parallelism | 1 |
| Hash Length | 32 bytes |

These parameters follow the [OWASP strong recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) for Argon2id.

```typescript
const { key, algorithm } = await deriveKeyFromPassword(password, salt, argon2id)
// algorithm = "argon2id-v2"
```

## Password Salt

A 16-byte random salt is generated per upload:

```typescript
const passwordSalt = randomBytes(16) // PASSWORD_SALT_LENGTH = 16
```

The salt and the algorithm identifier are stored on the server so that the downloader can derive the same password key.

## Upload Flow

1. User sets a password during upload
2. Client generates a password salt
3. Client derives `passwordKey` from the password
4. Client computes `protectedSecret = secret XOR passwordKey`
5. Client sends `X-Has-Password: true`, `X-Password-Salt`, and `X-Password-Algo` headers
6. The share link now contains the `protectedSecret` instead of the raw secret

## Download Flow

1. Client fetches upload info, sees `hasPassword: true` with `passwordAlgo` and `passwordSalt`
2. User enters the password
3. Client derives `passwordKey` using the stored algorithm and salt
4. Client recovers `secret = protectedSecret XOR passwordKey`
5. Client derives keys and computes `authToken`
6. Client verifies the password via `POST /api/password/:id` with the derived auth token
7. If the token matches, the server returns the encrypted metadata, which `GET /api/info/:id` holds back for a password-protected upload, and the download proceeds

Without the metadata nobody can test a guess offline, so every guess has to pass the password check or the download, which share one lockout. Someone who holds both the link and the server's database can still guess offline at the cost of one Argon2id run per guess, which is why the clients ask for at least `MIN_PASSWORD_LENGTH` (8) characters for a new password. Only the clients can check that, since the server never sees the password.

## Constants

| Constant | Value |
| --- | --- |
| `PASSWORD_SALT_LENGTH` | 16 bytes |
| `MIN_PASSWORD_LENGTH` | 8 characters, for a new password |
| `DERIVED_KEY_LENGTH` | 32 bytes |
| `ARGON2_PARAMS.memory` | 65,536 KiB |
| `ARGON2_PARAMS.iterations` | 3 |
| `ARGON2_PARAMS.parallelism` | 1 |
| `ARGON2_PARAMS.hashLength` | 32 bytes |

## Security Considerations

- **Unique salt per upload** - Prevents rainbow table attacks
- **Memory-hard KDF** - Argon2id is resistant to GPU/ASIC brute-force
- **Server never sees the password** - Only verifies the derived auth token
- **UTF-8 encoding** - Passwords are consistently encoded as UTF-8 before hashing
