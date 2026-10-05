### 🔒 Security

- **web**: A download that the server cut short at a record boundary now fails instead of being saved as a complete file (GHSA-w3p6-2vcf-mmv9).
- **client**: A download that the server cut short at a record boundary now fails in the CLI and the TUI, and the incomplete file is removed (GHSA-w3p6-2vcf-mmv9).
- **crypto**: Archive metadata now records the size of the zip, so archive downloads can be checked for completeness. Archives uploaded with older versions cannot be checked this way.

### 📝 Documentation

- **docs**: Documented the size check on downloads and the archive size in the encrypted metadata.

### 🧪 Tests

- **crypto**: Added tests for downloads cut short at a record boundary and for the archive size in the metadata.
- **web**: Added tests that every download tier rejects a truncated file without falling back to the next tier.
