---
name: pre-commit-secret-and-typecheck-gate
description: >
  Every IPODhan commit runs a custom regex secret scanner over staged-ADDED lines, then a
  type-check-only lint-staged pass. Codifies the scanner's shapes, the `secret-scan:allow`
  exemption, and why the hook exists (GitHub #1, leaked VPS Postgres password).
globs: [".husky/**", "scripts/check-staged-secrets.js", ".lintstagedrc.js"]
version: "1.0.0"
synthesized: true
private: false
---

# Pre-Commit Secret + Type-Check Gate

`.husky/pre-commit` runs exactly two commands, in order:

```
node scripts/check-staged-secrets.js
npx lint-staged
```

Both must pass for a commit to land. Do not bypass with `--no-verify`.

## Secret scanner — scripts/check-staged-secrets.js

A deterministic gate created after GitHub issue **#1** (a leaked VPS Postgres password). It
reads `git diff --cached --unified=0` and inspects ONLY added lines (`+`, excluding the `+++`
file header). It exits 1 (blocking the commit) when an added line matches a credential shape:

- Connection strings with an embedded password — `postgres`/`postgresql`/`mysql`/
  `mongodb`(+srv)/`redis`/`amqp(s)` `://user:PASSWORD@...`.
- `PGPASSWORD=...` literals. <!-- secret-scan:allow -->
- AWS access key ids (`AKIA` + 16 chars).
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`).
- Hardcoded `api_key` / `auth_token` / `client_secret` `= "..."` (20+ chars).

A `PLACEHOLDER` allowlist exempts obvious non-secrets (`<...>`, `${VAR}`, `%VAR%`,
`process.env`, `your_`, `example`, `changeme`, `***`).

- To deliberately commit a dummy/sample credential, append the literal token
  `secret-scan:allow` to that line — the scanner skips any added line containing it. MUST NOT
  use `secret-scan:allow` to wave through a REAL secret.
- Real secrets MUST live in env (`.env` is gitignored); never commit them. See issue #1.

## Type-check pass — .lintstagedrc.js

`npx lint-staged` runs `.lintstagedrc.js`, which for staged `web/**/*.{ts,tsx}` runs
`npx tsc --noEmit --project web/tsconfig.json`. This is **type-check only** — there is NO
`eslint --fix` and no formatter in the pre-commit lint-staged config (lint runs separately in
CI). Do not add auto-fixers here that rewrite files mid-commit.

- MUST keep the type-check scoped to `web/**/*.{ts,tsx}` with `--noEmit`; it gates type errors,
  it does not mutate staged files.

## CRITICAL RULES

- MUST keep `.husky/pre-commit` running `check-staged-secrets.js` then `lint-staged`; do not commit with `--no-verify`.
- MUST NOT use `secret-scan:allow` to bypass the scanner for a real credential — only for documented dummy values.
- MUST keep real secrets in gitignored env files; the scanner exists because of the leak in issue #1.
- MUST keep the lint-staged step as `tsc --noEmit` type-check only — do not add file-rewriting fixers to the pre-commit path.
