# Configuration

Run `node "<skill-directory>/scripts/starling-banking.mjs" init` to create the config.
Edit that external file, not the bundled example. JSON comments are supported.
Run `doctor --json` after changes; require exit code 0 and `data.ok: true`, and review warnings.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `environment` | `"live"` | `live` for real banking; `sandbox` for simulated accounts. Token must match. |
| `permissions` | `["view"]` | Independent capability groups; see [permissions](permissions.md). `view` is always enabled. |
| `auth.tokenEnv` | `"STARLING_ACCESS_TOKEN"` | Environment variable containing the token. |
| `auth.tokenFile` | `null` | Token file path. When set, takes precedence over `tokenEnv`. Protect with mode 600. |
| `signing.keyUid` | `null` | API public key's UID from Starling, not the application client ID. |
| `signing.keyFile` | `null` | Private signing key file path; protect with mode 600. |
| `signing.algorithm` | `"auto"` | Normally leave unchanged. Also accepts `rsa-sha256`, `rsa-sha512`, `ecdsa-sha256`, `ecdsa-sha512`. |
| `defaultAccountUid` | `null` | Account UID from `accounts list`. Otherwise commands resolve an unambiguous account or ask. |
| `limits.currency` | `"GBP"` | Three-letter currency covered by payment limits. |
| `limits.perPayment` | `null` | Positive maximum per payment in major currency units (e.g. 25 means £25 for GBP). |
| `limits.perDay` | `null` | Positive daily maximum; both limits are required for payments. Counts local recorded submissions, including uncertain ones, by local calendar day. |
| `allowedPayees` | `[]` | Allowed payee names or UIDs; empty permits any registered payee. |
| `confirmation.mode` | `"agent"` | `agent`: fresh chat approval relayed by the agent. `terminal`: user types the code in their terminal. |
| `confirmation.expiresMinutes` | `10` | Preview lifetime, an integer from 1 to 60. |

Start with view only. For notes and card controls, for example:

```json
"permissions": ["view", "organise", "card-controls"]
```

Groups are not numbered tiers or cumulative levels. Adding `payments` does not add
`payees`, and enabling a group does not grant bank token scopes or user approval.
Only change permissions, limits or credential sources at the user's explicit request.

## Runtime paths and environment

| Variable | Purpose |
|---|---|
| `STARLING_ACCESS_TOKEN` | Default token source, unless a token file or another `auth.tokenEnv` is configured. |
| `STARLING_BANKING_HOME` | Runtime directory for config and local state. |
| `STARLING_BANKING_CONFIG` | Explicit config file path; overrides the default config path only, not the state directory. |
| `XDG_CONFIG_HOME` | Unix config root when `STARLING_BANKING_HOME` is unset. |

Default runtime directory: `~/.config/starling-banking` on Unix,
`%APPDATA%\starling-banking` on Windows. Config is `config.json`; plans and audit
history are under `state/`. Key generation defaults to `keys/` in the runtime directory.
A token alone works with view-only defaults when no config file exists.

Environment variables locate credentials and files; they do not independently enable
permission groups. Config is validated on each command, and tokens are loaded when
needed. Use the same environment/config selection for `doctor` and later commands.
The CLI constructs authentication and signing headers internally. Never put token
values or private-key contents in config, command arguments or chat.
