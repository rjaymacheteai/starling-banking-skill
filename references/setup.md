# Setup guide (for the user)

About 10 minutes for read-only use; add 10 more for payments. At any point, `starling-banking doctor` tells you what is left.

You need Node.js 18 or newer (`node --version`). Get it from https://nodejs.org if not.

## 1. Read-only: balances and transactions

1. Sign in at https://developer.starlingbank.com and link your Starling account (Personal Access page). One developer account links to one Starling account; a business or joint account needs its own developer account and token.
2. Create a **personal access token**. For read-only use tick these scopes: `account:read`, `balance:read`, `transaction:read`, `payee:read`, `account-identifier:read`, `card:read`, `savings-goal:read`, `mandate:read`, `pay-local:read`, `payee-transaction:read`. (Fewer is fine; commands that need a missing scope tell you which.)
3. Put the token in your shell, **not in the chat**:
   ```
   export STARLING_ACCESS_TOKEN='paste-token-here'
   ```
   Add that line to `~/.zshrc` or `~/.bashrc` to keep it. OpenClaw users can instead set it under `skills.entries.starling-banking.apiKey` in `~/.openclaw/openclaw.json`.
4. Run `starling-banking doctor`. Fix anything marked ✗.

That's it: the skill is read-only until you say otherwise.

## 2. Turning on more (optional)

```
starling-banking init
```

creates `~/.config/starling-banking/config.json` (Windows: `%APPDATA%\starling-banking`) from `config.json.example`. Every setting is explained in the comments. Add groups to `"permissions"`, for example `["view", "organise", "card-controls"]`. Run `doctor` again after any change. If your token lacks scopes for a group you switched on, `doctor` says which.

Your config lives outside the skill folder so updates never overwrite it.

## 3. Payments (optional, takes extra care)

1. Create a **second token** for payments, with `payee:read`, `account:read`, `pay-local:create` and `pay-local:read`. Starling rejects combining `payee:create` with payment-initiation scopes (`pay-local:create` or `standing-order:create`). To register payees, use a **separate payee token** with `payee:create` and `payee:read`, excluding those payment-initiation scopes. Select the appropriate token through `auth.tokenFile` or `auth.tokenEnv` for each workflow; the CLI does not switch tokens automatically. Your everyday read-only token can remain separate from both.
2. Create signing keys, which Starling requires for payments:
   ```
   starling-banking keys generate
   ```
   Upload **both public keys** in the developer portal (Personal Access → Keys): the `api` key first, then the `rotation` key. Copy the **Key Uid** Starling shows for the API key. Keep the private keys private, and back up the rotation private key.
3. In `config.json`:
   ```jsonc
   "permissions": ["view", "payments"],
   "signing": { "keyUid": "<Key Uid from the portal>", "keyFile": "~/.config/starling-banking/keys/starling-api-private.key" },
   "limits": { "currency": "GBP", "perPayment": 25, "perDay": 100 }
   ```
   Start with low limits. Optionally set `"allowedPayees": ["Alex Smith"]`.
4. Set `STARLING_ACCESS_TOKEN` (or `auth.tokenFile`, if configured) to the payments token and run `doctor`. Test with a very small payment (£0.01) to a payee you control, and approve the live payment request in the Starling app.

## Sandbox

Set `"environment": "sandbox"` and use a sandbox token from the developer portal's simulator. Sandbox uses fake data and fake money.

## Keeping secrets safe

- Never paste a token or private key into a chat. If you did, revoke it in the portal and make a new one.
- Keep key files readable only by you (`chmod 600`). `doctor` warns if they are not.
- Anyone who has a token with payment scopes **and** your signing key can move money. Treat them like your banking password.
