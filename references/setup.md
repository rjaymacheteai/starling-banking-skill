# Setup

Requires Node.js 18+. In this guide, `starling-banking` means
`node "<skill-directory>/scripts/starling-banking.mjs"`. No npm install is needed.

## Read-only access

1. Link your account on the [Starling developer portal](https://developer.starlingbank.com)
   and create a personal access token. Start with the read scopes for the commands
   you need; see [permissions](permissions.md). `account:read`, `balance:read` and
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
   file (`chmod 600`) and configure `auth.tokenFile`. A hosted agent can use its
   secret settings if they inject the token into the actual execution environment.
3. Run `starling-banking doctor --json`. Require exit code 0 and `data.ok: true`;
   review warnings and confirm the live/sandbox environment and intended account.
   The diagnostic makes read-only API calls and checks configured signing locally.

A config file is optional for view-only use. To customise settings, run
`starling-banking init`, edit the generated external file, then run `doctor` again.
See [configuration](configuration.md) for every setting and path override.

## Enable payments or payee registration

1. Enable only the required groups in your config. `payments` sends to registered
   recipients; `payees` registers or edits them. They are separate permissions.
2. Create tokens with the necessary [scopes](permissions.md). A live personal token
   cannot combine `payee:create` with `pay-local:create` or `standing-order:create`.
   Use separate payee/payment tokens and explicitly select the appropriate source
   in your config; the CLI never switches tokens automatically. Payment workflows
   need account/payee reads and `pay-local:create`; add `pay-local:read` and
   `transaction:read` for status and verification.
3. For payments, run `starling-banking keys generate`. Register both generated
   **public** keys in Starling's Personal Access → Keys page (API first, rotation
   second). Keep both private keys local and back up the rotation key. Set
   `signing.keyUid` to the API key UID shown by Starling and `signing.keyFile` to
   its private key path. A public key UID is different from an application client ID.
4. Set low positive `limits.perPayment` and `limits.perDay`; optionally restrict
   `allowedPayees`. Run `doctor --json` again. Its local signing test does not prove
   that Starling has registered the matching public key.

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
