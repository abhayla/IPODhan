---
name: owner-gated-feature-flags
description: >
  Governance for scraper feature flags: every ENABLE_* flag DEFAULTS OFF, new
  capabilities land their pure core first while the live enqueue/fetch/cron side
  is a deliberate §GATE no-op, and production activation is reserved as the
  owner's manual call — never auto-enabled by code or a deploy.
globs: ["scraper/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Owner-Gated Feature Flags (the §GATE governance convention)

> This rule covers GOVERNANCE only. The flag MECHANICS (`ENABLE_<FEATURE>` +
> `<FEATURE>_PERCENTAGE` percentage rollout via `shouldUseFeature()`) are owned
> by the `scraper-write-path` rule — do not restate them here.

## (a) Every flag defaults OFF

In `scraper/src/config/feature-flags.ts`, every boolean capability flag MUST be
read as `process.env.ENABLE_<FEATURE> === 'true'`, so an unset/typo'd env var
resolves to `false`. The file's own header states "All flags default to false/0
for safety". Percentage knobs MUST default to `'0'` via
`parseInt(process.env.<FEATURE>_PERCENTAGE || '0')`. `validateFeatureFlags()`
enforces 0–100 bounds at startup. New flags MUST follow this shape — never
default-true, never inverted (`!== 'false'`) for a real capability.

## (b) Land the pure core first; gate the live side as a §GATE no-op

A new scraper capability MUST ship its deterministic "pure core" (parsing,
planning, computation) first, while the side that touches production (enqueueing
jobs, network fetch, persistence, or a cron registration) is a DELIBERATE no-op
marked with a `§GATE` comment. Confirmed exemplars:

- `scraper/src/scheduler/jobs/stage-reconciler-job.ts` (~line 63) — inside the
  `if (!dryRun)` branch the enqueue/trigger is intentionally absent:
  `"§GATE: enqueue/trigger the due fetches here once activated. Intentionally a
  no-op in this build — activation (job triggers + cron) is Abhay's call."` The
  job runs `dryRun: true` by default and logs `"cycle complete (plan computed;
  enqueue is §GATE)"` (~line 69).
- `scraper/src/scheduler/stage-reconciler.ts` (~line 12) — the planner core ships;
  "its enqueue side is activated only on Abhay's §GATE".
- `scraper/src/config/feature-flags.ts` `ENABLE_STAGE_RECONCILER` (~line 105) and
  `ENABLE_GMP_SCHEDULED_JOB` (~line 78) both document "GATED OFF by default;
  activation in prod is Abhay's call".

The literal token is `§GATE` — grep for it before adding a gated capability to
match the existing idiom exactly.

## (c) Production activation is the owner's manual call

Flipping an `ENABLE_*` env var or enabling a gated cron in production is RESERVED
for the owner (Abhay). Code, scripts, and deploy pipelines MUST NOT auto-enable a
gated capability. In `scraper/src/scheduler/config.ts` both `gmpInvestorgain`
(~line 76) and `stageReconciler` (~line 133, 226 for PROD/DEV) gate their
`enabled` on `process.env.ENABLE_* === 'true'` with `// GATED OFF; Abhay enables
in prod (§GATE)`; `scraper/src/scheduler/scheduler.ts` (~line 194) only registers
the reconciler when that flag is set, in dry-run.

## Why

Scrapers write to the live production DB and fire real cron jobs. Defaulting off +
a §GATE no-op lets the safe, testable core land and be reviewed without any
production behavior change, and keeps the irreversible "go live" decision (which
may require retiring an external PM2 job to avoid double-writes, e.g. GMP #6/#8)
an explicit human act — not a side effect of merging or deploying.

## CRITICAL RULES

- MUST define every new boolean flag in `feature-flags.ts` as
  `process.env.ENABLE_<FEATURE> === 'true'` (defaults OFF); MUST default
  percentages to `'0'`. MUST NOT use a default-true or `!== 'false'` form.
- MUST land a new capability's pure core first and mark the live
  enqueue/fetch/cron side as a `§GATE` no-op until separately activated.
- MUST NOT auto-enable a gated flag or cron from code, a script, or a deploy —
  production activation is the owner's manual call.
- MUST keep the `§GATE` comment token verbatim so the gated boundary stays
  greppable across config, job, and scheduler files.
