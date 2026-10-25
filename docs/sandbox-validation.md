# Sandbox validation — 24 October 2026

Historical evidence from the implementation tested on this date, not current setup
instructions. Permission switches, caps, token/key files and helper behaviour described
below may have since changed. Use [current setup](../references/setup.md) and the
[decision log](../references/decisions-and-limitations.md) for today's behaviour.


These checks used Starling's actual Public API sandbox, with two individual
customers, one joint customer and one business customer. No model evals were run.
The results concern API/CLI behaviour, not whether an agent follows the skill.

## Verified workflows

| Workflow | Individual 1 | Individual 2 | Joint | Business |
|---|---|---|---|---|
| Accounts, holder type, identifiers, balances and confirmation of funds | Pass | Pass | Pass | Pass |
| Transaction queries, totals and CSV export | Pass | Pass | Pass | Pass |
| Cards/goals/spaces/mandates/standing-order list requests | Pass | Pass | Pass | Pass |
| Savings goal create, fund, withdraw and delete | Pass | Pass | Pass | Pass |
| Reject withdrawal from an empty savings goal | Pass | Pass | Pass | Pass |
| Transaction note write, read back, clear and restore | Pass | Pass | Pass | Pass |
| Card lock/unlock and restore | Pass | No card available | No card available | Pass |
| Payee preview/cancel, creation, masked read and duplicate-confirm protection | Pass | Pass | Pass | Pass |
| Disabled payments, unknown payees, amount limits and overlong references | Pass | Pass | Pass | Pass |
| Signed 1p payment and repeat-confirm protection | Pass | Pass | Pass | Pass |
| Matching incoming 1p transfer and recipient balance increase | Pass | Pass | Pass | Pass |
| Bank rejects another customer's token for balance access | HTTP 403 | HTTP 403 | HTTP 403 | HTTP 403 |

The four payments formed a ring between the simulated customers. A successful
initiation alone did not satisfy the recipient-credit check.
Three account balances returned to their initial values. The first individual
account also received a separate £10 inbound simulator payment during the run;
that credit fully explains its balance difference. It was left untouched.

## Recipient names and bank approval

A controlled payee-creation comparison used one customer's token to register
another simulated customer's bank account. One request used the recipient's
first/last name read from the sandbox identity endpoint; another deliberately
used incorrect names. Both returned HTTP 200, and reading each payee back confirmed
that its supplied name fields had been stored. Both comparison payees were deleted.

This demonstrates that the tested sandbox creation workflow does not reject a
name mismatch. It does not establish production Confirmation of Payee behaviour.
The public schema exposes name fields but no documented name-match result, so the
CLI reports `bankNameCheck: "not_reported_by_api"` rather than claiming verification.

Name **updates** on existing payees behaved differently: all four returned
`IN_APP_APPROVAL` and a consent UID. The proposed names were not applied on the
subsequent read. Their update/rename completion remains unverified. The CLI now
reports `actionState: "awaiting_bank_approval"`; repeating a local confirmation
does not submit another request. These four disposable payees are retained because
their bank approvals remain unresolved.

The developer portal's **Simulate OAuth** flow approves application access. Its
authorisation ID is not a payee-update consent UID. No supported way to complete
these payee-update consents was established during this run.

## Defects found and fixed

- CSV export sent timestamps where the endpoint requires calendar dates.
- Name-only payee updates omitted the accounts array required by the live API.
  Updates now preserve all supported saved account details.
- The local helper tried to cancel plans that the CLI had already marked failed.
  Recovery now uses the CLI's authoritative plan state and blocks uncertain writes.
- HTTP 200 consent responses were not distinguished from completed changes.
- Empty transaction notes could not be restored through the friendly command.
  `transactions note <uid> --clear` now supports explicit removal.

Targeted regression tests cover these defects. The deterministic suite at that stage had
123 passing tests; current release checks are in [validation](validation.md). The first sandbox pass's four note-restoration failures were
retained in its report; after the fix, all four real sandbox note round trips
passed, and the temporary notes from the first pass were cleared.

## Limits and artifacts

- This pass covers common workflows, not every operation in the 87-operation catalogue.
- Profile/address changes, attachments/receipts, direct-debit cancellation and
  standing-order creation were not comprehensively exercised.
- Sandbox OAuth tokens had broader combined scopes than a live personal token can
  hold. Live payee creation and payment initiation require separate tokens.
- Refresh tokens are stored locally; automatic OAuth refresh is not implemented.
- Bank approvals and production name matching still need separate validation.

Machine-readable reports, sandbox fixtures and consent references are kept under
`.local/sandbox/`, excluded from Git. Signing keys and tokens remain there too and
are never included in this report.
