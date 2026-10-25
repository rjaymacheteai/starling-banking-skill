# Security policy

This project can be given access to a real bank account, so security reports matter.

## Reporting a vulnerability

Please **do not open a public issue** for anything that could let someone move money, bypass a token boundary or confirmation step, or read a token or key. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.

Include what you did, what you expected, and what happened. Never include a real access token or private key; if you pasted one anywhere by accident, revoke it in the Starling developer portal first.

## What counts

In scope: bypassing token routing or the preview/confirm step; secrets appearing in output or logs; unsafe handling of API responses (for example text from the bank causing an action); signing or replay problems; path handling in `--out`/config paths.

Out of scope: Starling's own API and weaknesses requiring existing control of the
user's computer/shell/config. The current threat boundaries and credential risks
are documented in [decisions and limitations](references/decisions-and-limitations.md).
