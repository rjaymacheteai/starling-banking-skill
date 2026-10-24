#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
starling_clipboard_mode=false
if [[ "${2:-}" == --clipboard ]]; then
  command -v pbpaste >/dev/null || { echo 'Clipboard mode requires macOS pbpaste.' >&2; exit 2; }
  starling_clipboard_mode=true
elif [[ -n "${2:-}" ]]; then
  echo 'Optional second argument: --clipboard' >&2
  exit 2
fi

capture_sandbox_token() {
  local label="$1" optional="$2" reply=''
  starling_sandbox_captured=''
  if [[ "$starling_clipboard_mode" == true ]]; then
    echo "Copy the $label in your browser, then return here. Do not paste it into this prompt." >&2
    if [[ "$optional" == true ]]; then
      IFS= read -r -p 'Press Enter to capture the clipboard, or type skip: ' reply
      if [[ "$reply" == skip ]]; then return 1; fi
    else
      IFS= read -r -p 'Press Enter to capture the clipboard: ' reply
    fi
    if [[ -n "$reply" ]]; then echo 'Use Enter to capture the clipboard; do not type the token here.' >&2; return 2; fi
    starling_sandbox_captured="$(pbpaste)"
  else
    IFS= read -r -s -p "$label (input hidden; Enter skips an optional token): " starling_sandbox_captured
    printf '\n'
  fi
  if [[ -z "$starling_sandbox_captured" ]]; then
    if [[ "$optional" == true ]]; then return 1; fi
    echo 'No token captured.' >&2; return 2
  fi
  if [[ "$starling_sandbox_captured" =~ [[:space:]] ]]; then
    unset starling_sandbox_captured
    echo 'The captured value contains whitespace. Copy only the token value and rerun setup.' >&2
    return 2
  fi
}

case "${1:-default}" in
  all) sandbox_profiles=(individual individual-2 joint business) ;;
  default|individual|individual-2|joint|business) sandbox_profiles=("${1:-default}") ;;
  *) echo 'Use all, individual, individual-2, joint or business.' >&2; exit 2 ;;
esac

for sandbox_profile in "${sandbox_profiles[@]}"; do
  node tools/sandbox.mjs setup "$sandbox_profile"
  sandbox_home=".local/sandbox/$sandbox_profile"
  if [[ "$sandbox_profile" == default ]]; then sandbox_home=.local/sandbox; fi
  chmod 700 "$sandbox_home"
  if [[ ! -s "$sandbox_home/access-token" ]]; then
    if [[ ! -t 0 ]]; then
      echo 'Run npm run setup:sandbox -- all in your terminal to enter tokens securely.' >&2
      exit 2
    fi
    capture_sandbox_token "$sandbox_profile sandbox ACCESS token" false
    printf '%s' "$starling_sandbox_captured" > "$sandbox_home/access-token"
    unset starling_sandbox_captured
  fi
  chmod 600 "$sandbox_home/access-token"
  if [[ ! -s "$sandbox_home/refresh-token" && -t 0 ]]; then
    if capture_sandbox_token "$sandbox_profile sandbox REFRESH token" true; then
      printf '%s' "$starling_sandbox_captured" > "$sandbox_home/refresh-token"
      chmod 600 "$sandbox_home/refresh-token"
    else
      sandbox_capture_status=$?
      if [[ "$sandbox_capture_status" != 1 ]]; then exit "$sandbox_capture_status"; fi
    fi
    unset starling_sandbox_captured
  fi
done

if [[ -t 0 ]]; then
  IFS= read -r -p 'Sandbox API Key UID after public-key upload (Enter to configure later): ' starling_sandbox_key_uid
  if [[ -n "$starling_sandbox_key_uid" ]]; then
    for sandbox_profile in "${sandbox_profiles[@]}"; do
      STARLING_SANDBOX_KEY_UID="$starling_sandbox_key_uid" node tools/sandbox.mjs key "$sandbox_profile"
    done
  fi
  unset starling_sandbox_key_uid
fi
for sandbox_profile in "${sandbox_profiles[@]}"; do
  node tools/sandbox.mjs check "$sandbox_profile"
done
