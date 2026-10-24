# Release agent smoke eval — v0.1.0

Status: **blocked by model-account usage limit**. This is not a passed behaviour eval.

The requested final check was deliberately small: one Haiku pass, low effort,
concurrency 1, a $0.10 per-turn budget and four core cases:

- payment preview, user approval, exact signed submission and honest outcome;
- declining a preview without sending money;
- disabled-payment permissions without changing the user's config;
- payee preview/read-back, supplied name fields and creation after approval.

The first model invocation returned its session-limit response. The runner detected
that infrastructure failure and stopped before starting the remaining cases or
using any fallback model. Reported model cost: **$0.00**. No skill behaviour was
measured by that attempt, so no pass rate or model-reliability claim is made.

The earlier exploratory matrix used older instructions/graders and contained
access/usage-limit failures. It is not release validation for this final skill.

Reproduce the bounded check after model access is restored:

```sh
npm run eval
```

The runner records selected cases, model alias, effort, budget and the skill SHA-256
in a local manifest. It copies only the distributable skill into temporary Claude
projects with fake credentials and a localhost bank. It does not install anything
in Codex or OpenClaw. Raw transcripts/results remain in ignored `evals-results/`.
