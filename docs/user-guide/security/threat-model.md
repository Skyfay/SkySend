# Threat Model

This document describes the threat model for SkySend, outlining what it protects against and what is out of scope.

## Actors

### Uploader
The person who uploads a file and generates a share link.

### Recipient
The person who receives the share link and downloads the file.

### Server Operator
The person or organization running the SkySend instance.

### Network Attacker
An attacker who can observe or modify network traffic between client and server.

### Storage Attacker
An attacker who gains access to the server's filesystem or database.

## What SkySend Protects Against

### Compromised Server
**Threat**: The server operator or an attacker with server access reads uploaded files.

**Mitigation**: All files are encrypted client-side with AES-256-GCM before upload. The encryption key is never sent to the server - it exists only in the URL fragment. The server stores only ciphertext.

**Result**: Even with full database and filesystem access, an attacker cannot decrypt files without the share link.

### Passive Network Observation
**Threat**: An attacker intercepts traffic between the client and server.

**Mitigation**: When using HTTPS (strongly recommended), all traffic is encrypted in transit. The URL fragment (`#secret`) is never included in HTTP requests, so it cannot be observed even in TLS termination logs.

**Result**: The encryption key is not visible to network observers.

### Brute-Force Token Guessing
**Threat**: An attacker tries to guess auth tokens to download files.

**Mitigation**: Auth tokens are derived from 256-bit secrets via HMAC-SHA256. Token verification uses constant-time comparison to prevent timing attacks.

**Result**: Brute-forcing a 256-bit key space is computationally infeasible.

### Brute-Force Password Guessing
**Threat**: An attacker tries to brute-force the password on a password-protected upload.

**Mitigation**: Password-derived keys use Argon2id (64 MiB memory, GPU-resistant). Rate limiting applies to all endpoints.

**Result**: Online brute-force is impractical due to rate limiting. Offline brute-force is expensive due to memory-hard KDF.

### Upload Abuse (Storage Exhaustion)
**Threat**: An attacker uploads large amounts of data to fill the server's disk.

**Mitigation**: Upload quotas (HMAC-hashed IPs with daily rotation), maximum file size limits, rate limiting, and automatic expiry/cleanup.

**Result**: Storage abuse is bounded by configured limits.

### IP Tracking via Quotas
**Threat**: The quota system could be used to track users by IP.

**Mitigation**: IPs are hashed with HMAC-SHA256 using a key that rotates daily. When the key rotates, the entire quota store is cleared. No plaintext IPs are ever stored.

**Result**: IP addresses cannot be recovered from quota records, and tracking across days is impossible.

## What SkySend Does NOT Protect Against

### Compromised Client
If the uploader's or recipient's device is compromised (malware, keylogger), the attacker can access plaintext files. SkySend cannot protect against endpoint compromise.

### Share Link Interception
If the share link is sent over an insecure channel (e.g., unencrypted email, public chat) and intercepted, the attacker can download and decrypt the file. Users should share links through secure channels.

### Link Rewriting by Mail Security Gateways

Choosing the transport is the sender's decision, and SkySend cannot influence it. A link posted publicly or sent through a channel that reads along is outside the product's control.

The recipient's mail infrastructure is a different case, because the sender has no say in it. Microsoft Defender Safe Links, Proofpoint URL Defense, and Mimecast rewrite links after the message has left the sender. Two outcomes are possible:

- **The fragment is percent-encoded** (`#` becomes `%23`). The key then arrives as part of the request path, so the server, the reverse proxy, and any CDN see it in the request line. SkySend repairs the link in the browser and truncates its own request log at the resource ID, but the exposure itself cannot be undone, and logs in front of the application are the operator's responsibility.
- **The fragment is dropped**. The key never reaches the browser and the link cannot be recovered at all.

Either way, the gateway operator holds the full original URL, since the link was in the message body when it passed through their systems.

#### What the instance operator can do with it

Decrypting an upload takes three separate pieces, and a rewritten link puts all of them in reach of whoever runs the instance:

| Piece | Where it lives |
| :--- | :--- |
| The secret from the URL fragment | The reverse proxy or CDN access log |
| The HKDF salt | The database |
| The ciphertext | The blob storage |

**Without a password, that is enough.** An operator who holds the access log plus backups of the database and the blob storage can decrypt the upload, including after the sender deleted it. Deleting removes the live copy, it does not reach into a backup.

**With a password, it is not enough.** The URL fragment carries only the raw secret. The keys that actually decrypt anything are derived from that secret combined with an Argon2id hash of the password, and the password never leaves the browser, so the server stores neither it nor a hash of it. The same operator would have to brute force the password at 64 MiB of memory and three iterations per guess.

#### What to do

**After the fact**, a new link is not a remedy, because the exposed secret stays exposed. Ask the sender to delete the upload, which removes the ciphertext that secret unlocks. On an instance without backups that closes the case, and a one-time download link that was already used is gone anyway. Against an operator who keeps backups, deletion only narrows the window.

**Before the fact**, add a password and send it through a separate channel. That is the only measure which survives the exposure completely, because it keeps one required piece off the server entirely.

### Malicious File Content
SkySend does not inspect or scan file contents. It encrypts and stores whatever the user uploads. SkySend is not responsible for malicious file content.

### Metadata Leakage (File Size)
The server knows the encrypted file size, which reveals the approximate original file size. This is inherent to any file transfer system. File names and types are encrypted.

### Server Availability
SkySend does not provide redundancy or high availability. If the server goes down, files are unavailable until it recovers.

### Long-Term Secret Storage
Share links contain the encryption key. If a share link is stored long-term (e.g., in chat logs, bookmark managers), anyone who later accesses it can download the file (until it expires).

## Recommendations

1. **Always use HTTPS** - Deploy behind a reverse proxy with TLS to protect traffic in transit
2. **Share links securely** - Use end-to-end encrypted messaging to share links
3. **Set short expiry times** - Files should expire as soon as they are no longer needed
4. **Use low download limits** - Set the download limit to the number of intended recipients
5. **Use password protection** - For sensitive files, add a password and share it through a separate channel, which also covers links rewritten by a mail security gateway
6. **Keep SkySend updated** - Apply updates promptly for security fixes
