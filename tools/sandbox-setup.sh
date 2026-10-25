#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
case "${1:-default}" in
  all) sandbox_profiles=(individual individual-2 joint business) ;;
  default|individual|individual-2|joint|business) sandbox_profiles=("${1:-default}") ;;
  *) echo 'Unknown sandbox customer.' >&2; exit 2 ;;
esac
for sandbox_profile in "${sandbox_profiles[@]}"; do
  node tools/sandbox.mjs setup "$sandbox_profile"
  if [[ ! -t 0 ]]; then echo 'Fill the isolated config locally before checking.' >&2; exit 2; fi
  if [[ "${2:-}" == --clipboard ]]; then
    read -r -p "Copy the $sandbox_profile simulator token, then press Enter: "
    starling_sandbox_token="$(pbpaste)"
  else
    IFS= read -r -s -p "$sandbox_profile simulator token (hidden): " starling_sandbox_token
    printf '\n'
  fi
  printf '%s' "$starling_sandbox_token" | node tools/sandbox.mjs token "$sandbox_profile"
  unset starling_sandbox_token
  IFS= read -r -p 'Registered API Key UID (Enter to configure later): ' starling_sandbox_uid
  if [[ -n "$starling_sandbox_uid" ]]; then STARLING_SANDBOX_KEY_UID="$starling_sandbox_uid" node tools/sandbox.mjs key "$sandbox_profile"; fi
  unset starling_sandbox_uid
  node tools/sandbox.mjs check "$sandbox_profile"
done
