# Validation recorded in this repository

## v0.1.1 — 25 October 2026

| Check | Result |
|---|---|
| Deterministic Node tests | **139 passed**, zero failures; fake bank only |
| Skill-format validator and documentation links | Passed |
| Lightweight OpenAI agent smoke checks | **17/17 selected model/case runs, 200/200 required checks**; two Luna models, low reasoning, one pass |
| New-user workflow | Offers diagnostic, runs it after approval, explains missing token and safe local setup; no unrequested config/key creation |
| Real banking / agent-host installation | Not performed for this release |

See [agent evaluation](agent-eval-validation.md) for exact cases, grader corrections,
usage, evidence hash and limitations. Runtime changes are the version label;
agent instructions add authentication preflight and guided onboarding. Documentation
and the developer eval harness were reorganised/extended. Prior sandbox/live evidence
below is historical and does not imply every endpoint or production account type is validated.

## v0.1.0 — historical evidence

Release: **v0.1.0**, 24 October 2026. These are recorded checks and their limits,
not a claim that every API operation, model or agent host is validated.

| Check | Result |
|---|---|
| Deterministic Node tests | **135 passed**, zero failures; no paid models or real bank access |
| Skill-format validator | Passed name/frontmatter checks |
| Distributable-only eval copy | Tested: excludes `.local`, credentials, Git history, development tools and raw eval results |
| Official Starling sandbox | Core reads/writes across two individual, one joint and one business customer; signed 1p transfers and recipient credits verified |
| Live personal account | 13 reads; payee registration/read-back; signed/app-approved 1p payment accepted with one settled debit; duplicate protection; unapproved/declined consent observations |
| Final light agent smoke eval | **Blocked** by Claude usage limit before behaviour could be measured; one attempted case, $0.00, no fallback/matrix |
| OpenClaw/Codex installation | **Not performed**. Only OpenClaw CLI help/documentation was inspected to supply installation commands |

Evidence: [sandbox validation](sandbox-validation.md), [live validation](live-validation.md)
and [agent smoke eval](agent-eval-validation.md). The runtime and instructions were
also reviewed for CLI-only bank access, exact preview/read-back, fresh user approval,
no automatic retries, private credentials and explicit unresolved bank statuses.

The release archive includes only `SKILL.md`, the config example, `scripts/`,
`references/`, `data/`, license and notices. It is built from committed files.
Private credentials, signing keys, bank data, consent references and raw transcripts
are excluded from Git and the archive. The repository root is itself a skill so
OpenClaw can install its tagged Git source directly.

Sandbox evidence does not prove production joint/business behaviour or name matching.
The sandbox stored deliberately wrong names during creation. Name-update app approval
and a public consent-status lookup remain unverified; no consent-status endpoint was
found in the public specification. Both payment-order details and the associated
payments endpoint are queried independently, rather than short-circuiting on 404.

Re-run deterministic checks with `npm test`. Paid agent evals are an explicit,
small developer action (`npm run eval`), never a CI step. CI runs only Node tests.
