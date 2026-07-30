#!/usr/bin/env bash
# List outdated dependencies per workspace package.
# Usage: pnpm update:check

set -uo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The package list comes from pnpm itself, so a newly added app or worker is covered
# without editing this script.
PROJECTS=()
while IFS= read -r dir; do
  [ -n "$dir" ] && PROJECTS+=("$dir")
done < <(pnpm list --recursive --depth -1 --parseable)

if [ ${#PROJECTS[@]} -eq 0 ]; then
  printf "${YELLOW}No workspace packages found.${NC}\n"
  exit 1
fi

OUTDATED=()

echo ""
printf "${BOLD}Checking SkySend dependencies...${NC}\n\n"

for dir in "${PROJECTS[@]}"; do
  name="${dir#"$ROOT"/}"
  [ "$dir" = "$ROOT" ] && name="root"
  printf "${BOLD}── %s ──${NC}\n" "$name"
  # Each package is checked on its own instead of through `pnpm outdated --recursive`,
  # which merges all of them into a single table that no longer says which versions
  # belong together.
  # `pnpm outdated` also exits 1 whenever it finds something, the way `diff` does. That is
  # the normal result for this script, so it must not end the run.
  if (cd "$dir" && pnpm outdated); then
    printf "${GREEN}✓ up to date${NC}\n\n"
  else
    OUTDATED+=("$name")
    echo ""
  fi
done

# ── Summary ───────────────────────────────────────────────────
printf "${BOLD}═══ Summary ═══${NC}\n"
if [ ${#OUTDATED[@]} -eq 0 ]; then
  printf "  ${GREEN}✓${NC} All %d packages are up to date.\n\n" "${#PROJECTS[@]}"
else
  for name in "${OUTDATED[@]}"; do
    printf "  ${YELLOW}•${NC} %s\n" "$name"
  done
  printf "\n${YELLOW}%d of %d packages have updates available.${NC}\n\n" "${#OUTDATED[@]}" "${#PROJECTS[@]}"
fi

# Outdated dependencies are a result, not a failure.
exit 0
