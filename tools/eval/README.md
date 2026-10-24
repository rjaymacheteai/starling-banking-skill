# Agent behaviour evals

These are optional, billed model runs against the real skill and a local fake bank.
They are separate from `npm test`, which uses no models or external bank access.

## Small default

```sh
npm run eval
```

The default is **one Haiku pass, low effort, concurrency 1**, covering only:

- payment preview, explicit approval and one correct signed submission;
- declining a preview without sending money;
- refusing a payment when permissions are disabled;
- payee preview, name/account read-back and one creation after approval.

The per-turn budget is `$0.10`. Each core case has one or two user turns. The CLI
checks the budget during a run, so this is a stopping control, not a billing quote.
The runner stops scheduling new cases if it detects a model access/usage limit and
never switches to a larger model automatically. Any required check failure returns
a nonzero exit code. A single pass is a smoke check, not a reliability guarantee.

```sh
npm run eval:list
npm run eval -- --cases pay-happy-path --budget-usd 0.10 --effort low
npm run eval -- --full --models haiku --passes 1   # explicitly request all cases
node tools/eval/report.mjs evals-results/<folder>
```

Named aliases use the installed Claude CLI's `haiku`, `sonnet` and `opus` aliases;
full model IDs are also accepted. `--models all`, `--full`, higher effort, extra
passes and greater concurrency are explicit opt-ins and increase usage.

## Checks and isolation

Each case copies only the distributable skill into a temporary project and uses
fake credentials, config, signing keys and a localhost bank. User Starling environment
settings are removed before injecting the fake settings. User skills/settings/MCP
servers are excluded with `--setting-sources project --strict-mcp-config`.
This is project isolation, not an operating-system sandbox.

Checks inspect the fake bank's actual request log and the conversation: no writes
before approval, exact amount/recipient/reference, permission enforcement, no config
edits, no secret output, signing and honest submitted/pending wording. Run records
and a summary are saved under ignored `evals-results/`; `manifest.json` records the
cases, model alias, effort, budget and skill hash. Keep raw transcripts out of Git.

The wider case library and trigger-query files remain available for deliberate
future testing. They do not run by default and are not part of CI.
