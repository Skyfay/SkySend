#!/usr/bin/env bash
set -e

# Resolve the primary checkout: prefer Orca's variable, fall back to git
ROOT="${ORCA_ROOT_PATH:-$(git worktree list --porcelain | head -n1 | sed 's/^worktree //')}"
TARGET="${ORCA_WORKTREE_PATH:-$(pwd)}"

if [ "$ROOT" = "$TARGET" ]; then
  echo "Running in the primary checkout, nothing to copy."
  exit 0
fi

# Copy a single file if it exists in the primary checkout and not yet in the worktree.
# Uses APFS copy-on-write on macOS and falls back to a regular copy elsewhere.
copy_file() {
  if [ -f "$ROOT/$1" ] && [ ! -f "$TARGET/$1" ]; then
    cp -c "$ROOT/$1" "$TARGET/$1" 2>/dev/null || cp "$ROOT/$1" "$TARGET/$1"
    echo "Copied: $1"
  fi
}

copy_file .env

cd "$TARGET"
pnpm install
