# Decisions, risks and future work

Current design decisions, known gaps and future work live here. Operational setup
is in [setup](setup.md); historical checks remain in [versioned validation](https://github.com/rjaymacheteai/starling-banking-skill/blob/main/docs/validation.md).

## Decision log — 25 October 2026

| ID | Decision | Consequence |
|---|---|---|
| D01 | One private `config.json` contains both access tokens, the optional API private key/UID and settings. No credential environment variables or separate token/key files. | Protect the entire file as a secret. `keys generate` stores the private key there and returns only the public key. |
| D02 | Account token is required; payment token is optional and used only for initiation plus identity diagnostics. | Match holders, check scopes, never fall back between credentials. |
| D03 | Starling scopes determine capabilities. Local spending caps and recipient allowlists are removed. | Registered-payee validation and exact fresh approval remain; no app-level amount cap or recipient subset is enforced. |
| D04 | Generate/use only the API signing pair for now; rotation workflow is deferred. | See R01; no automatic replacement of an existing key. Existing rotation files are never deleted or consumed. |
| D05 | Keep the registered API Key UID. | Verified against Starling's signed Authorization format: `Signature keyid="<API Key UID>"`. It identifies the public key used to verify a signature. Bearer-only reads do not need it. |

Sources for D04/D05: [Starling API keys and message signing](https://developer-sandbox.starlingbank.com/docs).

## Risks and present limitations

**R01 — Deferred rotation can block onboarding or key replacement.** Starling's
documented setup registers both API and rotation public keys. We have not validated
a new API-only portal registration. If the portal requires a rotation key or an
upload signature, stop and explain the unsupported step. Existing registered API
keys can sign requests without a rotation private key at runtime. Replacement API
registration requires the existing rotation private key under Starling's documented
flow. No maximum key age is specified: this is controlled replacement, not a fixed
expiry timer. Do not claim the current generator completes every registration flow.

**R02 — One file contains all credentials.** Compromise of config or its backups can
expose both access tokens and the signing private key. Keep it outside the skill
and Git, owner-only (mode 600; parent directory 700), and never paste or print it.
Agents use diagnostic/public-key commands rather than reading secret contents.

**R03 — Bank and approval boundaries.** There is no local spending cap or recipient
allowlist. Agent-mode approval depends on the agent following instructions; the CLI
cannot prove a human said yes. An unrestricted shell agent can alter local files.
Terminal mode adds interactive code entry. Bank scopes and any Starling app approval
remain independent controls. Notes/card/savings commands can write immediately;
savings movement requires the agent to obtain fresh approval first.

**R04 — Bank responses have gaps.** Submission/HTTP success does not establish
completion. The public order/payment lookups cannot distinguish every unanswered,
declined or expired app consent. Do not automatically resend uncertain writes.
Supplied recipient names are not verified Confirmation of Payee; tested sandbox
creation accepted deliberately incorrect names.

**R05 — Coverage is bounded.** The catalogue is not proof of validation or personal-
token support for every operation. Production joint/business behaviour, every
currency and full host integration are not validated. Friendly payee creation is
UK sort-code/account-number based. The catalogue has no statement PDF/CSV or holder
state-transition routes; transaction CSV uses the feed-export endpoint instead.
Historical model/sandbox/live evidence applies only to the versions and cases recorded.

## Unsupported scope

- Standing-order creation/update (listing/cancellation are supported).
- The separate Payment Services API, other banks, account opening/closing.
- Production OAuth onboarding for other customers or automatic token refresh.
- Webhook hosting, background monitoring and autonomous scheduled actions.
- API-key rotation/replacement, rotation-key generation or recovery automation.

## Future improvements

| Priority | Work | Acceptance criterion |
|---|---|---|
| First | Rotation/registration support | Validate Starling's portal requirements, provide explicit rotation-key registration and signed replacement upload, preserve old keys until the user confirms migration. |
| Next | Resolve consent-status ambiguity | Add only a verified supported bank workflow; never infer rejection from 404/empty lists. |
| Later | Broader endpoint/account/host validation | Add scoped evidence before claiming support; no paid model matrix by default. |

No future item is an instruction to generate keys, access a real account or run paid evals.
