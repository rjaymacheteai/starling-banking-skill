# Starling token scopes

Starling enforces API scopes. There are no local permission groups or enabled/disabled
capability switches. Use only the scopes you need; a scope does not authorise an
unrequested action or replace fresh user approval.

## Token roles

- **Required account token:** everything except payment initiation. Include reads
  and the non-initiation writes you want, such as payee registration.
- **Optional payment token:** `pay-local:create` for the same account holder. Used
  only for initiation, plus identity diagnostics. No account-token fallback.

Starling personal tokens cannot combine `payee:create` and payment-initiation scopes.
Both credential sources live in one config; see [configuration](configuration.md).

| Capability | Typical account-token scopes |
|---|---|
| Account/balance/transactions | `account:read`, `balance:read`, `transaction:read` |
| Payee reads and history | `payee:read`, `payee-transaction:read` |
| Payee registration/update/delete | `payee:create`, `payee:edit`, `payee:delete` |
| Payment status / standing-order cancellation | `pay-local:read`, `standing-order:delete` |
| Card reads / controls | `card:read`, `card-control:edit` |
| Savings | `savings-goal:read`, `savings-goal:create`, `savings-goal:delete`, `savings-goal-transfer:create`, `savings-goal-transfer:delete` |
| Notes / receipts / attachments | `transaction:edit`, `receipt:write`, `attachment:write` |
| Email / address / mandate cancellation | `email:edit`, `address:edit`, `mandate:delete` |
| Account identifiers / CSV export | `account-identifier:read`, `feed-export-csv:read` |

This is a quick guide; [operations](operations.md) lists exact per-operation scopes.
An operation needs any one of its listed alternatives. Missing bank scopes produce
`FORBIDDEN`; add scopes only when the user requests that capability. `doctor` reports
actual granted scopes without editing them.

## Controls that remain local

Payments still require positive per-payment/daily limits, an allowed registered
recipient, signing and a fresh exact preview/approval. Payee and sensitive account
changes retain previews and fresh approval. Card/note/savings commands can write
immediately when the bank scope permits them; savings movement still requires the
agent to obtain fresh approval before running the command.

Daily limits count this computer's recorded submissions, including uncertain ones,
not all app/bank activity. The default `agent` confirmation mode relies on the agent
relaying the user's approval; `terminal` requires the user to type the code themselves.
See [setup](setup.md) for credential and key onboarding.
