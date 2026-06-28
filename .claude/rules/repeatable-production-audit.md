---
name: repeatable-production-audit
description: >
  Production health on IPODhan is checked two SCRIPTED, exit-code-gated ways — the audit-prod.mjs
  API/data audit and the prod-verify.yml browser sweep — never by eyeballing. Codifies which to
  run, what each catches, and that "looks fine" is not a pass.
globs: ["scripts/audit-*.mjs", "scripts/lib/*.mjs", ".github/workflows/prod-verify.yml"]
version: "1.0.0"
synthesized: true
private: true
---

# Repeatable Production Audit

Production is verified by SCRIPTS with exit codes, so "iterate until clean" is measurable, not
a vibe. There are two complementary mechanisms — run both; neither alone is sufficient.

## (a) audit-prod.mjs — read-only API + data-integrity audit

`scripts/audit-prod.mjs` (run via root `npm run audit:prod`) fetches the live site plus its
public and admin APIs and asserts data integrity. **Read-only — never writes.** Exit `0` = all
checks pass, exit `1` = at least one failure. Each check maps to the GitHub issues filed
2026-06-12 (`#2`–`#14`) — e.g. seed/dummy company names that must never appear in prod (#5),
public route 200s, admin-API consistency. Defaults to `https://ipodhan.com`; override with
`BASE_URL=`. Admin checks activate only when `ADMIN_API_TOKEN` is set (sent as
`Authorization: Bearer`).

Helper modules (keep audit logic here, do not inline duplicates):
- `scripts/lib/substance-checks.mjs`
- `scripts/lib/ipo-stage-completeness.mjs`
- `scripts/audit-substance-plausibility.mjs`
- `scripts/audit-ipo-coverage.mjs`

- MUST treat a non-zero exit from `npm run audit:prod` as a real failure to fix, not noise.
- MUST keep `audit-prod.mjs` read-only — it diagnoses prod; it never mutates it.

## (b) prod-verify.yml — browser-level correctness sweep

`.github/workflows/prod-verify.yml` runs a daily (`cron: '30 2 * * *'`, also
`workflow_dispatch`) Playwright/Chromium sweep via `npm run test:prod-verify` against
`https://ipodhan.com` (overridable `base_url` input). It asserts, on EVERY public route: zero
console errors, no failed same-origin requests, and real rendered content. This catches what
an HTTP-200 check misses — blank pages, hydration errors, and broken client-side fetches that
still return 200.

- MUST use the browser sweep, not curl/HTTP-200, to claim "the page works" — a 200 with a
  blank body or console error is a FAILURE here.

## When to run which

- Data correctness / coverage / admin-API drift → `npm run audit:prod`.
- Rendering / client-fetch / console-error regressions → `prod-verify.yml` (or local
  `npm run test:prod-verify`).
- After any deploy or data-pipeline change → run BOTH and require both green before declaring
  production healthy.

## CRITICAL RULES

- MUST verify production via `npm run audit:prod` AND the `prod-verify.yml` browser sweep — never by manual inspection.
- MUST treat exit 1 from `audit-prod.mjs` (or a failed prod-verify run) as a blocking failure; do not hand-wave it.
- MUST keep new audit logic in `scripts/lib/*.mjs` / `scripts/audit-*.mjs` and map new checks to their GitHub issue number.
- MUST keep `audit-prod.mjs` read-only and supply `ADMIN_API_TOKEN` only via env, never hard-coded.
