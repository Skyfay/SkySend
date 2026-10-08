#!/usr/bin/env bash
set -e

# Resolve the primary checkout: prefer Orca's variable, fall back to git
ROOT="${ORCA_ROOT_PATH:-$(git worktree list --porcelain | head -n1 | sed 's/^worktree //')}"
TARGET="${ORCA_WORKTREE_PATH:-$(pwd)}"

# A checkout without a dev environment of its own starts from the template.
ensure_dev_env() {
  if [ ! -f "$1/.env.dev" ] && [ -f "$1/.env.dev.example" ]; then
    cp "$1/.env.dev.example" "$1/.env.dev"
    echo "Created: .env.dev from .env.dev.example"
  fi
}

if [ "$ROOT" = "$TARGET" ]; then
  ensure_dev_env "$TARGET"
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
copy_file .env.dev
ensure_dev_env "$TARGET"

cd "$TARGET"
pnpm install
