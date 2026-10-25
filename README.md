# Starling Banking Skill

An unofficial skill for your own Starling account: balances, transactions, payees,
payments, cards, savings and CSV exports. Requires Node.js 18+; no npm dependencies.
Not affiliated with Starling Bank. [MIT-0](LICENSE), supplied without warranty.

## Set up once, in one file

1. Ask the agent to initialise setup, or run `node scripts/starling-banking.mjs init`
   from the skill folder.
2. Privately fill the generated `~/.config/starling-banking/config.json`
   (Windows: `%APPDATA%\starling-banking\config.json`). The file contains secrets;
   keep it owner-only and never send its contents to the agent.
3. Run `node scripts/starling-banking.mjs doctor`, or ask the agent to check setup.

The config holds actual credentials, not environment-variable names or paths to
other secret files:

```json
{
  "environment": "live",
  "auth": {
    "accountToken": "<required account token>",
    "paymentToken": null
  },
  "signing": { "keyUid": null, "privateKey": null, "algorithm": "auto" },
  "defaultAccountUid": null,
  "confirmation": { "mode": "agent", "expiresMinutes": 10 }
}
```

The **account token** is used for everything except payment initiation. Grant the
non-initiation scopes you need, including payee creation if wanted. The optional
**payment token** needs `pay-local:create` for the same holder. Store it in
`auth.paymentToken` only if you want payments. The CLI routes automatically, with
no fallback. See [setup](references/setup.md) and [config fields](references/configuration.md).

## Optional API signing

Signing is required for payment initiation, email/address changes and standing-order
cancellation. It is unnecessary for reads and payee creation/updates.

`keys generate` creates one API public/private pair, stores the private key directly
in config and shows only the public key. Register that public key with Starling, then
save its **API Key UID** in `signing.keyUid`. The UID is needed as the signature's
`keyid`; it is not an access token. `keys public` safely shows the public key again.

Signing registration/replacement constraints and deferred rotation work are recorded
in [decisions, risks and limitations](references/decisions-and-limitations.md#risks-and-present-limitations).

## Using the skill

Ask for a balance, a payee lookup or an exact change. Starling enforces token scopes.
Payments, payee changes and sensitive account changes require an exact CLI preview,
fresh user approval, then one confirmation. Any bank-app approval is separate.
Optional terminal mode requires the user to type the code themselves.

No spending caps or recipient allowlist are configured locally. Payments still need
a registered recipient, a valid amount/reference and the exact approval above.

| Task | Documentation |
|---|---|
| Credential/key onboarding | [Setup](references/setup.md) |
| Single-file fields and location | [Configuration](references/configuration.md) |
| Scopes / command syntax / failures | [Scopes](references/scopes.md), [commands](references/commands.md), [troubleshooting](references/troubleshooting.md) |
| Agent workflow | [SKILL.md](SKILL.md) |
| Design decisions, risks, unsupported scope and future work | [Decision log](references/decisions-and-limitations.md) |
| Architecture / recorded validation | [Architecture](docs/architecture.md), [validation](docs/validation.md) |

Security reports: [SECURITY.md](SECURITY.md). Attribution: [third-party notices](THIRD_PARTY_NOTICES.md).

## Installation

Add this repository through your Agent Skills host, or extract the custom skill-only
archive from [Releases](https://github.com/rjaymacheteai/starling-banking-skill/releases)
into its skill directory. The root is the skill; its name is `starling-banking`.
Git installs/source archives can include the full repo. Updates preserve your external
config and history. Changes on `main` do not modify an existing pinned release.
