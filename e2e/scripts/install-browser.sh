#!/usr/bin/env bash
# Installs a Playwright browser and its system libraries on a CI runner, for the E2E jobs of
# .github/workflows/validate.yml: `bash e2e/scripts/install-browser.sh chromium`.
#
# The browser comes from the cache of the job or Playwright's download servers. The system
# libraries come from apt, and the Ubuntu mirror of the runners sometimes delivers them at
# 50 KB/s, which held a job for half an hour (2026-10-23). A try is cut off after eight minutes
# and started again, and since apt keeps every package it finished, each try gets further.
#
# install-deps runs as root under `timeout`, so the timeout reaches apt-get itself. Through
# Playwright's own sudo it did not: apt-get went on, held the dpkg lock and failed every retry.
set -u
browser="$1"
cd "$(dirname "$0")/.."

./node_modules/.bin/playwright install "$browser" || exit 1

for attempt in 1 2 3; do
  sudo env "PATH=$PATH" timeout --kill-after=30 480 ./node_modules/.bin/playwright install-deps "$browser" && exit 0
  echo "::warning::Installing the system libraries of $browser failed or took too long, attempt $attempt of 3"
  sudo dpkg --configure -a || true
done
exit 1
