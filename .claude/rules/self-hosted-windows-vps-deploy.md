---
name: self-hosted-windows-vps-deploy
description: >
  IPODhan deploys from a self-hosted Windows runner to a fixed deploy directory. Codifies the
  PowerShell/PM2 gotchas that have bitten this pipeline — incremental checkout, lockfile-hash
  skip, pm2 delete (not reload), the $ErrorActionPreference trap, and dual feature-flag copies.
globs: [".github/workflows/deploy.yml", ".github/workflows/vps-*.yml", "ecosystem.config.js"]
version: "1.0.0"
synthesized: true
private: true
---

# Self-Hosted Windows VPS Deploy

`.github/workflows/deploy.yml` runs the deploy job on a `runs-on: self-hosted` Windows runner
that injects secrets from GitHub Secrets (`DATABASE_URL`, `REDIS_URL`, `ADMIN_API_TOKEN`,
`NEXT_PUBLIC_GA_MEASUREMENT_ID`, the Zerodha/AngelOne affiliate links) into `web\.env.local`
and `scraper\.env`. Target is `C:\Apps\IPODhan\current` (`DEPLOY_DIR`); backups go to
`C:\Apps\IPODhan\backups`. These project-specific mechanics MUST be preserved:

## Incremental build state

- `actions/checkout` uses `clean: false` so gitignored `node_modules` and `.next/cache`
  survive between runs — installs and Next builds stay incremental, not from-scratch.
- Install steps SKIP `npm ci` when `node_modules\.deploy-lockhash` (a SHA256 of
  `package-lock.json`) is unchanged. MUST update this marker after any real `npm ci`.
- The web build removes only `.next` OUTPUT, preserving `.next\cache` (the compiler cache).

## Backups + rollback

- Backups are `robocopy ... /XD node_modules .next` (huge, lock-prone, rebuilt on restore);
  robocopy exit `< 8` = success, so the step resets `$LASTEXITCODE` to 0 after.
- Pruning is PRUNE-FIRST, keep newest 1 (so failed deploys can't fill the disk).
- Rollback (`if: failure()`) restores the backup then `npm ci` + rebuilds shared + web,
  because the backup excludes `node_modules`/`.next`.

## PM2: delete, never reload

- The "Stop PM2 processes" step runs `pm2 delete` (NOT `reload`) on `ipodhan-web` and
  `ipodhan-scraper`. `pm2 reload` does NOT re-read `ecosystem.config.js`, so edits to
  `autorestart`/`cron_restart` would never take effect — and delete also releases the file
  handles that otherwise block `Remove-Item` ("being used by another process").
- The later "PM2 start" step MUST NOT `pm2 delete` again — see the next gotcha.

## The $ErrorActionPreference trap (PowerShell 5.1 + Actions)

PowerShell 5.1 under Actions runs with `ErrorActionPreference = Stop`, which turns a benign
pm2 stderr line (e.g. "Process not found") into a TERMINATING error that aborts the step —
leaving production with nothing started. Every step that calls `pm2` MUST set
`$ErrorActionPreference = 'Continue'` first, then gate on the real `$LASTEXITCODE` from
`pm2 start`. This applies to the start step, the backup step, and the rollback step.

## Health check + auto-rollback

The "Health check" step polls `http://localhost:3001` up to 10 times; on failure the
`if: failure()` "Rollback on failure" step restores the most recent backup.

## CRITICAL sub-convention — scraper feature flags live in TWO places

`ENABLE_GMP_NAME_MATCH`, `ENABLE_MONEYCONTROL_SUBSCRIPTION`, and `ENABLE_BSE_API` (and any
new scraper flag) MUST be present in BOTH the committed `ecosystem.config.js` AND the
`deploy.yml` inline "Create ecosystem.config.js" here-string. The deploy overwrites the
on-VPS config with its here-string, so a flag set only in the committed file is silently
turned OFF in production.

## CRITICAL RULES

- MUST set `$ErrorActionPreference = 'Continue'` before any `pm2` call in a deploy step; gate on `pm2 start`'s exit code.
- MUST use `pm2 delete` (not `reload`) so ecosystem `autorestart`/`cron_restart` edits take effect and file locks release.
- MUST duplicate every scraper feature flag in BOTH `ecosystem.config.js` and the `deploy.yml` here-string, or a deploy disables it.
- MUST keep `clean: false` checkout, the `.deploy-lockhash` skip, and the `/XD node_modules .next` prune-first-keep-1 backup intact.
- MUST keep injected secrets in GitHub Secrets only — never commit `web\.env.local` or `scraper\.env`.
