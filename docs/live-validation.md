# Live personal-account validation — 24 October 2026

This was a controlled test against Starling's production Public API using the
account holder's personal access tokens. No model evals were run.

## Verified

- All 13 live read checks passed, including authentication, accounts, balance,
  identifiers, holder data, confirmation of funds, transactions, payees, cards,
  savings goals, spaces, mandates and CSV export.
- A payee was registered, and a subsequent bank read confirmed its bank details
  matched the locally supplied, approved recipient details.
- A signed **GBP 0.01** payment was submitted to that existing payee and approved
  by the account holder in the Starling app.
- Starling's payment status returned `ACCEPTED` with description `ACCEPTED`.
- The payment order's amount, currency, reference and destination payee-account
  UID matched the approved request.
- Exactly one matching outgoing transaction was visible with status `SETTLED`.
- Reconfirming the completed code returned `alreadyExecuted: true`; the number
  of matching outgoing transactions remained one. This check used a view-only
  configuration, so a new payment attempt would have been permission-blocked.

The local live test configuration restricted the recipient to the registered
test payee and capped both a single payment and daily spending at GBP 0.01.

## Limits

This validates the core personal-account flow through signed submission, bank
app approval and the settled outgoing transaction. The recipient account was not
queried directly, so receipt there still requires the account holder's check.

It does not validate every operation, production joint/business accounts, or
automatic bank name matching. The earlier live name update returned an in-app
approval request and had not been observed applied. The API did not expose a
Confirmation of Payee match result for that test.

The original submission response can contain `awaiting_bank_approval`; it is a
record of the response at submission time. Later payment status and transaction
reads establish the result after app approval. There is no background polling.

## Unapproved and declined requests

Two further, separately identified 1p requests tested app authorisation. The local
daily test cap was raised to 3p to include the first settled penny and both new
requests; the per-payment cap stayed at 1p and the recipient remained pinned.

Before approval of the second request, the payment-order endpoint returned 404,
there was no matching outgoing transaction, and the source balance was unchanged.
The account holder could no longer find that approval request, so its eventual
bank-side disposition was not established and it was not retried.

The account holder explicitly declined the third request in the app. Its
payment-order endpoint also returned 404, with no matching outgoing transaction
and no balance change. This confirms that the observed endpoint cannot distinguish
an unanswered app consent from an app-declined consent in these tests. The decline
is user-confirmed; the API did not return a `REJECTED` payment status.

The initial check stopped at the order's 404. A subsequent audit queried both
documented status endpoints independently:

| Test request | Order details | Associated payments |
|---|---|---|
| Approved | HTTP 200 | HTTP 200, one `ACCEPTED` payment |
| Left unapproved | HTTP 404 | HTTP 200, empty list |
| Declined in app | HTTP 404 | HTTP 200, empty list |

Payee payment history also exposed one payment record. The current public OpenAPI
definition lists 87 operations and includes a `ConsentInformation` response schema,
but no separate consent-status operation was found. That does not rule out an
undocumented or other-product API; Starling would need to confirm whether one is
available for personal access tokens.

The CLI now queries order details and executions independently, preserves their
individual outcomes in `lookups`, and uses `UNRESOLVED` for an unavailable order
plus an empty execution list. It uses `UNKNOWN` if execution status cannot be
established. These are CLI descriptions of insufficient evidence, not bank-reported
approval decisions. A new request always uses its own preview/code; rerunning an
existing test does not initiate another payment.

Detailed verification, request plans, credentials and consent references remain
under `.local/`, excluded from Git. No account details, tokens, private keys or
consent identifiers are included here.
