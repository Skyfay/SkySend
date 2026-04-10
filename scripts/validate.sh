#!/usr/bin/env bash
# Run all validation checks locally (same as CI).
# Usage: pnpm validate

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

PASSED=()
FAILED=()

run_check() {
  local name="$1"
  shift
  printf "${BOLD}── %s ──${NC}\n" "$name"
  if "$@" 2>&1; then
    PASSED+=("$name")
    printf "${GREEN}✓ %s passed${NC}\n\n" "$name"
  else
    FAILED+=("$name")
    printf "${RED}✗ %s failed${NC}\n\n" "$name"
  fi
}

echo ""
printf "${BOLD}Running SkySend validation checks...${NC}\n\n"

run_check "Lint"       pnpm lint
run_check "TypeCheck"  pnpm typecheck
run_check "Tests"      pnpm test

# ── Summary ───────────────────────────────────────────────────
echo ""
printf "${BOLD}═══ Summary ═══${NC}\n"
for name in "${PASSED[@]+"${PASSED[@]}"}"; do
  printf "  ${GREEN}✓${NC} %s\n" "$name"
done
for name in "${FAILED[@]+"${FAILED[@]}"}"; do
  printf "  ${RED}✗${NC} %s\n" "$name"
done
echo ""

if [ ${#FAILED[@]} -eq 0 ]; then
  printf "${GREEN}${BOLD}All checks passed!${NC}\n"
  exit 0
else
  printf "${RED}${BOLD}%d check(s) failed.${NC}\n" "${#FAILED[@]}"
  exit 1
fi
