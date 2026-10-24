# Permission groups and token scopes

Two separate things limit what can happen, and both must allow an action:

1. **The token's scopes**, chosen in the Starling developer portal. Starling enforces these. A missing scope blocks its corresponding operation; savings-transfer scopes can also move money.
2. **The permission groups** in the user's `config.json`. The skill enforces these. The CLI checks these on each operation and again at confirmation, including generic `call` operations.

Create the token with only the scopes you need. Create a separate, more powerful token only when you actually want the agent to act.

## Groups

These are independent capabilities, not numbered or cumulative tiers. Environment
variables select config and credential sources; they do not grant permission groups.
A disabled group fails with `PERMISSION_DISABLED`. A missing bank scope fails with
`FORBIDDEN`. `doctor` reports scope gaps but does not add permissions or scopes.

| Group | Default | Allows | Confirmation | Typical scopes |
|---|---|---|---|---|
| `view` | always on | Reading everything | none | `account:read`, `balance:read`, `transaction:read`, `payee:read`, `card:read`, `savings-goal:read`, `mandate:read`, `account-identifier:read`, `confirmation-of-funds:read`, `feed-export-csv:read`, `customer:read`, `account-holder-name:read`, `pay-local:read`, `payee-transaction:read`, `space:read` |
| `organise` | off | Transaction notes and categories, receipts, attachments, profile image | none | `transaction:edit`, `receipt:write`, `attachment:write`, `profile-image:edit` |
| `card-controls` | off | Lock/unlock; ATM, online, contactless, gambling, mobile wallet, magstripe | none | `card-control:edit` |
| `savings` | off | Create/edit/delete goals, move money to/from goals, round-up, recurring transfers | none in CLI; agent approval before money movement | `savings-goal:create`, `savings-goal:delete`, `savings-goal-transfer:create`, `savings-goal-transfer:delete` |
| `payees` | off | Add, rename, delete payees and payee accounts | **preview + confirm** | `payee:create`, `payee:edit`, `payee:delete` |
| `payments` | off | Pay existing payees; cancel standing orders | **preview + confirm**, spending limits, signing key | `pay-local:create`, `standing-order:delete` |
| `account-settings` | off | Email, address, cancel direct debits, log out | **preview + confirm**, signing key (email/address) | `email:edit`, `address:edit`, `mandate:delete` |

`view` is on even if the user leaves it out of `permissions`, because every other group needs to look up accounts and payees.

Standing-order creation/update is blocked by this skill because future recurring executions are not covered by its payment limits. The separate Payment Services workflow is outside scope.

The exact scopes for every operation are in [operations](operations.md). An operation needs any **one** of its listed scopes.

## Why adding a payee is its own group

A new payee is how money reaches someone it never reached before. Keeping `payees` separate from `payments` means a user can allow "pay people I've already set up" without allowing "add new people", which is the safer arrangement for most.

## Spending limits and allowlist

With `payments` on, the config must set `limits.perPayment` and `limits.perDay` (pounds), or payments are refused. The daily total counts payments made through this skill on this computer today (local time); it does not see payments made in the Starling app. `allowedPayees` (names or UIDs) restricts payments to those people only.

## What cannot be guaranteed

In the default `confirmation.mode: "agent"`, the agent relays the user's approval from chat. The tool cannot prove a human said yes; it makes the agent show the exact action and requires a fresh code per action. For a stricter setup, `"terminal"` requires the user to type the code themselves, which isn't possible from chat-only apps. Either way the token's scopes are the real limit.

Settings and credential precedence: [configuration](configuration.md). Setup steps: [setup](setup.md).
