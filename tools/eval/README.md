# Agent behaviour evals

Optional real-model runs against the distributable skill and a localhost fake bank.
`npm test` is separate: it uses no models and never accesses a real bank.

## Small default

```sh
npm run eval
```

Default: Codex CLI with `gpt-5.6-luna`, low reasoning, one pass, concurrency 1,
four cases (payment approval/decline/disabled permissions and payee creation).
Uses the CLI's existing login; no API key is required when signed in through ChatGPT.
This consumes account usage. The runner never upgrades or changes models automatically.

```sh
npm run eval:list
npm run eval -- --models gpt-6-luna --cases payee-update-happy-path,pay-bank-rejected
npm run eval -- --max-tokens 100000 --effort low
node tools/eval/report.mjs evals-results/<folder>
```

`--cases` matches case-name substrings. Model availability depends on your account.
`--max-tokens` stops scheduling after the accumulated **uncached input + output**
tokens reach that threshold (default 250,000). Cached input is still reported.
This is checked after a case, so the last case can exceed it. Each turn also has
a 120-second timeout. Codex does not report dollar cost; reports say “not reported”,
never $0. A partial run exits nonzero and must not be recorded as a complete pass.

Claude support remains explicit: `--provider claude --models haiku`. Its
`--budget-usd` option is a per-turn CLI stopping control, not a billing quote;
it is not a Codex dollar cap. `--full`, multiple models/passes, higher effort and
concurrency are deliberate opt-ins. Model evals never run in CI.

## Isolation and grading

Each case copies only the distributable allowlist to a temporary project, uses fake
Starling credentials/signing keys and the local fake bank, and removes the fixtures
on completion. No skill is installed in a user's Codex/OpenClaw directories.

Codex uses temporary home/config/session directories, copies the existing login
file without displaying it, ignores user config/rules and uses no user plugins or
MCP servers. Workspace permissions include the fake runtime; localhost network
access is enabled for every turn, including resumed turns. This is CLI workspace
isolation, not a security boundary against hostile model-generated shell commands.
Claude uses isolated project settings and a strict MCP configuration.

Graders inspect actual bank requests and assistant/tool output: authentication
preflight, no raw HTTP bypass, no writes before approval, exact recipient/amount/
reference, preserved payee accounts, valid signatures, unchanged config, no secret
output, no blind retries and honest bank-approval wording. New cases cover payee
updates (applied and awaiting bank approval) and bank-rejected payments.

Ignored `evals-results/` contains manifests, individual runs and summaries. Manifests
record provider, models, selected cases, effort, limits and skill SHA-256. Keep raw
transcripts private; publish only reviewed aggregate evidence. A small passing run
is a smoke check, not a reliability guarantee or proof of a specific host's full runtime.
