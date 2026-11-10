> ⚠️ **Before updating:** With `TRUST_PROXY=true`, SkySend now reads `X-Forwarded-For` and `X-Real-IP` only on a connection from loopback or a private network. If your reverse proxy or CDN connects from a public address, list it in the new `TRUSTED_PROXIES`, or every visitor counts as the proxy.

### ✨ Features

- **server**: New option `TRUSTED_PROXIES` names the addresses and networks a reverse proxy connects from. Unset, these are loopback and the private networks.

### 🔒 Security

- **client**: The CLI binary no longer reads `bunfig.toml` or `.env` from the folder it starts in. Two received files saved there, a `bunfig.toml` and a script, could run code on the next start of `skysend` in that folder.
- **client**: On Windows the CLI no longer runs a program from the current folder when it means a system tool. A received file named clip.exe, rundll32.exe, cmd.exe or tput.exe there used to run instead on copy, browser opening, login, update or the start of the interactive mode.
- **server**: With `TRUST_PROXY=true`, forwarded client addresses count only on a connection from `TRUSTED_PROXIES`. Anyone who reached the server port directly could send a new address with every password guess and was never locked out.
- **server**: The key that hashes client IPs for upload quotas stays in memory and is no longer stored in the database. With a copy of the database or a backup, the hashes could be turned back into IPv4 addresses, so upload quotas now start afresh on a restart.

### 📝 Documentation

- **docs**: The reverse proxy guide explains `TRUSTED_PROXIES` and tells to publish the server port on `127.0.0.1` when the proxy runs on the same host.
