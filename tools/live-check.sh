#!/usr/bin/env bash
# Live API reads only. No model calls, evals, signing or bank writes.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local
chmod 700 .local

if [[ ! -s .local/access-token ]]; then
  if [[ ! -t 0 ]]; then
    echo 'Run this command in your terminal to enter the token securely.' >&2
    exit 2
  fi
  IFS= read -r -s -p 'Starling LIVE personal access token (input hidden): ' starling_live_token
  printf '\n'
  if [[ -z "$starling_live_token" ]]; then
    echo 'No token entered.' >&2
    exit 2
  fi
  printf '%s' "$starling_live_token" > .local/access-token
  unset starling_live_token
fi
chmod 600 .local/access-token
exec node tools/live-check.mjs
