# Starling Banking Skill

An unofficial skill for your own Starling Bank account: balances, transactions,
payees, payments, cards, savings and CSV exports. It includes agent instructions
and a dependency-free Node.js CLI. Requires Node.js 18+ on the execution host.

Not affiliated with or supported by Starling Bank. Licensed under [MIT-0](LICENSE),
without warranty. You control credentials and authorise bank actions.

## Get started

1. Create your account access token in the [Starling developer portal](https://developer.starlingbank.com).
2. Supply it privately to the host running the skill, using `STARLING_ACCESS_TOKEN`
   or a protected token file. Never paste tokens or private keys into chat.
3. From the skill folder, run:
   ```sh
   node scripts/starling-banking.mjs doctor --json
   ```
4. Check that it succeeds and shows the intended environment/account, then ask:
   “What's my Starling balance?”

Account access works without a config file, subject to token scopes. To customise settings, run
`node scripts/starling-banking.mjs init` and edit the generated external config.
Skill updates preserve your settings, keys and history.

Follow [setup](references/setup.md) for credential entry and signing keys.
Use [configuration](references/configuration.md) for settings and paths.

## Two access tokens, one config

**This repository assumes `STARLING_ACCESS_TOKEN` is the required, wider-scoped
account token for everything except payment initiation.** Give it the scopes for
all non-initiation capabilities you want, including payee creation if needed;
exclude `pay-local:create` and `standing-order:create`. Wider access does not
mean you must grant every available scope. There are no local permission switches; Starling enforces the token scopes.

`STARLING_PAYMENT_ACCESS_TOKEN` is **optional**: add a separate token with
`pay-local:create` only when you want to send payments. The CLI uses it solely for
payment initiation, plus read-only credential verification. Reads, payees, payment
status and standing-order cancellation use the account token. Both tokens must
belong to the same account holder; missing/rejected tokens never substitute for each other.

```json
"auth": {
  "account": { "tokenEnv": "STARLING_ACCESS_TOKEN", "tokenFile": null },
  "payments": { "tokenEnv": "STARLING_PAYMENT_ACCESS_TOKEN", "tokenFile": null }
}
```

`doctor` explains missing required account setup and optional payment readiness
separately. No payment token? Account access still works. Sending payments also
requires signing keys, limits and fresh user approval.

## Capabilities and approvals

Starling token scopes are the authority for available operations; no scopes or
permission groups are configured locally. A scope allows an API operation, not an
autonomous action. The agent acts only on the user's exact request.

| Capability | Credential | Approval |
|---|---|---|
| Account/transaction reads, exports, payment status | Account token | Requested read |
| Notes, categories and card controls | Account token | Exact requested change |
| Savings goals/transfers | Account token | Fresh read-back/approval before moving money |
| Payee creation/update/delete | Account token | CLI preview + fresh approval |
| Payment initiation | Optional payment token | CLI preview + fresh approval, signing and limits |
| Signed account changes / standing-order cancellation | Account token | CLI preview + fresh approval; signing where required |

See [bank scopes](references/scopes.md) for the relevant token scopes and
[configuration](references/configuration.md) for limits and credential sources.

The agent uses only the bundled CLI. For payments, payee changes and account-setting
changes it shows the exact preview, waits for a fresh explicit approval, then submits
once. Optional terminal mode requires the user to type the code themselves. Any
Starling app approval is separate. Uncertain submissions are never automatically resent.

## Limits to understand

- Supplied recipient names are not verified Confirmation of Payee; the API reports no name-match result.
- Submission or HTTP success does not establish completion. Unresolved payment status is reported honestly.
- No standing-order creation/update, background monitoring, automatic token refresh,
  OAuth onboarding for other customers, account opening/closing or other banks.
- One config holds both token sources; operation routing is automatic. Existing
  `auth.tokenEnv` / `auth.tokenFile` settings remain account-token aliases. On upgrade,
  payments require the new optional payment slot; there is no legacy fallback.
  Remove old `permissions` config fields after reviewing bank scopes; `doctor` explains this migration.
- Local spending limits cover this computer's recorded submissions. An agent with
  unrestricted shell access can change local files; restricted bank token scopes remain essential.

## Documentation and validation

| Reader / task | Document |
|---|---|
| User: credentials and signing setup | [Setup](references/setup.md) |
| User: settings and runtime paths | [Configuration](references/configuration.md) |
| User: capabilities and token scopes | [Bank scopes](references/scopes.md) |
| User / agent: command syntax and errors | [Commands](references/commands.md), [troubleshooting](references/troubleshooting.md) |
| Agent: required workflow and approvals | [SKILL.md](SKILL.md) |
| Maintainer: architecture and developer checks | [Architecture](docs/architecture.md) |
| Reviewer: checks performed and their limits | [Validation](docs/validation.md) |

Current validation includes 151 deterministic tests and 5/5 focused lightweight
OpenAI agent smoke checks (low reasoning), including all four token combinations. Earlier bank validation covered four
sandbox customers and a live app-approved 1p payment with one settled debit. Not every catalogue
operation or agent host has been validated. See the evidence linked above.

Security reports: [SECURITY.md](SECURITY.md). Attribution: [third-party notices](THIRD_PARTY_NOTICES.md).

## Installation

For Codex, Claude Code, OpenClaw or another Agent Skills host, add this repository
through the host's skill installation flow, or place the extracted skill release
in its configured skills directory. The repository root is the skill; its name is
`starling-banking`. [Releases](https://github.com/rjaymacheteai/starling-banking-skill/releases)
include a custom skill-only archive and checksum; use that asset for a minimal
manual install. Git installs and GitHub’s automatic source archives may include
the full tagged repository. No npm dependencies are required.
Credentials must be available to the actual execution environment, including any cloud or sandbox host.
