---
name: pm2-scheduled-one-shot-scraper
description: >
  The two IPODhan PM2 apps run in deliberately OPPOSITE modes — ipodhan-web is a
  long-running cluster, ipodhan-scraper is a scheduled one-shot whose autorestart:false
  is load-bearing. Codifies why, so the next edit doesn't reintroduce the #2 restart storm.
globs: ["ecosystem.config.js", ".github/workflows/*.yml"]
version: "1.0.0"
synthesized: true
private: false
---

# PM2 Scheduled One-Shot Scraper

> **RETIRED 2026-08-21 (T-252) — HISTORICAL.** IPODhan no longer deploys to the Windows VPS.
> Serving moved to the Linux VPS `72.61.240.224` (`.github/workflows/deploy-linux.yml`), and
> `deploy.yml` + the four `vps-*.yml` workflows were moved to `.github/workflows-disabled/`.
> The Windows box is now the **database host only** (PostgreSQL 16 + AlgoChanakya's Redis).
> Keep this file as the record of how the retired path worked; do not follow it for new work.

## The two apps run in opposite modes — on purpose

`ecosystem.config.js` defines exactly two PM2 apps, and their modes are intentionally
asymmetric. Do NOT "normalize" them to look alike.

- **`ipodhan-web`** — the long-running site. `instances: 2`, `exec_mode: 'cluster'`,
  `PORT: 3001`, `autorestart: true`, `max_memory_restart: '500M'`. It SHOULD restart on
  crash; cluster mode load-balances the two workers. This is a normal always-on service.
- **`ipodhan-scraper`** — a SCHEDULED ONE-SHOT job. `exec_mode: 'fork'`, `instances: 1`,
  `autorestart: false`, `cron_restart: '*/30 * * * *'`. `scraper/src/index.ts` runs
  `--source=all`, scrapes once, and **exits**. PM2 re-fires it every 30 minutes via cron.

## autorestart:false is LOAD-BEARING (GitHub #2)

The scraper entrypoint exits cleanly after one pass. Under `autorestart: true` PM2 treats
that clean exit as a crash and restarts it **instantly** — producing a roughly 4-second
infinite restart loop that hammers the sources and the DB (GitHub issue #2). The
"PM2 scheduled-one-shot" pattern is the fix:

1. The process exits cleanly after one scrape.
2. `autorestart: false` means PM2 leaves it **stopped**, not relaunched.
3. `cron_restart: '*/30 * * * *'` re-fires it on schedule — the ONLY thing that should
   restart it.

- MUST keep `autorestart: false` on `ipodhan-scraper` whenever the entrypoint is the
  scrape-once-and-exit `src/index.ts`. MUST NOT add `autorestart: true` "to be safe".
- MUST NOT switch `ipodhan-scraper` to `cluster` mode — a one-shot fork is correct; a
  cluster of a self-exiting process is meaningless.
- The richer `src/scheduler/index.ts` (a self-managing long-running scheduler) is the only
  entrypoint for which `autorestart: true` would be correct — and only after its bit-rot is
  repaired. Until then, `--source=all` + cron + `autorestart:false` is the contract.

## The deploy regenerates this config — keep both copies honest

`.github/workflows/deploy.yml` has a "Create ecosystem.config.js" step that writes its OWN
inline here-string copy of this config onto the VPS, OVERWRITING the committed file. Any
mode change (autorestart, cron_restart, exec_mode, env flags) MUST be made in BOTH the
committed `ecosystem.config.js` AND the deploy.yml here-string, or the deploy silently
reverts it. Read-only diagnostics (`vps-status.yml`) and incident recovery
(`vps-recover.yml`) operate the apps by their exact names `ipodhan-web` / `ipodhan-scraper`.

## CRITICAL RULES

- MUST keep `ipodhan-scraper` as `exec_mode: 'fork'`, `autorestart: false`,
  `cron_restart: '*/30 * * * *'` — this is the scheduled-one-shot contract behind GitHub #2.
- MUST NOT set `autorestart: true` on the scraper while it runs the scrape-once `src/index.ts`
  entrypoint — it causes the ~4s infinite restart loop.
- MUST keep `ipodhan-web` as `cluster` / `instances: 2` / port 3001 / `autorestart: true`;
  do not collapse the two apps into one mode.
- MUST mirror ANY ecosystem mode/flag change into both the committed `ecosystem.config.js`
  and the `deploy.yml` "Create ecosystem.config.js" here-string.
