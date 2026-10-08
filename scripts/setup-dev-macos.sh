#!/usr/bin/env bash
# Set up a Mac for SkySend development: fnm with the Node of .node-version, pnpm in the
# version package.json pins, the dependencies and .env.dev.
# Usage: bash scripts/setup-dev-macos.sh

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "${GREEN}==>${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}==>${NC} %s\n" "$*"; }
fail() { printf "${RED}==>${NC} %s\n" "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS. Elsewhere, install Node $(cat .node-version) and pnpm 10, then run pnpm install."
command -v brew >/dev/null 2>&1 || fail "Homebrew is not installed. Install it first: https://brew.sh/"

NODE_VERSION="$(tr -d '[:space:]' < .node-version)"

# Node comes from fnm in the version of .node-version, the one CI and the Docker image use.
# A plain `brew install node` would follow the newest release instead.
if command -v fnm >/dev/null 2>&1; then
  info "fnm is installed."
else
  info "Installing fnm..."
  brew install fnm
fi
eval "$(fnm env --shell bash)"

info "Installing Node ${NODE_VERSION}..."
fnm install "$NODE_VERSION"
fnm use "$NODE_VERSION" >/dev/null
# The first Node of a fresh fnm becomes the default for terminals outside the project.
fnm list | grep -q "default" || fnm default "$NODE_VERSION"
info "Using Node $(node -v)."

# Corepack ships with Node 24 and runs the pnpm version of "packageManager" in package.json.
info "Enabling pnpm..."
corepack enable pnpm
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
info "Using pnpm $(pnpm -v)."

info "Installing dependencies..."
pnpm install

# .env.dev holds the values of this machine and stays out of git, .env.dev.example is its template.
if [ -f .env.dev ]; then
  info ".env.dev already exists."
else
  cp .env.dev.example .env.dev
  info "Created .env.dev from .env.dev.example."
fi

# Without this line in ~/.zshrc, a new terminal keeps the Node it finds first on PATH.
FNM_LINE='eval "$(fnm env --use-on-cd)"'
ZSHRC="$HOME/.zshrc"
if grep -qs "fnm env" "$ZSHRC"; then
  info "~/.zshrc already loads fnm."
elif [ -t 0 ]; then
  printf "${BOLD}Add the fnm line to ~/.zshrc, so new terminals use Node ${NODE_VERSION} here? [Y/n]${NC} "
  read -r answer
  if [[ "$answer" =~ ^[Nn] ]]; then
    warn "Not added. Add this line to ~/.zshrc yourself:"
    echo "  $FNM_LINE"
  else
    printf '\n%s\n' "$FNM_LINE" >> "$ZSHRC"
    info "Added to ~/.zshrc."
  fi
else
  warn "Add this line to ~/.zshrc, so new terminals use Node ${NODE_VERSION} here:"
  echo "  $FNM_LINE"
fi

echo ""
printf "${BOLD}Done.${NC} Open a new terminal, then start everything with: pnpm dev\n"
