# Starling Banking Skill

An unofficial skill for your own Starling Bank account: balances, transactions,
payees, payments, cards, savings and CSV exports. It includes agent instructions
and a dependency-free Node.js CLI. Requires Node.js 18+ on the execution host.

Not affiliated with or supported by Starling Bank. Licensed under [MIT-0](LICENSE),
without warranty. You control credentials and authorise bank actions.

## Get started

1. Create a personal access token in the [Starling developer portal](https://developer.starlingbank.com).
2. Supply it privately to the host running the skill, using `STARLING_ACCESS_TOKEN`
   or a protected token file. Never paste tokens or private keys into chat.
3. From the skill folder, run:
   ```sh
   node scripts/starling-banking.mjs doctor --json
   ```
4. Check that it succeeds and shows the intended environment/account, then ask:
   “What's my Starling balance?”

View-only access works without a config file. To customise permissions, run
`node scripts/starling-banking.mjs init` and edit the generated external config.
Skill updates preserve your settings, keys and history.

Follow [setup](references/setup.md) for credential entry and signing keys.
Use [configuration](references/configuration.md) for settings and paths.

## Permissions and approvals

Permissions are independent groups, not numbered tiers. Only `view` is enabled by default.

| Group | Allows | CLI preview and confirmation |
|---|---|---|
| `view` | Accounts, balances, transactions, payees, cards, goals and exports | No |
| `organise` | Notes, categories, receipts, attachments and profile image | No |
| `card-controls` | Card lock and payment controls | No |
| `savings` | Goals, savings transfers and round-up | No; agent must obtain approval before moving money |
| `payees` | Register, edit and delete recipients | Yes |
| `payments` | Pay registered recipients; cancel standing orders | Yes; payments need signing and spending limits |
| `account-settings` | Email/address changes, mandate cancellation and logout | Yes |

The CLI enforces these groups for friendly commands and generic `call` operations,
and rechecks permissions and payment limits at confirmation. Starling separately
enforces token scopes. Enabling a group does not authorise an action or add scopes.
See [permissions](references/permissions.md).

The agent uses only the bundled CLI. For payments, payee changes and account-setting
changes it shows the exact preview, waits for a fresh explicit approval, then submits
once. Optional terminal mode requires the user to type the code themselves. Any
Starling app approval is separate. Uncertain submissions are never automatically resent.

## Limits to understand

- Supplied recipient names are not verified Confirmation of Payee; the API reports no name-match result.
- Submission or HTTP success does not establish completion. Unresolved payment status is reported honestly.
- No standing-order creation/update, background monitoring, automatic token refresh,
  OAuth onboarding for other customers, account opening/closing or other banks.
- One config/token is active per invocation. Live payee creation and payment initiation
  need separate tokens because their scopes cannot be combined.
- Local spending limits cover this computer's recorded submissions. An agent with
  unrestricted shell access can change local files; restricted bank token scopes remain essential.

## Documentation and validation

| Reader / task | Document |
|---|---|
| User: credentials and signing setup | [Setup](references/setup.md) |
| User: settings and runtime paths | [Configuration](references/configuration.md) |
| User: capabilities and token scopes | [Permissions](references/permissions.md) |
| User / agent: command syntax and errors | [Commands](references/commands.md), [troubleshooting](references/troubleshooting.md) |
| Agent: required workflow and approvals | [SKILL.md](SKILL.md) |
| Maintainer: architecture and developer checks | [Architecture](docs/architecture.md) |
| Reviewer: checks performed and their limits | [Validation](docs/validation.md) |

Current validation includes 139 deterministic tests and 17/17 selected lightweight
OpenAI agent smoke checks (low reasoning). Earlier bank validation covered four
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
