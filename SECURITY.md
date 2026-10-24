# Security policy

This project can be given access to a real bank account, so security reports matter.

## Reporting a vulnerability

Please **do not open a public issue** for anything that could let someone move money, bypass a permission group, spending limit or confirmation step, or read a token or key. Use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") on this repository.

Include what you did, what you expected, and what happened. Never include a real access token or private key; if you pasted one anywhere by accident, revoke it in the Starling developer portal first.

## What counts

In scope: bypassing `permissions`, `limits`, `allowedPayees` or the preview/confirm step; secrets appearing in output or logs; unsafe handling of API responses (for example text from the bank causing an action); signing or replay problems; path handling in `--out`/config paths.

Out of scope: weaknesses that need an attacker who already controls your computer, shell or config file (an agent with unrestricted shell access can always edit its own config, which is why your token's scopes are the real limit); Starling's own API.

## Safe use

Create read-only tokens for everyday use, a separate token only if you enable payments, start with low limits, and keep `allowedPayees` tight. See the README's "How safety works (and its limits)".
