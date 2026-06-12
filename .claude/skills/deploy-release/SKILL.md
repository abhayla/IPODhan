---
name: deploy-release
description: >
  Run or troubleshoot an IPODhan production deployment via the manual GitHub Actions
  deploy workflow — quality gates, timestamped backup, shared-package compile order,
  dynamic PM2 ecosystem config, migrations, health check, and rollback semantics.
  Use when deploying to the Windows VPS or diagnosing a failed deploy.
type: workflow
allowed-tools: "Bash Read Grep Glob"
argument-hint: "[--skip-tests] [--diagnose]"
version: "1.0.0"
synthesized: true
private: true
---

# Deploy / Release Runbook

Deploys are MANUAL-ONLY (`workflow_dispatch` on `.github/workflows/deploy.yml`)
to the Windows Server 2022 VPS. PM2 runs `ipodhan-web` (cluster ×2, port 3001)
and `ipodhan-scraper` (fork) per the dynamically generated ecosystem config.

## STEP 1: Pre-flight

1. Confirm main is green: CI (`ci.yml`) passed on the commit being shipped —
   including the `packages/shared/dist/db/schema.d.ts` verification step
2. Check for pending migrations in `web/drizzle/` — note them; the migration
   step is `continue-on-error: true` (see STEP 4 caveat)
3. Confirm no in-flight scraper runs you'd interrupt (scheduler crons in
   `scraper/src/scheduler/config.ts`)

## STEP 2: Trigger

```bash
gh workflow run deploy.yml                      # full deploy with quality checks
gh workflow run deploy.yml -f skip_tests=true   # EMERGENCY ONLY — skips lint/tsc/unit/build gates
gh run watch                                    # follow progress
```

`skip_tests=true` exists for emergencies; using it on a routine deploy ships
unverified code — don't.

## STEP 3: What the workflow does (in order)

1. **Quality checks** — lint, tsc, unit tests, build (skipped only via skip_tests)
2. **Backup** — timestamped `backup-YYYY-MM-DD-HHmmss` into `C:\Apps\IPODhan\backups`
3. **Build** — shared package compiled FIRST, then web with env secrets
4. **Copy** to `C:\Apps\IPODhan\current` + install prod dependencies
5. **Generate ecosystem.config.js** dynamically — absolute paths + `NODE_PATH`
   for monorepo module resolution (the repo-root ecosystem.config.js is the
   template; the VPS one is generated)
6. **DB migrations** — `continue-on-error: true`
7. **PM2 reload** (or start), then **health check** — up to 10 attempts × 3s
8. **On failure** — rollback: restore the backup, restart web
9. **Cleanup** — keep the 5 most recent backups

## STEP 4: Post-deploy verification (manual, ALWAYS)

1. Health endpoint / homepage on the production port responds
2. `pm2 status` on the VPS shows both processes online with stable restarts
3. **Migration caveat:** because migrations run `continue-on-error`, a deploy
   can go green with a FAILED migration. If this release included migrations,
   verify them explicitly (check the workflow log's migration step output, then
   spot-check the schema). A green deploy is NOT proof migrations applied
4. Tail recent logs for new errors (web + scraper pino output)

## STEP 5: Rollback / diagnose a failed deploy

- Automatic rollback already restored the previous backup if the health check
  failed — verify with `pm2 status` + homepage check
- Manual rollback: restore the newest `backup-*` directory into
  `C:\Apps\IPODhan\current`, then `pm2 reload`
- Common failure modes: stale shared `dist/` (rebuild `packages/shared`),
  `NODE_PATH` resolution errors (regenerated ecosystem config malformed),
  port 3001 contention, migration partially applied (see STEP 4.3)

## Database backup conventions (schema-critical operations)

Outside deploys, schema-critical operations use
`backup_pre_{operation}_{YYYYMMDD_HHMMSS}.sql` (root `backups/` or
`database/backups/`). Create one BEFORE any manual destructive migration.

## CRITICAL RULES

- MUST deploy only via `workflow_dispatch` — never hand-copy files to the VPS
- MUST NOT use `skip_tests=true` for routine deploys
- MUST verify migrations explicitly after any deploy that included them —
  the workflow's `continue-on-error` hides migration failures
- MUST verify PM2 process health + homepage manually after every deploy
- MUST create a `backup_pre_*` SQL backup before manual schema-critical operations
