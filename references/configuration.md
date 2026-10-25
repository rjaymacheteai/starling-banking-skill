# One local config.json

`init` creates the private file outside the skill directory. `//` comments are supported;
the example marks required and optional credential/ID fields. It never overwrites an
existing file. Tokens and the API private key are stored directly in this file;
credential environment variables, token files and key-file paths are not supported.

| Field | Default | Meaning |
|---|---|---|
| `environment` | `"live"` | `live` or `sandbox`; all credentials must match. |
| `auth.accountToken` | `null` | Required account access token for all non-initiation operations. |
| `auth.paymentToken` | `null` | Optional payment-initiation token for the same holder. |
| `signing.keyUid` | `null` | Registered public API Key UID; required in signed requests' `keyid`. |
| `signing.privateKey` | `null` | API private PEM key. `keys generate` fills it without printing it. |
| `signing.algorithm` | `"auto"` | Normally leave unchanged; selects the algorithm matching the key. |
| `defaultAccountUid` | `null` | Optional account UID; otherwise resolve an unambiguous account or ask. |
| `confirmation.mode` | `"agent"` | `agent`: fresh chat approval; `terminal`: user types the code. |
| `confirmation.expiresMinutes` | `10` | Preview lifetime, integer 1–60. |

A PEM key is a JSON string with escaped newlines. Prefer `keys generate` so users
need not format it manually. `keys public` derives only its public key, even before
its UID is assigned. The public key is registered at Starling; it need not be stored
separately. The UID identifies that registered key, not an application/client/account.

There are no local scope switches, spending limits or recipient allowlists. Token
scopes are managed at Starling. [Decisions and limitations](decisions-and-limitations.md)
record the consequences and deferred workflows.

## Location and permissions

Default: `~/.config/starling-banking/config.json` on Unix; `%APPDATA%\starling-banking\config.json`
on Windows. On Unix, `init` and key generation write mode 600 and create new parent
directories with mode 700; existing parent permissions are not reset. `doctor` warns
about insecure config-file modes. On Windows, restrict access using account/file ACLs. Keep backups private and never paste the file into chat.
Plans/audit history are separate runtime state under `state/`, not additional config.

For isolated development/alternate locations, `STARLING_BANKING_HOME` changes the runtime
directory and `STARLING_BANKING_CONFIG` changes this one file's path. Neither supplies
credentials. `XDG_CONFIG_HOME` changes the Unix config root.

## Existing installations

The old `auth.account`/`auth.payments` source objects, `tokenEnv`/`tokenFile`,
`signing.keyFile`, `permissions`, `limits` and `allowedPayees` are rejected with
migration guidance. Move credential values into the new fields **locally**, retain
any existing private API key and its UID, then run `doctor`. Do not overwrite a
working key, paste the old config into chat or expect environment tokens to substitute.

`doctor --json` reports `capabilities.account.ready` and `capabilities.payments.ready`.
Overall `data.ok` can be true without optional payment/signing setup; check the
specific capability before sending money. Account changes requiring signing still
check the key when invoked.
