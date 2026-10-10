### 📝 Documentation

- **docs**: The developer guide describes the steps of a release.

### 🔧 CI/CD

- **infra**: `pnpm toolbox` shows the release and maintenance commands in one menu, and each still runs on its own.
- **infra**: The version bump stops at CodeQL alerts open on dev until you confirm, and `pnpm codeql:check` lists them on its own.
- **infra**: `pnpm release:tag` tags the release on main with the title from the changelog and pushes the tag, and `pnpm release:untag` deletes a tag here and on GitHub.
- **infra**: `pnpm changelog:amend` adds the fragments to a version block the version bump wrote already.
- **infra**: `pnpm audit:check` runs `pnpm audit` for the whole workspace.
