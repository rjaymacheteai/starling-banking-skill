# Working on this repository

This repository develops one unofficial Starling banking skill. Its root is an
installable skill; `SKILL.md` governs the installed agent. This file governs agents
editing and releasing the repository. Read [architecture](docs/architecture.md)
for the runtime flow and documentation map.

## Implementation rules

- Keep the CLI dependency-free and compatible with Node.js 18+.
- Route banking operations through the bundled CLI and shared engine. Preserve
  permission checks, payment limits/allowlists, preview integrity, fresh approval,
  replay protection, redaction and honest unresolved statuses. Generic `call` must
  not bypass these controls. Read SKILL.md before changing banking behaviour.
- Keep credentials/config/state outside the installed skill. Never read out,
  commit or package tokens, private keys, recipient details, bank data or raw transcripts.
- Local developer credentials do not authorise bank testing. Use fake-bank tests
  by default. Live calls, sandbox mutations and paid model evals need explicit
  user authorisation for that work. Never run a model matrix as a routine check.
- Do not install the skill into any agent host unless the user requests installation.
- Keep README as the user entry point. Put settings in `references/configuration.md`,
  onboarding in `references/setup.md`, and agent workflow in SKILL.md. Keep the
  config example concise. Update validation records only with actual evidence;
  distinguish tests passed, tests blocked and operations not validated.

## Checks before delivery

Run `npm test` for runtime/config/packaging changes. For documentation-only changes,
check local links, command accuracy and `git diff --check`; validate skill frontmatter
when changing it. Never use paid evals or real banking as an implicit verification step.
Review staged changes for private data and unrelated user work before committing.

## Release contents: explicit allowlist

Build release assets with `npm run pack:skill` (`tools/package-skill.mjs`). It uses
`git archive HEAD` with this allowlist, under one `starling-banking/` directory:

- `SKILL.md`
- `config.json.example`
- `scripts/`
- `references/`
- `data/`
- `LICENSE`
- `THIRD_PARTY_NOTICES.md`

Do not archive the working directory or upload the whole repo as the skill asset.
Exclude `AGENTS.md`, README, `docs/`, `test/`, `tools/`, `.github/`, `.git/`, package
metadata, `.local/`, raw eval results, runtime config/state, keys and tokens. The
allowlist does not make secrets inside allowed paths safe: inspect those files too.
If runtime dependencies change, update both the packager allowlist and the isolated
eval copy in `tools/eval/lib/agent.mjs`, along with this list.

## Release procedure (when requested)

1. Align the new version in `package.json`, `scripts/lib/client.mjs` and SKILL.md
   metadata. Update relevant docs and dated validation evidence without claiming
   unrun checks. Do not move or overwrite a published version/tag.
2. Run `npm test` and inspect the staged file set for secrets. Commit the intended
   release changes. Require a clean working tree; the packager reads committed HEAD.
3. Run `npm run pack:skill`. It produces
   `dist/starling-banking-v<VERSION>.tar.gz` and `dist/SHA256SUMS`.
4. List and inspect the archive. Require exactly the allowlisted paths beneath
   `starling-banking/`, with no private data, symlinks or unexpected files. Extract
   to a temporary directory and run the extracted CLI's `--version`, `help` and
   `permissions` with an empty runtime directory and no banking credentials.
   These smoke checks must not contact a real bank. Verify the SHA-256 checksum.
5. Create an annotated `v<VERSION>` tag at the exact packaged commit. Push the
   commit and tag; verify required CI passes. Create the GitHub release for that
   tag and attach **both** the custom archive and `SHA256SUMS`. Describe concrete
   changes, validation and known limitations in its notes.
6. Download the published assets and verify the checksum. Confirm that tag, commit,
   CLI version and archive version agree. Report the release URL and any checks
   that remain blocked. Do not install it as part of publishing.

GitHub's automatic “Source code” downloads represent the full tagged repository;
the custom `.tar.gz` asset is the minimal distributable. Git-based installers can
fetch the full tagged source instead of the custom asset. Do not claim the release
allowlist filters Git installations. Point manual archive users to the custom asset.
Changes pushed to `main` do not update an existing release archive or tag; publish
a new version when those changes should reach users installing a pinned release.
