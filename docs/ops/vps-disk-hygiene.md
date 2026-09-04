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
| `HYGIENE_SKIP_SYSTEM` | unset | when set, skip journalctl/npm/pip/apt/Notifier steps (used by the test suite). Does NOT skip the `/tmp` sweep — see `HYGIENE_SKIP_TMP` (round 3, MAJOR-1) |
| `HYGIENE_SKIP_TMP` | unset | when set, skip the `/tmp` sweep only — a separate flag so the test suite can exercise the `/tmp` sweep in isolation without also touching journalctl/npm/pip/apt/Notifier for real |
| `HYGIENE_TMP_DIR` | `/tmp` | directory swept for 7-day-old files |
| `HYGIENE_NOTIFIER_URL` | `http://127.0.0.1:3300/notify` | Notifier POST endpoint — the test suite points this at an unroutable address as a second guard, independent of `HYGIENE_SKIP_SYSTEM` |
| `HYGIENE_LOCK_STALE_MIN` | `360` (6h) | how old the concurrency lock dir must be before a contending run reclaims it, regardless of whether the recorded PID is still alive |
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

## Concurrency lock (single-flight, self-healing)

A second run (cron overlap, a manual invocation) skips cleanly while the
first holds the lock (`mkdir`-based, `/var/lock/ipodhan-disk-hygiene.lock.d`
by default). The lock dir carries the holder's PID. If the process that
holds the lock died without cleaning up (SIGKILL, OOM), a later run
reclaims the lock instead of skipping forever — the trigger is either the
recorded PID no longer being alive (`kill -0` fails), or the lock dir being
older than `HYGIENE_LOCK_STALE_MIN` (default 6 hours) regardless of PID
liveness (covers PID reuse). Reclaiming is logged as a `WARN: reclaiming
stale lock` line and, on the next Notifier POST, is visible in the report's
`notes:` section if it also caused the prune to be skipped that run.

## Report notes / skip reasons

The final report (`echo`'d and sent to the Notifier) carries a `notes:`
section whenever the run did less than the full sweep — currently the only
producer is "release prune skipped: deploy in progress" when
`deploy_in_progress()` detects a `deploy-linux.sh` process mid-copy. Prod
and staging release counts in the report only count directories that match
the release-name pattern (`YYYYMMDD-HHMMSS-<sha>`) — a stray junk entry
under `releases/` never inflates "releases kept".

`deploy_in_progress()` requires the exact invocation shape
`deploy-linux.yml` uses (`bash scripts/deploy-linux.sh <staging|prod> [ref]`
— script path immediately followed by the slot word), never a bare mention
of the script name, and excludes its own process plus every ancestor
process from the match. A round-4 incident (2026-09-04) showed the bare
substring match matching an ANCESTOR shell's own command line (a `bash -n
scripts/deploy-linux.sh` syntax check) and silently skipping every prune.

## Notifier severity

- `info` — disk used < 70%
- `warning` — 70–80%
- `critical` — >= 80%

A Notifier POST failure is logged and does not fail the script (the sweep
still ran; only the page is missing).
