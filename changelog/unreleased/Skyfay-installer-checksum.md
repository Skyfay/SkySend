### 🔒 Security

- **client**: `skysend update` no longer installs a new version whose checksum it could not check.
- **infra**: The Windows install script no longer installs a binary whose checksum does not match.
- **infra**: Both install scripts refuse a binary whose checksum is missing from the release or cannot be checked.

### 📝 Documentation

- **docs**: Documented that the install scripts and `skysend update` stop when the checksum of a binary does not match or cannot be checked.
