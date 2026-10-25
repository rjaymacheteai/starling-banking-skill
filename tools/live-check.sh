#!/usr/bin/env bash
# Explicit developer live reads; credentials are stored only in .local/config.json.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -s .local/config.json ]]; then
  echo 'Create .local/config.json from config.json.example and fill auth.accountToken locally.' >&2
  exit 2
fi
exec node tools/live-check.mjs
