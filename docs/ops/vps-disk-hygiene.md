# VPS disk hygiene (W-134)

Standing weekly cron that keeps the production VPS disk from filling up.
`scripts/deploy-linux.sh` only prunes old releases for the slot it just
deployed, at the end of a deploy — nothing sweeps the *other* slot, npm/pip
caches, `/tmp`, or stray venv build dirs on a week with no deploy. That gap
is what filled the disk to 74% on 2026-09-04 (11 release folders at ~3 GB
each, a stale 3.1 GB build dir, 0.7 GB of journal). `scripts/vps-disk-hygiene.sh`
is the missing weekly sweep.

## What it does

1. Prunes `releases/` (prod) beyond the newest 3, and `releases-staging/`
   beyond the newest 2 — oldest first, same slot-safe rules as the deploy
   script's own prune (never removes the release `current`/`current-staging`
   points at; only touches directories whose name matches the
   `YYYYMMDD-HHMMSS-<sha>` pattern, only under `/var/www/ipodhan/releases*/`).
2. `journalctl --vacuum-size=200M`.
3. `npm cache clean --force` only if `/root/.npm` exceeds 2 GB (otherwise
   just reports its size); `python3 -m pip cache purge` only if the pip
   cache exceeds 500 MB; `apt-get clean`.
4. Deletes files (never directories) under `/tmp` older than 7 days.
5. Removes stale venv build dirs `shared/venv/*.new` and `*.old` older than
   1 day (the artifacts of a build that failed mid-swap).
6. Prints a report (disk used %, free GB, prod/staging release counts, MB
   freed, largest 5 dirs under `/root` and `/var/www`) and POSTs it to the
   Notifier gateway.

Every deletion goes through a path guard (mirrors `deploy-linux.sh`'s
`safe_rm_venv_dir()`): refuses `..`, refuses anything outside the one
allowed root for that class of deletion, and — for release dirs — refuses
any name that doesn't match the release-dir pattern. It never deletes the
`current`/`current-staging` target.

## Cron

```
17 4 * * 0 /var/www/ipodhan/current/scripts/vps-disk-hygiene.sh >> /var/log/ipodhan-disk-hygiene.log 2>&1
```

Sunday 04:17 IST — low-traffic, offset from the top of the hour so it
doesn't collide with other crons. Runs as root (needed to read `/root/.npm`,
`/root/.cache/pip`, and run `apt-get clean`/`journalctl --vacuum-size`).

## Dry run

```bash
scripts/vps-disk-hygiene.sh --dry-run   # prints what would be removed, deletes nothing, exits 0
scripts/vps-disk-hygiene.sh --report    # prints only the final report
```

## Env overrides

| Var | Default | Meaning |
|---|---|---|
| `HYGIENE_ROOT` | `/var/www/ipodhan` | deploy root; `releases*/` live under this |
| `HYGIENE_KEEP_PROD` | `3` | releases to keep for the prod slot |
| `HYGIENE_KEEP_STAGING` | `2` | releases to keep for the staging slot |
| `HYGIENE_SKIP_SYSTEM` | unset | when set, skip journalctl/npm/pip/apt/`/tmp`/Notifier steps entirely (used by the test suite) |
| `HYGIENE_TMP_DIR` | `/tmp` | directory swept for 7-day-old files |
| `NOTIFIER_ENV` | `/root/notifier/.env` | sourced for `NOTIFIER_KEY_IPODHAN` |

The deploy script's own per-slot retention default also changed alongside
this (W-134): prod keeps 3 releases, staging keeps 2 (`DEPLOY_KEEP_RELEASES`
still overrides either slot for a one-off deploy).

## Folders that are NOT junk — do not add to the sweep without checking first

- `/root/prod-verify-ipodhan`, `/root/data-audit-ipodhan` — checkouts used by
  the daily `vps-prod-verify-cron.sh` / `vps-data-audit-cron.sh` crons.
- `/root/.cache/puppeteer`, `/root/.cache/ms-playwright` (or wherever the
  Playwright/Puppeteer browser cache lands) — browser binaries the scraper
  and E2E crons need; re-downloading them on every run is far more
  expensive than the disk they hold.
- `/home/deploy/actions-runner` — the BestDematAccount GitHub Actions
  self-hosted runner; unrelated to IPODhan's own deploy.
- `/opt/actions-runner-ipodhan` — IPODhan's own self-hosted Actions runner
  (`linux-vps-ipodhan`); deleting this breaks CI/deploy.

## Notifier severity

- `info` — disk used < 70%
- `warning` — 70–80%
- `critical` — >= 80%

A Notifier POST failure is logged and does not fail the script (the sweep
still ran; only the page is missing).
