---
applyTo: "**/*"
---

# Workflow Rules

## Changelog - Always Update on Every Change

**Whenever you make any change** - feature, bug fix, security fix, improvement, refactor, or docs update - you **must** add a corresponding entry to `docs/changelog.md` in the same response. Do not defer it.

### Finding the active version

The active (unreleased) version is the topmost `## vX.Y.Z` block with `*Release: In Progress*`. Always add entries there.

If no in-progress version exists, ask the user before creating a new version block.

### Mapping changes to sections

Refer to `changelog.instructions.md` for the exact format, scopes, section order, and all formatting rules. Follow them precisely.

If the section heading already exists in the active version, append to it. If not, create it in the correct position relative to other existing sections.

### What counts as a changelog entry

- New feature or capability -> add entry
- Bug fix for an **already released** version -> add entry
- Security fix -> add entry
- Improvement, refactor with user-visible impact -> add entry
- Documentation change -> add entry
- CI/CD or Docker change -> add entry

### What does NOT get a changelog entry

- Fixing a bug in code that has **not been released yet** (e.g. fixing a mistake during active feature development) -> no entry
- Iterating on in-progress work within the same version -> no entry
- Code formatting, linting, or trivial cleanup -> no entry

See the **Bug Fix Policy** in `changelog.instructions.md` for detailed examples.
