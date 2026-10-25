# Configuration

Run `node "<skill-directory>/scripts/starling-banking.mjs" init` to create the config.
Edit that external file, not the bundled example. JSON comments are supported.
Run `doctor --json` after changes; require exit code 0 and `data.ok: true`, and review warnings.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `environment` | `"live"` | `live` for real banking; `sandbox` for simulated accounts. Token must match. |
| `auth.account.tokenEnv` | `"STARLING_ACCESS_TOKEN"` | Required account token for all non-initiation operations, including reads and payees. |
| `auth.account.tokenFile` | `null` | Token file path. When set, takes precedence over `tokenEnv`. Protect with mode 600. |
| `auth.payments.tokenEnv` | `"STARLING_PAYMENT_ACCESS_TOKEN"` | Optional token for payment initiation and identity verification only. |
| `auth.payments.tokenFile` | `null` | Optional payment-token file; takes precedence over its environment variable. Protect with mode 600. |
| `signing.keyUid` | `null` | Registered API public key UID (not the client ID). Optional overall; required for signed actions. |
| `signing.keyFile` | `null` | API private signing key path; protect with mode 600. Rotation private key is not used here. |
| `signing.algorithm` | `"auto"` | Normally leave unchanged. Also accepts `rsa-sha256`, `rsa-sha512`, `ecdsa-sha256`, `ecdsa-sha512`. |
| `defaultAccountUid` | `null` | Account UID from `accounts list`. Otherwise commands resolve an unambiguous account or ask. |
| `limits.currency` | `"GBP"` | Three-letter currency covered by payment limits. |
| `limits.perPayment` | `null` | Positive maximum per payment in major currency units (e.g. 25 means £25 for GBP). |
| `limits.perDay` | `null` | Positive daily maximum; both limits are required for payments. Counts local recorded submissions, including uncertain ones, by local calendar day. |
| `allowedPayees` | `[]` | Allowed payee names or UIDs; empty permits any registered payee. |
| `confirmation.mode` | `"agent"` | `agent`: fresh chat approval relayed by the agent. `terminal`: user types the code in their terminal. |
| `confirmation.expiresMinutes` | `10` | Preview lifetime, an integer from 1 to 60. |

Starling token scopes determine available capabilities. Only change limits,
credential sources, environment or approval mode at the user's explicit request.

## Runtime paths and environment

| Variable | Purpose |
|---|---|
| `STARLING_ACCESS_TOKEN` | Default token source, unless a token file or another `auth.account.tokenEnv` is configured. |
| `STARLING_PAYMENT_ACCESS_TOKEN` | Optional payment initiation token; never substitutes for the account token. |
| `STARLING_BANKING_HOME` | Runtime directory for config and local state. |
| `STARLING_BANKING_CONFIG` | Explicit config file path; overrides the default config path only, not the state directory. |
| `XDG_CONFIG_HOME` | Unix config root when `STARLING_BANKING_HOME` is unset. |

Default runtime directory: `~/.config/starling-banking` on Unix,
`%APPDATA%\starling-banking` on Windows. Config is `config.json`; plans and audit
history are under `state/`. Key generation defaults to `keys/` in the runtime directory.
An account token alone works without a config file, subject to its bank-granted scopes.

Environment variables locate credentials and files; scopes are managed in Starling. Config is validated on each command, and tokens are loaded when
needed. Only `makeLocalPayment` uses the payment slot; reads/status/cancellations
use the account slot. Both identities must match before initiation. Use the same environment/config selection for `doctor` and later commands.
The CLI constructs authentication and signing headers internally. Never put token
values or private-key contents in config, command arguments or chat.

## Upgrade from 0.1.x

Legacy `auth.tokenEnv` / `auth.tokenFile` still select the account token. Do not mix
those aliases with `auth.account` in the same config. Add `auth.payments` or set
`STARLING_PAYMENT_ACCESS_TOKEN` to enable initiation; an old single payment token
is not reused automatically. Remove the obsolete `permissions` field from old configs after reviewing their bank scopes;
`doctor` reports an actionable config error until this explicit migration is complete. For an old
payment-only config, move its payment credential source to the new payment slot and
supply the wider account token in the account slot. Runtime data is not moved or overwritten.

`doctor --json` exposes `capabilities.account.ready` and `capabilities.payments.ready`.
Overall `data.ok` can be true while optional payments are unavailable. Signing or
payment limits missing when a payment token is supplied produce warnings and disable
payment readiness; account operations remain usable. Signed account changes still require a key when invoked.
