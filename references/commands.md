# Command reference

`starling-banking` = `node <skill folder>/scripts/starling-banking.mjs`

Every command prints JSON: `{"status":"ok","command":…,"data":…}`, `{"status":"needs_confirmation",…}` or `{"status":"error","error":{code,message,hint}}`. `doctor` prints a readable report instead (`doctor --json` for JSON). Unknown options are errors, not ignored. `<command> --help` prints usage.

Most commands use the account that is obvious (the only account, or the only PRIMARY one, or `defaultAccountUid` from config). With several candidates they ask rather than guess; pass `--account <uid or name>`.

## Setup and diagnostics

| Command | What it does |
|---|---|
| `doctor [--json]` | Checks Node, config, token, network, clock, scopes vs. permissions, accounts, signing key, limits. Says how to fix each problem. |
| `init [--force]` | Copies `config.json.example` to the user's config folder as `config.json`. |
| `keys generate [--type rsa\|ecdsa] [--dir <folder>]` | Creates the API and rotation key pairs Starling needs for payments. Prints public keys only. Never overwrites. |
| `permissions` | Lists the permission groups, which are on, and what each allows. |
| `ops [search] [--group <name>] [--detail]` | Searches the API operations the skill knows about. |
| `log [--limit 20]` | What this skill has sent from this computer (local record). |

## Reading (always available)

| Command | Notes |
|---|---|
| `accounts list` | Names, currencies, UIDs. |
| `accounts balance [--account]` | Effective, cleared, pending balances, formatted. |
| `accounts identifiers [--account]` | Sort code, account number, IBAN, BIC. |
| `accounts holder` | Holder type and name. |
| `accounts can-afford <amount> [--account]` | Whether that much is available. |
| `transactions list [--days N \| --from D --to D] [--direction in\|out] [--search text] [--limit N] [--summary] [--full] [--account] [--category]` | Newest first, with totals (declined/reversed excluded). `--summary` adds top categories and counterparties for spending. Dates are UTC; a bare end date includes that whole day. |
| `transactions get <feedItemUid>` | One transaction in full. |
| `transactions export --out <file.csv> [--days N \| --from D --to D] [--force]` | Saves Starling's CSV export. |
| `payees list [--name text] [--reveal]` | `--name` filters and adds `exists`. Account numbers masked unless `--reveal`. |
| `payees get <name\|uid> [--reveal]` | Fails with the candidates if the name is ambiguous. |
| `payees history <name\|uid> [--days 90] [--payee-account uid]` | Payments made to that payee. |
| `payments status <paymentOrderUid>` | Queries order details and associated payments independently. Reports `ACCEPTED`, `PENDING`, `REJECTED`, `NOT_YET_PROCESSED`, `UNRESOLVED` or `UNKNOWN`, with endpoint results in `lookups`. |
| `payments standing-orders [--account]` | Lists standing orders. |
| `cards list` | Cards and which controls are on. |
| `goals list`, `goals get <uid>`, `spaces list` | Savings goals and spaces. |
| `mandates list`, `mandates get <uid>` | Direct debit mandates. |

Anything not listed: `call <operationId> [--param name=value]… [--query name=value]… [--body '<json>' \| --body-file path] [--account …] [--out file] [--force]`. `call` applies the same permissions, limits and confirmations as everything else. Find names with `ops` or `operations.md`.

## Acting (needs the matching permission group)

Run immediately:

| Command | Group |
|---|---|
| `transactions note <uid> <text>`, `transactions note <uid> --clear`, `transactions categorise <uid> <CATEGORY>` | `organise` |
| `cards lock [uid]`, `cards unlock [uid]`, `cards set <atm\|online\|pos\|mobile-wallet\|mag-stripe\|gambling> <on\|off> [--card uid]` | `card-controls` |
| `goals create --name … [--target 100]`, `goals add <uid> --amount 5`, `goals withdraw <uid> --amount 5`, `goals delete <uid>` | `savings` |

Preview first, then `confirm <code>`:

| Command | Group |
|---|---|
| `pay --payee <name\|uid> --amount 25.00 --reference "text" [--payee-account uid] [--account …]` | `payments` |
| `payments cancel-standing-order <paymentOrderUid>` | `payments` |
| `payees add --display-name … --sort-code 123456 --account-number 12345678 [--first-name …] [--middle-name …] [--last-name …] [--type individual\|business] [--business-name …] [--description …]` | `payees` |
| `payees update <payee> [--display-name …] [--first-name …] [--middle-name …] [--last-name …] [--business-name …]` | `payees` |
| `payees add-account <payee> --sort-code … --account-number …` | `payees` |
| `payees rename <payee> --name …`, `payees delete <payee>` | `payees` |
| `mandates cancel <uid>` | `account-settings` |

`confirm <code> [--retry]` carries out a prepared action. `cancel <code>` discards one. Codes expire (10 minutes by default), work once, and are bound to exactly what was previewed: if anything differs, `confirm` refuses.

`--retry` exists only for the case where an earlier attempt's outcome is unknown (`PLAN_UNCERTAIN`). Payments reuse the same `externalIdentifier`, which Starling uses to recognise a repeat, but check first anyway.

## Amounts and references

Amounts are pounds with at most two decimals (`25`, `25.50`, `£25`). The currency is the account's. A GBP payment reference may be at most 18 characters and use letters, digits and basic punctuation (35 for EUR); the tool rejects rather than truncating, because the recipient sees exactly what is sent.
