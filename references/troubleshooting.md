# Troubleshooting: error codes

Errors print as `{"status":"error","error":{"code","message","hint","details?"}}`. The `hint` is usually the next step. Exit codes: 0 success, 1 error, 2 usage error, 70 internal bug.

## Setup

| Code | Meaning and fix |
|---|---|
| `NODE_TOO_OLD` | Node.js older than 18. Install the current LTS from nodejs.org. |
| `NO_TOKEN` | Required account token missing. Fill `auth.accountToken` in local config.json. The payment token is optional and cannot replace it. See [setup](setup.md). |
| `NO_PAYMENT_TOKEN` | Account access can still work. To initiate payments, fill `auth.paymentToken` in local config.json; no fallback is used. |
| `PAYMENT_AUTH_FAILED` | Starling rejected the optional payment token; replace that slot locally and rerun `doctor`. |
| `PAYMENT_TOKEN_MISMATCH`, `PAYMENT_IDENTITY_UNVERIFIED` | Payment and account holder identities differ or cannot be verified. Correct the payment slot; no payment was initiated. |
| `PAYMENT_SCOPE_MISSING` | Optional payment token lacks `pay-local:create`. Replace it with a correctly scoped token. |
| `AUTH_FAILED` | Starling rejected the token: revoked, mistyped, or a sandbox token used on live (or the reverse). Create a new token. |
| `CONFIG_INVALID` | `config.json` has a syntax error, bad value or unsupported old setting; the message lists each problem. Compare with `config.json.example`. |
| `FORBIDDEN` | The token lacks a scope the operation needs. The hint lists them. |
| `NETWORK_ERROR` | Couldn't reach Starling. For writes, the request might still have been received: check before retrying. |
| `RATE_LIMITED` | Personal tokens: 5 requests/second, 1,000/day. Wait and make fewer calls. |

## Signing (payments, email/address changes, standing-order cancellation)

| Code | Meaning and fix |
|---|---|
| `SIGNING_NOT_CONFIGURED` | `signing.keyUid` or `signing.privateKey` missing. Run `keys generate`, upload the public key, set both. |
| `SIGNING_KEY_INVALID` | Embedded private key invalid, encrypted, wrong type, or not RSA 2048/4096 or ECDSA P-256. |
| `SIGNATURE_REJECTED` | Starling refused the signature: wrong Key Uid, the uploaded public key doesn't pair with the private key, or the computer's clock is more than 5 seconds off. Run `doctor`. |

## Payments and confirmations

| Code | Meaning and fix |
|---|---|
| `CURRENCY_MISMATCH` | Source account currency differs from the payment. |
| `BAD_AMOUNT`, `BAD_REFERENCE`, `REFERENCE_TOO_LONG` | Invalid amount or reference (GBP: 18 characters). |
| `PAYEE_NOT_FOUND`, `AMBIGUOUS_PAYEE`, `AMBIGUOUS_PAYEE_ACCOUNT`, `PAYEE_HAS_NO_BANK_ACCOUNT` | Can't pick exactly one recipient; the details list the candidates. Ask the user. |
| `RECIPIENT_NOT_REGISTERED` | Payments to arbitrary account details are not allowed; register the payee first. |
| `PLAN_NOT_FOUND`, `PLAN_EXPIRED`, `BAD_CODE` | Unknown, expired or malformed confirmation code. Prepare the action again. |
| `PLAN_TAMPERED` | The saved action was altered after the preview; it was discarded. |
| `PLAN_FAILED` | The earlier attempt was refused (nothing sent). Prepare again if still wanted. |
| `UNSUPPORTED_OPERATION` | This skill does not support that workflow (including standing-order creation/update). Use the supported commands or the Starling app; do not bypass the guard. |
| `PLAN_UNCERTAIN` | An earlier attempt may or may not have gone through. Check `payments status` or `transactions list --days 2`. Only if it clearly didn't, `confirm <code> --retry`. |
| `ENVIRONMENT_CHANGED` | Config switched between live and sandbox after the preview. |
| `TERMINAL_APPROVAL_REQUIRED` | Config requires typing the code at a terminal. The user runs the `confirm` command themselves. |

## Accounts and data

| Code | Meaning and fix |
|---|---|
| `AMBIGUOUS_ACCOUNT`, `ACCOUNT_NOT_FOUND`, `NO_ACCOUNTS` | Pass `--account`, or set `defaultAccountUid`. `NO_ACCOUNTS` usually means a missing `account:read` scope. |
| `MISSING_PARAM`, `BAD_PARAM`, `MISSING_BODY`, `BAD_BODY` | `call` is missing something or was given something invalid. |
| `UNKNOWN_OPERATION` | Not an operation name; use `ops <search>`. |
| `FILE_EXISTS` | Output file exists; choose another `--out` or add `--force`. |
| `API_REJECTED`, `BAD_REQUEST` | Starling understood but refused; the message says why. |
| `NOT_FOUND` | A UID doesn't exist for this token's account. |
| `SERVER_ERROR` | Starling had a problem. Reads are retried automatically; for writes check before retrying. |
