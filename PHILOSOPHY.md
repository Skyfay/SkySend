# Project Philosophy

## What this project IS

- A minimal, self-hostable, end-to-end encrypted file and note sharing service
- Zero-knowledge: the server never sees your files or notes
- No accounts, no tracking, no analytics
- A single Docker container you can deploy in minutes
- Open source so anyone can verify the encryption claims

## What this project is NOT

- Not a cloud storage service (files expire, no persistent storage)
- Not a collaboration tool
- Not a platform with user management or roles
- Not a replacement for Dropbox, Google Drive, or similar services
- Not a CDN or content delivery platform

## Core Principles

### Privacy by Design

The server is intentionally blind. It receives only encrypted blobs and has no access to the secret key. The key lives exclusively in the URL fragment (`#`), which browsers never send to the server.

### Simplicity

Every feature must justify its existence. If something can be solved with configuration instead of code, use configuration. If something adds complexity without serving the core mission, it does not belong here.

### Self-Hosting First

This project is designed to run on your own hardware. No vendor lock-in, no external service dependencies, no phone-home. A single `docker compose up` should be enough.

## Feature Request Guidelines

Before opening an issue, ask yourself:

- Does this serve the core mission of simple, private file and note sharing?
- Can this be solved with configuration instead of new code?
- Does this increase the attack surface?
- Does this add a required external dependency?

We will close feature requests that conflict with the project philosophy. This is not unfriendly - it keeps the project focused and secure.

You are always welcome to implement additional features in your own fork.
