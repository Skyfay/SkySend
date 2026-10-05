# Unreleased changelog entries

Every pull request writes its changelog entries into a file of its own in this folder instead of into `docs/changelog.md`. Pull requests that run side by side then never edit the same file. The release collects all files into the version block of `docs/changelog.md` and deletes them.

## The file

- One file per branch, named after the branch with `/` replaced by `-`, like `Skyfay-link-preview.md`. A change made without a branch of its own is named after the change.
- The same Markdown as a version block of the changelog, without the version header and without the Docker section, which the release writes.
- Notes like `> ⚠️ **Breaking:**` or `> ⚠️ **Before updating:**` go above the first section. The sections use the headings of the changelog in any order, the release sorts them.
- Every entry is one line with exactly one scope: `server`, `web`, `client`, `cli`, `crypto`, `docs`, `website`, `docker` or `infra`. A branch that changes its mind edits its own file rather than adding a second one.

```markdown
> ⚠️ **Breaking:** What breaks and how to migrate.

### ✨ Features

- **server**: What the change is, in one sentence, two only if unavoidable.

### 🐛 Bug Fixes

- **web**: What was wrong and what happens now. ([#70](https://github.com/Skyfay/SkySend/issues/70))
```

The rules for an entry, like at most two sentences, no `;` and no hyphen used as a dash, and which changes need one at all, are in the changelog part of [docs/CLAUDE.md](../../docs/CLAUDE.md). A test checks every file in this folder.

## Commands

- `pnpm changelog:check` checks the files on their own.
- `pnpm changelog:preview` prints the block the next release writes.
- `pnpm version:bump` writes that block into `docs/changelog.md` and deletes the files.
