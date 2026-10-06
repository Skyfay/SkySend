#!/usr/bin/env bash
# Sync the version from root package.json to all workspace packages.
# Usage:
#   pnpm version:sync                    - sync current version everywhere
#   pnpm version:bump                    - interactive version picker
#   pnpm version:bump patch|minor|major  - bump directly, then sync
#
# A bump also writes the version block of docs/changelog.md from the fragments in
# changelog/unreleased/ and deletes them, see scripts/changelog.mjs.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-}"
CURRENT=$(node -p "require('$ROOT_DIR/package.json').version")

# Workspace package.json files to sync
PACKAGE_FILES=(
  "$ROOT_DIR/apps/server/package.json"
  "$ROOT_DIR/apps/web/package.json"
  "$ROOT_DIR/apps/cli/package.json"
  "$ROOT_DIR/apps/client/package.json"
  "$ROOT_DIR/packages/crypto/package.json"
  "$ROOT_DIR/packages/note-format/package.json"
  "$ROOT_DIR/docs/package.json"
)

# ── Helper: compute next version ──────────────────────────────────
next_version() {
  local cur="$1" type="$2"
  node -p "
    const [ma,mi,pa] = '${cur}'.split('.').map(Number);
    if ('${type}' === 'major') (ma+1)+'.0.0';
    else if ('${type}' === 'minor') ma+'.'+(mi+1)+'.0';
    else ma+'.'+mi+'.'+(pa+1);
  "
}

# ── Sync files to a given version ─────────────────────────────────
sync_files() {
  local VERSION="$1"
  echo "Syncing version $VERSION ..."

  for PKG in "${PACKAGE_FILES[@]}"; do
    if [[ -f "$PKG" ]]; then
      node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
        pkg.version = '$VERSION';
        fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
      "
      echo "  ✓ ${PKG#$ROOT_DIR/}"
    fi
  done

  # Sync client version.ts (embedded in compiled binary)
  local VERSION_TS="$ROOT_DIR/apps/client/src/version.ts"
  cat > "$VERSION_TS" <<EOF
// Auto-synced by scripts/sync-version.sh - do not edit manually
export const APP_VERSION = "$VERSION";
EOF
  echo "  ✓ apps/client/src/version.ts"
}

# ── Write the changelog block of the new version ──────────────────
# Collected from the fragments in changelog/unreleased/, which are deleted afterwards.
insert_changelog() {
  local VERSION="$1"

  # Determine tag aliases based on version suffix
  local TAG_ALIASES
  if [[ "$VERSION" == *-beta* ]]; then
    TAG_ALIASES='`beta`'
  elif [[ "$VERSION" == *-dev* ]]; then
    TAG_ALIASES='`dev`'
  else
    local MAJOR="${VERSION%%.*}"
    TAG_ALIASES="\`latest\`, \`v${MAJOR}\`"
  fi

  node "$ROOT_DIR/scripts/changelog.mjs" release "$VERSION" "$TAG_ALIASES"
}

# ══════════════════════════════════════════════════════════════════
#  Sync-only mode: just propagate current version, no bump
# ══════════════════════════════════════════════════════════════════
if [[ "$MODE" == "--sync-only" ]]; then
  sync_files "$CURRENT"
  echo "Done - all files at v$CURRENT"
  exit 0
fi

# ══════════════════════════════════════════════════════════════════
#  Bump mode: interactive or direct
# ══════════════════════════════════════════════════════════════════

BUMP_TYPE="$MODE"

# ── Changelog fragments first, so a broken one stops the bump before anything changed ──
node "$ROOT_DIR/scripts/changelog.mjs" check

# ── Interactive picker (no argument given) ────────────────────────
if [[ -z "$BUMP_TYPE" ]]; then
  PATCH=$(next_version "$CURRENT" patch)
  MINOR=$(next_version "$CURRENT" minor)
  MAJOR=$(next_version "$CURRENT" major)

  echo ""
  echo "  Current version: v${CURRENT}"
  echo ""
  echo "  1) Patch  → v${PATCH}"
  echo "  2) Minor  → v${MINOR}"
  echo "  3) Major  → v${MAJOR}"
  echo "  4) Custom"
  echo ""
  printf "  Select [1-4]: "
  read -r CHOICE

  case "$CHOICE" in
    1) BUMP_TYPE="patch" ;;
    2) BUMP_TYPE="minor" ;;
    3) BUMP_TYPE="major" ;;
    4)
      printf "  Enter version (e.g. 2.0.0-beta): "
      read -r CUSTOM_VERSION
      if [[ -z "$CUSTOM_VERSION" ]]; then
        echo "No version entered. Aborted."
        exit 1
      fi
      if [[ ! "$CUSTOM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        echo "Invalid version format: $CUSTOM_VERSION"
        exit 1
      fi
      BUMP_TYPE="__custom__"
      ;;
    *)
      echo "Invalid choice. Aborted."
      exit 1
      ;;
  esac
fi

# ── Apply version bump ────────────────────────────────────────────
cd "$ROOT_DIR"
if [[ "$BUMP_TYPE" == "__custom__" ]]; then
  npm version "$CUSTOM_VERSION" --no-git-tag-version --no-workspaces-update >/dev/null
  echo "Set version to $CUSTOM_VERSION"
else
  npm version "$BUMP_TYPE" --no-git-tag-version --no-workspaces-update >/dev/null
  echo "Bumped root package.json ($BUMP_TYPE)"
fi

# ── Read new version and sync everything ──────────────────────────
VERSION=$(node -p "require('$ROOT_DIR/package.json').version")
insert_changelog "$VERSION"
sync_files "$VERSION"

echo "Done — all files at v$VERSION"
