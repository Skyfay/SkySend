# Toolbox

The commands for releasing and maintaining SkySend, behind one menu. Everything in this folder belongs to the toolbox. The scripts directly in `scripts/` stand on their own, like the setup scripts or the installers.

```bash
pnpm toolbox                    # the menu
pnpm toolbox <command> [args]   # one command, like pnpm toolbox release:untag v3.0.1
pnpm <command> [args]           # the same, every command is a script in package.json too
```

| Group | Command | What it does |
| :--- | :--- | :--- |
| Release | `version:bump` | Checks the fragments and the CodeQL alerts on dev, then writes the changelog block and the next version |
| Release | `release:tag` | Tags the release on main with the title from the changelog and pushes the tag |
| Release | `release:untag` | Deletes a tag here and on GitHub |
| Release | `version:sync` | Copies the current version to every workspace package and to the CLI client |
| Changelog | `changelog:check` | Checks every fragment under `changelog/unreleased/` |
| Changelog | `changelog:preview` | Prints the block the next release writes |
| Changelog | `changelog:amend [version]` | Adds the fragments to a version block the bump wrote already, the newest unless another is named |
| Security | `codeql:check` | Lists the CodeQL alerts open on dev that main does not have |
| Security | `audit:check` | Runs `pnpm audit` for the whole workspace |
| Maintenance | `update:check` | Runs `pnpm outdated` for every workspace package |

## Files

| File | What it holds |
| :--- | :--- |
| `index.mjs` | The menu and `COMMANDS`, the list of every command |
| `cli.mjs` | What the commands share: running git and gh, asking on the terminal |
| `changelog.mjs` | The changelog fragments, the release block and adding to it |
| `version.mjs` | The version bump and sync |
| `release-tag.mjs` | Creating and deleting the tag of a release |
| `codeql.mjs` | The CodeQL alerts on dev |
| `audit.mjs` | The known vulnerabilities of the dependencies |
| `updates.mjs` | The outdated dependencies |

Each file has its test beside it, run by `pnpm test:scripts`.

## A new command

1. Write it as an exported function in a file of its own here, or in the file of its topic.
2. Add it to `COMMANDS` in `index.mjs`, with its group. A new group is just a new name there. When this folder gets too full, a group can move into a subfolder of its own.
3. Add the script `"<name>": "node scripts/toolbox/index.mjs <name>"` to package.json, in the block below `toolbox` and in the order of `COMMANDS`. A test fails while the two differ.
4. Test the parts that decide something, in a `.test.ts` beside the file.
