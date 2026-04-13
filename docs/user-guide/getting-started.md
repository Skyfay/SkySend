# Getting Started

SkySend is a minimalist, self-hostable, end-to-end encrypted file sharing service. The server never has access to the plaintext data at any time.

## What is SkySend?

SkySend lets you share files and encrypted notes securely. Files are encrypted in your browser before they leave your device, and the encryption key is embedded in the URL fragment (`#`), which is never sent to the server.

- **No accounts** - No registration, no login
- **No tracking** - No telemetry, no analytics
- **No dependencies** - Single Docker container, SQLite database
- **No trust required** - Server is cryptographically blind to your data

SkySend supports sharing encrypted notes in five content types: plain text, Markdown, passwords, code snippets, and SSH keys. All notes use the same end-to-end encryption as file uploads.

## How It Works

```
1. You select a file in your browser
2. A 256-bit secret key is generated
3. The file is encrypted (AES-256-GCM) in your browser
4. The encrypted blob is uploaded to the server
5. You get a share link: https://host/#secret_base64url
6. The recipient opens the link
7. The browser reads the secret from the URL fragment
8. The encrypted file is downloaded and decrypted in the browser
```

The server only ever sees encrypted data. The secret key lives exclusively in the URL fragment, which browsers never send to the server (per the HTTP specification).

## Quick Start

The fastest way to run SkySend is with Docker:

```bash
docker compose up -d
```

Then open [http://localhost:3000](http://localhost:3000).

That's it. Only `BASE_URL` is required - see [Environment Variables](/user-guide/configuration/environment-variables).

## Next Steps

- [Installation](/user-guide/installation) - Different ways to deploy SkySend
- [First Steps](/user-guide/first-steps) - Upload your first file
- [Docker Setup](/user-guide/self-hosting/docker) - Detailed Docker configuration
- [Configuration](/user-guide/configuration/environment-variables) - All environment variables
