# Setup

Requires Node.js 18+. Here `starling-banking` means
`node "<skill-directory>/scripts/starling-banking.mjs"`.

## Start with account access

1. Ask “Help me set up Starling”, then approve initialisation, or run `starling-banking init`.
2. In the [developer portal](https://developer.starlingbank.com), create an account
   token with the non-initiation scopes you want. For basic reads use `account:read`,
   `balance:read` and `transaction:read`; add payee scopes if needed.
3. Privately edit the one generated config, placing the token in `auth.accountToken`.
   Never send its contents to the agent. No token environment variables or separate
   secret files are needed. Leave unused optional fields `null`.
4. Say “Ready, check setup again” or run `doctor`. The diagnostic reads the config
   internally and reports missing setup in plain language without exposing values.

See [configuration](configuration.md) for the file location and every field.

## Optional payments

Create a separate token with `pay-local:create` for the same holder and store it in
`auth.paymentToken`. Keep account/payee/status reads on the account token. Starling
personal tokens cannot combine payee creation and payment initiation scopes.
No payment token is needed if you do not want to send money.

## Optional signed actions

Payment initiation, email/address changes and standing-order cancellation need signing.
For requested setup, run `keys generate` (RSA default, or `--type ecdsa`). It stores
only the private API key in config and displays its public key. Register that public
key with Starling and put the resulting API Key UID in `signing.keyUid`. You can
show the public key again with `keys public`; never read the secret config to share it.
If an existing key only lacks its UID, identify that public key in Starling and fill
the UID; do not generate a replacement key. If the UID exists but its private key
is missing, restore the matching key locally from backup; a new key cannot use the
old UID. If no matching backup exists, follow the deferred-registration guidance below.

If the portal requires a rotation key/upload signature, stop: that workflow is
currently deferred. See [R01](decisions-and-limitations.md#risks-and-present-limitations).
Existing rotation files are not used, overwritten or deleted by these commands.

Run `doctor` again. Its signing check is local; Starling checks registration on a
signed request. For payments also require `capabilities.payments.ready`, then retain
the exact preview and fresh approval. Starling may separately require app approval.

## Sandbox

Use `environment: "sandbox"` with simulator credentials in the same config structure.
Different simulated holders use separate isolated fixture configs during development.
Never copy live credentials into sandbox tests. [Commands](commands.md) and
[troubleshooting](troubleshooting.md) describe supported operations and errors.
