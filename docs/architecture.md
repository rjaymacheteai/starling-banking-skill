# Architecture and maintenance

## Documentation ownership

Repository agent workflow and the release checklist live in [AGENTS.md](../AGENTS.md).

- [README](../README.md): user starting point, setup and installation.
- [SKILL.md](../SKILL.md): agent execution boundary, authentication preflight,
  exact read-back/approval rules and interpretation of bank results.
- [Setup](../references/setup.md): credential and signing onboarding.
- [Configuration](../references/configuration.md): authoritative single-file credential/settings reference.
- [Bank scopes](../references/scopes.md): token capabilities enforced by Starling.
- [Commands](../references/commands.md) and [troubleshooting](../references/troubleshooting.md): invocation and recovery references.
- [Decision log](../references/decisions-and-limitations.md): current decisions, risks, limitations and future work.
- [Validation](validation.md): recorded evidence, dates and limitations; detailed reports remain separate.

Keep config comments short. Explain settings in the configuration reference and
agent-specific requirements in SKILL.md. Recorded release evidence is historical;
update it only when new checks have actually run.

## Runtime flow

```text
Agent follows SKILL.md
  → scripts/starling-banking.mjs / lib/cli.mjs
  → context.mjs: validate external config; auth.mjs: require account token, route initiation to optional payment token
  → commands: resolve account/recipient and construct supported operation
  → engine.mjs: preserve exact previews and confirmation plans
      → immediate operation, or
      → guards.mjs: validate registered recipient/amount/reference → state.mjs: save preview
      → confirm: recheck token identity/scope, environment and preview integrity
  → auth.mjs: verify payment scope and matching holder before preview/confirmation
  → client.mjs / signing.mjs: authenticate, sign where required, send to Starling
  → state.mjs: record writes; return result and any bank approval requirement
```

`endpoints/catalog.json` holds the 87-operation catalogue. Categories describe
operations and preview requirements; they are not local permission switches. Friendly commands and generic
`call` share the operation engine; generic calls do not bypass guards. Standing-order
creation/update is explicitly blocked. `doctor` uses read-only diagnostic requests
and a local signing self-test; it does not submit a test payment.

There are three distinct controls: agent instructions govern user intent and fresh
approval; CLI guards enforce credential routing, recipient validation and confirmation plans; Starling
enforces token scopes and bank approval. Card/organise/savings writes can execute
without a CLI plan. Savings movement still requires fresh approval under SKILL.md.
Risk rationale and unsupported scope are maintained in the [decision log](../references/decisions-and-limitations.md).

## Packaging and private state

The repository root is one installable skill. Runtime files are `SKILL.md`,
`scripts/`, `references/`, `endpoints/`, `config.json.example`, license and notices.
`tools/package-skill.mjs` archives only these paths from a clean committed tree.
Developer tools, tests and validation reports are not needed by the installed CLI.
The custom release archive contains only the allowlisted runtime files; GitHub
source archives and Git-based installs can contain the full tagged repository.
Pushing `main` does not change a previously published tag or release asset.

The external config contains all credentials and the optional API private key; it and local state survive upgrades. `.local/`,
raw eval results and `dist/` are ignored; never commit bank data or secrets.
See [configuration](../references/configuration.md) for path selection.

## Developer checks

- `npm test`: deterministic fake-bank tests; no models or real banking.
- `npm run eval:list`: inspect agent cases without running models.
- `npm run eval`: billed, four core Codex Luna cases at low effort by default; see
  [eval instructions](../tools/eval/README.md). Never runs in CI.
- `npm run test:live`: explicitly requested read-only live checks.
- `npm run setup:sandbox -- all --clipboard` / `npm run test:sandbox`: developer
  fixtures for four simulator customers; the suite writes disposable resources.
- `node tools/build-catalogue.mjs`: refresh catalogue metadata from Starling's specification.
- `npm run pack:skill`: produce a skill-only archive and checksum from committed files.

Live write helpers require private configs and interactive approval. They are not
the installed agent's interface. CI runs only deterministic tests across supported
Node versions and operating systems. See [validation](validation.md) for actual results.
