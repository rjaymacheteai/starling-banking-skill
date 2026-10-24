# Starling Banking Skill

An **unofficial, single Agent Skill** for your own Starling Bank account. It combines
agent instructions with a dependency-free Node.js CLI for balances, transactions,
payees, payments, cards, savings and exports.

**Not affiliated with, endorsed by, or supported by Starling Bank Limited.** Starling
is their trademark. This project is supplied under [MIT-0](LICENSE), without warranty.
You control the credentials and permissions and remain responsible for bank actions.

## Install in OpenClaw

```sh
openclaw skills install git:rjaymacheteai/starling-banking-skill@v0.1.0 --global
openclaw skills info starling-banking
```

Requires Node.js 18 or newer on the host that runs the skill. No `npm install` is
needed for the banking CLI. The repository root is the installable skill; its
frontmatter name is `starling-banking`. The commands above follow OpenClaw's
[Git-install interface](https://docs.openclaw.ai/cli/skills).

For manual installation, put the distributable skill folder in
`~/.openclaw/skills/starling-banking` (or the active workspace's `skills/` directory).
The versioned GitHub release also includes a skill-only archive and SHA-256 checksum.
Claude Code and other Agent Skills hosts can use the same skill files in their
own skill directory. Full OpenClaw agent-runtime behaviour has not been evaluated.

## Set up read-only access

From the installed folder:

```sh
node scripts/starling-banking.mjs init
node scripts/starling-banking.mjs doctor
```

Create a personal access token in Starling's developer portal and supply it locally
through `STARLING_ACCESS_TOKEN` or a protected token file referenced by `auth.tokenFile`.
Never paste tokens/private keys into chat. For OpenClaw, the skill supports its
`skills.entries.starling-banking.apiKey` secret setting. Secrets must be available
to the actual execution host; host environment injection does not automatically put
them in an OpenClaw sandbox. See [setup](references/setup.md).

Configuration defaults to **view only** and lives outside the installed skill,
usually `~/.config/starling-banking/config.json`. Updating the skill preserves your
config, keys and audit history. `config.json.example` documents every setting.

Then ask your agent: “What's my Starling balance?”

## Agent execution and approval contract

[SKILL.md](SKILL.md) is the agent-facing entry point. It requires all banking
operations to use `node <skill-directory>/scripts/starling-banking.mjs`. The agent
must not use raw HTTP, write replacement banking code, guess endpoints, automate
bank-app approvals, or modify scripts/plans/ledgers to bypass a guard.

For payments, payee changes and account-setting changes:

1. Resolve the exact account/recipient and collect missing values without guessing.
2. Run the CLI preparation command; nothing is sent to the bank yet.
3. Read back the returned preview and material details: recipient, amount/currency,
   masked destination, source account and reference, or the exact proposed change.
4. Wait for fresh, explicit user approval of that preview, then confirm its one-time code.
5. Report submission honestly and relay any separate Starling app-approval requirement.

An initial instruction, an old “yes” or permission to check status never approves a
new payment. Changes require a new preview and approval. The default `agent` mode
allows approval in chat; the agent handles the code. Optional `terminal` mode
requires the user to type the code themselves. Starling app approval is a separate
bank control, required for live personal-token payments.

Card controls, organising and savings operations can execute immediately when their
CLI permission is enabled. The skill requires the exact user request; savings money
movement also requires a read-back and fresh approval before the command is run.
That savings approval is an agent instruction, not a CLI confirmation plan.

## Capabilities and permissions

| Group | Capability | CLI confirmation code |
|---|---|---|
| `view` | Accounts, balances, transactions, payees, cards, goals, spaces, mandates, exports | No; always enabled |
| `organise` | Transaction notes/categories, receipts, attachments, profile image | No |
| `card-controls` | Lock/unlock cards and change payment controls | No |
| `savings` | Goals, transfers to/from goals and round-up | No; agent approval before moving money |
| `payees` | Create, update, rename and delete payees | Yes |
| `payments` | Pay registered recipients; cancel standing orders | Yes, plus signing/limits |
| `account-settings` | Address/email changes, mandate cancellation and logout | Yes |

Only `view` is on by default. The user controls groups, per-payment/daily limits,
`allowedPayees`, default account, environment and confirmation mode. Token scopes
are enforced by Starling as well. Live payee-creation and payment-initiation scopes
cannot share one token; select a separate token for each workflow. See
[permissions](references/permissions.md) and [commands](references/commands.md).

`ops <search>` discovers the 87 catalogued operations; `call <operationId>` invokes
supported operations through the same guards. Standing-order creation/update is
explicitly blocked: this skill does not enforce limits on future recurring executions.

## Names, status and retry limits

Display labels are separate from optional recipient first/middle/last or business
name fields. The agent asks for the recipient name by default and accepts an explicit
request to skip it. It never guesses name parts. `--name` is a display-label alias;
`--display-name`, `--first-name`, `--middle-name`, `--last-name`, and `--business-name`
make the distinction explicit. `payees update` changes supplied name fields;
`payees rename` preserves them and the saved bank details.

Name fields do **not** establish a bank name match. The sandbox accepted and stored
both correct and deliberately wrong names during creation. The CLI reports
`bankNameCheck: "not_reported_by_api"` rather than claiming verified Confirmation of Payee.

A successful HTTP response may contain `IN_APP_APPROVAL`; the CLI then reports
`awaiting_bank_approval`. A submitted payment is not necessarily completed.
`payments status` independently queries both order details and payment executions.
`UNRESOLVED` or `UNKNOWN` is insufficient evidence, not an inferred rejection.
In the live tests, unanswered and app-declined requests both produced an unavailable
order and an empty payments list. No public consent-status endpoint was found.

Uncertain writes must not be automatically resent or replaced. Each payment's
identifier is fixed at preview time; reconfirmation does not create another request.
Unknown/submitted attempts conservatively count toward the local daily limit.

## Validation performed in this repository

| Layer | Recorded evidence |
|---|---|
| Deterministic CLI tests | Signing, scopes/permissions, limits, read-backs, confirmation expiry/tampering, replay protection, uncertainty, redaction and setup diagnostics |
| Official Starling sandbox | Two individual, one joint and one business customer; core reads, savings round trips, note restoration, available card controls, signed 1p transfers with recipient-credit verification, cross-customer access denial |
| Live personal account | 13 read checks; payee registration/read-back; approved 1p payment with `ACCEPTED` and one settled debit; repeated-code protection; unapproved/declined consent observations |
| Light agent smoke eval | Separately recorded in [agent eval validation](docs/agent-eval-validation.md); no full matrix is implied |

Detailed evidence and limits: [sandbox validation](docs/sandbox-validation.md),
[live validation](docs/live-validation.md), and [release validation](docs/validation.md).
Raw transcripts, account data, tokens, keys and consent references stay in ignored
local folders. These checks do not validate every catalogue operation or all models.

## Developer checks

```sh
npm test
npm run eval:list
npm run eval
```

`npm test` uses a fake bank and no paid model. `npm run eval` is billed: its default
is just four core cases, one Haiku pass, low effort, concurrency 1, and a small
per-turn budget. Larger suites/models/passes are explicit opt-ins. Model evals
never run in CI. See [eval instructions](tools/eval/README.md).

`npm run test:live` is an explicitly requested read-only bank check. Developer live
write helpers require local configs and interactive approval; they are not the
installed agent's banking interface. `npm run setup:sandbox -- all --clipboard`
sets up four separate simulator customers on macOS; `npm run test:sandbox` uses
only the sandbox with disposable resources. Reports are saved locally.

`node tools/build-catalogue.mjs` refreshes interface metadata from Starling's public
specification. `npm run pack:skill` builds the skill-only archive from committed files.

## Scope and limits

This skill does not provide other banks, account opening/closing, production OAuth
onboarding for other customers, automatic token refresh, a webhook receiver,
background monitoring, the separate Payment Services API, or standing-order creation/update.
One config/token is active per invocation; multiple accounts for that holder can be
selected explicitly. Separate holders/tokens need separate configs or `STARLING_BANKING_HOME`.
The sandbox customer helpers are developer fixtures, not an installed profile manager.

The current catalogue has no routes for `statement-pdf:read`, `statement-csv:read`
or `account-holder-state-transition:read`; transaction CSV uses `feed-export-csv:read`.
Friendly payee creation supports UK sort code/account number. Other catalogue
capabilities and currencies are not implied to have been tested. Production joint
and business account behaviour remains unvalidated.

The CLI cannot prove a human said yes in `agent` mode. An agent with unrestricted
shell access can disobey its instructions or alter its config; read-only bank scopes
and separate restricted tokens are essential boundaries. Limits cover only this
computer's recorded submissions, not every account payment. See
[security policy](SECURITY.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

## License and responsibility

[MIT No Attribution (MIT-0)](LICENSE). Starling has not reviewed or approved this
software. It handles real money when enabled, is supplied “as is,” and has no
warranty. Keep credentials private, use low limits, and comply with Starling's
[developer terms](https://developer.starlingbank.com).
