# File Requests

A file request reverses the usual direction: a requester publishes a link, senders upload files or a note into it, and only the requester can decrypt what arrives. The building blocks are the ones a normal upload uses, plus one public-key step, so the sender needs nothing the requester has to keep secret.

The code is in `packages/crypto/src/request.ts`, on top of `hpke.ts`.

## Overview

```
Requester (browser)
  inboxSecret, linkSecret   32 random bytes each
  P-256 key pair            private key sealed into the vault, public key into the upload link

Upload link   /request/<id>#base64url(0x01 || publicKey 65 B || linkSecret 32 B)
Inbox link    /inbox/<id>#base64url(0x01 || inboxSecret 32 B [|| passwordSalt 16 B])

Sender (browser)
  fileSecret, salt          fresh per upload, as for a normal upload
  file, metadata            encrypted with the keys from fileSecret, as for a normal upload
  wrap                      HPKE seal of fileSecret to the public key
```

The server stores the vault, three derived tokens, the encrypted brief and, for each upload, the ciphertext, the encrypted metadata and the wrap. It never learns either secret or the public key, unless a link reaches it, see [What the Server Can Still Do](#what-the-server-can-still-do).

## Keys From the Links

Both secrets are 32 uniform random bytes, so their keys come from HKDF-SHA256 without a salt. Each link is complete on its own, and no endpoint has to answer before its token is checked.

| Purpose | Input | HKDF info |
| --- | --- | --- |
| Vault key (AES-256-GCM) | `inboxSecret` | `skysend-inbox-key` |
| Inbox auth token (32 B) | `inboxSecret` | `skysend-inbox-auth` |
| Inbox owner token (32 B) | `inboxSecret` | `skysend-inbox-owner-token` |
| Upload token (32 B) | `linkSecret` | `skysend-request-upload-token` followed by the public key |
| Brief key (AES-256-GCM) | `linkSecret` | `skysend-request-brief` followed by the public key |

The upload token and the brief key take the public key as well, so an upload link rewritten with another key is refused by the server. The info strings differ from those of [normal uploads](/developer-guide/crypto/key-derivation), so a token of a request never matches a token of a file.

## The Vault

```
aad   = "skysend-inbox-privkey-v1" || SHA-256(briefNonce || briefCiphertext)
vault = AES-256-GCM(vaultKey, nonce 12 B, aad,
                    0x01 || publicKey 65 B || linkSecret 32 B || privateScalar 32 B)
```

Every request has a brief, so the AAD always binds one. Before hashing, the reader checks that the nonce is 12 bytes and the ciphertext has a padded length, so the same bytes cannot be split another way. A server that swaps, changes or drops the brief therefore opens no vault, and the inbox shows an error instead of a brief the requester never wrote.

It is always 146 bytes. Opening it with the inbox link gives back the private key and everything the upload link holds, so the inbox can show the upload link again. The private key is the one key in the package that is generated extractable, because its scalar has to go into the vault once. After that it is imported for `deriveBits` only.

## The Wrap

A sender seals the file secret with HPKE, RFC 9180, base mode, single shot, for one suite:

| Part | Choice | ID |
| --- | --- | --- |
| KEM | DHKEM(P-256, HKDF-SHA256) | `0x0010` |
| KDF | HKDF-SHA256 | `0x0001` |
| AEAD | AES-256-GCM | `0x0002` |

```
info = "skysend-request-v1" || requestId (16 bytes of the UUID)
aad  = uploadId (16 bytes of the UUID)
wrap = { enc: 65 B, ciphertext: 48 B }
```

The info and the aad bind a wrap to one request and one upload, so a server cannot move a wrap to another request or another upload. P-256 was chosen because every browser a sender might use has it. The KEM binds the ephemeral key and the recipient key into the shared secret, which stops a negated ephemeral point from opening the same wrap.

The implementation is checked against the CFRG test vectors for this suite, and a frozen fixture holds the exact bytes of every format above.

## The Brief

What the requester asks for travels in the brief:

```
plaintext = UTF-8 JSON {"v":1,"title":string|null,"asks":["files"|"note",...],"template":object|null}
            padded with spaces to a multiple of 1024 bytes, at most 8192 bytes
brief     = AES-256-GCM(briefKey, nonce 12 B, aad "skysend-request-brief-v1", plaintext)
```

| Field | Meaning |
| --- | --- |
| `title` | Free text from the requester, at most 256 bytes |
| `asks` | What senders may send: files, a note, or both |
| `template` | Only with a note: the fields a sender fills in, a note document without values from [the note format](/developer-guide/crypto/note-format#templates) |

It comes from the link, so only someone with the upload link or the inbox can read it. The padding hides how long the title is, and whether a small template is part of it. Senders see the title and the template marked as written by the requester and not checked.

- **Mandatory.** A sender whose brief does not open sees a broken request, never a quiet request for files. Without that rule a server could drop the brief of a request that asks for a note.
- **Later versions.** `v` only goes up for a change a reader of version 1 has to refuse. A field or an ask added later is left out by an older reader, as long as one ask it knows is left.
- **Who can write one.** Anyone with the upload link derives the brief key. The vault protects the brief toward the requester, while a sender trusts it only as far as the people who hold the upload link.

## Notes in a Request

A note a sender sends is an upload like a file, with the same transports, slot, wrap and download count:

```
blob     = ECE(fileKey, note document padded with spaces to a multiple of 1024 bytes)
metadata = AES-256-GCM(metaKey, {"type":"note","size":<padded bytes>})
```

`decryptRequestMetadata` reads it, `decryptMetadata` refuses it, so a crafted normal upload never sends a download page down the path of a note. Before the inbox fetches a note, it checks that the size is padded, that the stored bytes are exactly the encrypted size, and that it is no larger than `NOTE_MAX_SIZE` plus one block. The server learns that an upload is a note from its short metadata and its padded size, never what it holds.

## Password

With a password the inbox link carries the secret after [password protection](/developer-guide/crypto/password-protection), the same Argon2id and XOR scheme a file uses, plus the 16-byte password salt. A wrong password yields wrong tokens, which the server answers like a wrong link, and the lockout counts it.

## Why the Public Key Stays Out of the Server

- A server that handed out the public key could swap in its own and read every upload.
- A server that knew it could put uploads of its own into the inbox, because base-mode HPKE does not authenticate senders.

So the public key only ever travels in the fragment of the upload link and inside the vault.

## What the Server Can Still Do

- **Withhold uploads.** It can drop an upload, or list fewer than arrived. No client can tell.
- **Pick the upload ID.** The sender wraps to the ID the server returns, after checking it is a UUID. The binding stops the server from moving a finished wrap, not from refusing to store one.
- **Read a rewritten link.** A mail gateway that turns `#` into `%23` sends the fragment to the server as part of the path. For an inbox link, that is the key to the vault. For an upload link, it is the public key, so the server could then put uploads of its own into the inbox. See the [threat model](/user-guide/security/threat-model).
- **Read a reported link.** An abuse report for a request carries its upload link, so whoever receives the report learns the public key and could put uploads into the inbox as well. Reports never take an inbox link.

## Versions

The upload fragment and the vault start with the suite byte `0x01`, and the inbox fragment with a version byte. A later suite, such as X25519 or a hybrid with ML-KEM, can be added without breaking existing links.
