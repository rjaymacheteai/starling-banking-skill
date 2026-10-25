# Setup

Requires Node.js 18+. In this guide, `starling-banking` means
`node "<skill-directory>/scripts/starling-banking.mjs"`. No npm install is needed.

## First use with an agent

Ask “Check my Starling setup.” The agent runs `doctor`, explains any missing setup
in plain language, and guides one step at a time. Ask it to initialise config or
generate signing keys when you need those; it should not overwrite existing files.
Once you supply credentials locally, say “Ready, check again.” No payment is needed
to check setup. The two signing pairs are API + rotation/recovery; separate
payee/payment tokens are a separate scope requirement.

## Read-only access

1. Link your account on the [Starling developer portal](https://developer.starlingbank.com)
   and create a personal access token. This is the required account token for everything except payment initiation.
   Select the non-initiation scopes you need; see [bank scopes](scopes.md). `account:read`, `balance:read` and
   `transaction:read` cover basic account/balance/transaction reads.
2. Supply the token locally, never in chat. For a temporary Bash/Zsh session:
   ```sh
   printf 'Starling access token: '
   IFS= read -r -s STARLING_ACCESS_TOKEN
   printf '\n'
   export STARLING_ACCESS_TOKEN
   ```
   The hidden prompt keeps the token out of command text and shell history. The
   CLI must inherit this variable. For persistent use, create an owner-only token
   file (`chmod 600`) and configure `auth.account.tokenFile`. A hosted agent can use its
   secret settings if they inject the token into the actual execution environment.
3. Run `starling-banking doctor --json`. Require exit code 0 and `data.ok: true`;
   review warnings and confirm the live/sandbox environment and intended account.
   The diagnostic makes read-only API calls and checks configured signing locally.

A config file is optional; the account token's bank scopes determine access. To customise settings, run
`starling-banking init`, edit the generated external file, then run `doctor` again.
See [configuration](configuration.md) for every setting and path override.

## Enable payments or payee registration

1. Choose the capabilities you want in Starling's token scopes; there are no local
   capability switches. Give the account token only the non-initiation scopes you need.
2. Create tokens with the necessary [scopes](scopes.md). A live personal token
   cannot combine `payee:create` with `pay-local:create` or `standing-order:create`.
   Keep non-initiation scopes, including `payee:create`, on the account token.
   Optionally create a separate token with `pay-local:create` for the **same holder**,
   supply it locally as `STARLING_PAYMENT_ACCESS_TOKEN` or `auth.payments.tokenFile`.
   The CLI routes automatically; no manual config switching is needed. Keep
   `pay-local:read`, `payee:read`, `account:read` and `transaction:read` on the account
   token for lookups/status. Omit the payment token entirely if you do not want payments.
3. For payments, run `starling-banking keys generate`. Register both generated
   **public** keys in Starling's Personal Access → Keys page (API first, rotation
   second). Keep both private keys local and back up the rotation key. Set
   `signing.keyUid` to the API key UID shown by Starling and `signing.keyFile` to
   its private key path. A public key UID is different from an application client ID.
   To enter the optional token privately, use the hidden prompt above with
   `STARLING_PAYMENT_ACCESS_TOKEN` in place of `STARLING_ACCESS_TOKEN`.
4. Set low positive `limits.perPayment` and `limits.perDay`; optionally restrict
   `allowedPayees`. Run `doctor --json` again. Its local signing test does not prove
   that Starling has registered the matching public key. Check
   `data.capabilities.payments.ready` before initiating a payment; overall `data.ok`
   covers account setup and may be true without the optional payment token.

The agent must preview the exact payment/payee change and obtain fresh approval
before confirming. Starling may additionally require approval in its app. See
[commands](commands.md) for syntax and [troubleshooting](troubleshooting.md) for errors.

## Sandbox and credential maintenance

Use `environment: "sandbox"` with simulator credentials for fake money. Separate
configs/runtime directories keep different holders or live/sandbox state apart.
Run `doctor` after changing configuration, credentials or environment.

Keep token and private-key files owner-only (`chmod 600`). Never share their contents
with the agent. If exposed, revoke and replace them locally. Token refresh is not
automated; supply a replacement through the same protected source when needed.
