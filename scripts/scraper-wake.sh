#!/usr/bin/env bash
# scripts/scraper-wake.sh — item 7 part B. The thing that wakes the scraper.
#
# WHY THIS EXISTS
# ---------------
# Until now the scraper was woken by PM2's own `--cron-restart="*/30 * * * *"`,
# set by scripts/deploy-linux.sh. PM2's cron_restart does not mean "run it if
# it is idle" — it means RESTART, and restarting an online process is a kill.
# Every 30 minutes, whatever the scraper was doing was killed. That is why the
# extraction budget had to fit inside 30 minutes, and why a document extraction
# that needed longer could never finish (the owner's "no job ever kills a
# running cycle" rule, OD-19 §2.1).
#
# There is no PM2 flag that turns cron_restart into "skip if busy". So the
# cron moves out of PM2 and into the OS crontab, and every cron line calls this
# wrapper instead. The wrapper starts a cycle only if one is not already
# running. It NEVER kills anything — not a signal, not `pm2 restart`, not
# `pm2 stop`, not `pm2 delete`. That is the whole point of it.
#
# `pm2 start <name>` is deliberate and load-bearing: on an app that is already
# online, `pm2 start` refuses and leaves the running process alone, while
# `pm2 restart` would kill and relaunch it. Even if the status check below
# raced, `start` cannot kill a cycle.
#
# The AUTHORITATIVE skip is not here — it is the Redis cycle lock inside the
# scraper (scraper/src/index.ts, CYCLE_LOCK_RESOURCE), which logs "previous
# cycle still running ... exiting 0 without doing anything". This wrapper only
# saves a wasted node process in the common case, so when it cannot tell what
# the status is, it FAILS OPEN and starts: the lock is what makes overlap safe.
#
# USAGE (from the crontab — see scripts/scraper-wake.crontab and the recipe in
# docs/ops/prod-ops-recipes.md):
#
#   /bin/bash /root/ipodhan/current-prod/scripts/scraper-wake.sh <job>
#
#   <job> is one of: data | live | documents | closed | gmp
#          (scraper/src/scheduler/job-membership.ts is the SSOT for the set
#           and for which steps each one runs)
#
# Environment:
#   DEPLOY_SLOT       prod | staging (default prod) — picks the pm2 app name
#   PM2_SCRAPER_APP   explicit pm2 app name, wins over DEPLOY_SLOT
#   PM2_BIN           path to pm2 (default: pm2 on PATH)
#   NODE_BIN          path to node, used only to parse `pm2 jlist` (default: node)

set -uo pipefail

VALID_JOBS="data live documents closed gmp"

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] scraper-wake: $*"; }

job="${1:-}"
if [ -z "$job" ]; then
  log "FATAL: no job given. usage: scraper-wake.sh <$(echo "$VALID_JOBS" | tr ' ' '|')>"
  exit 2
fi

job_ok=0
for candidate in $VALID_JOBS; do
  [ "$job" = "$candidate" ] && job_ok=1
done
if [ "$job_ok" -ne 1 ]; then
  # Loud, not fail-open: a typo'd job name must not become "run everything".
  log "FATAL: unknown job '$job' (expected one of: $VALID_JOBS)"
  exit 2
fi

SLOT="${DEPLOY_SLOT:-prod}"
if [ "$SLOT" = "prod" ]; then
  APP="${PM2_SCRAPER_APP:-ipodhan-scraper}"
else
  APP="${PM2_SCRAPER_APP:-ipodhan-scraper-$SLOT}"
fi
PM2_BIN="${PM2_BIN:-pm2}"
NODE_BIN="${NODE_BIN:-node}"

# --- is a cycle already running? -------------------------------------------
# Any failure here (pm2 missing, malformed jlist, no node) yields "unknown",
# which starts the wake. See the fail-open note in the header.
status="unknown"
jlist_json="$("$PM2_BIN" jlist 2>/dev/null)" || jlist_json=""
if [ -n "$jlist_json" ]; then
  parsed="$(printf '%s' "$jlist_json" | "$NODE_BIN" -e '
    let s = "";
    process.stdin.on("data", (d) => { s += d; });
    process.stdin.on("end", () => {
      let apps = [];
      try { apps = JSON.parse(s); } catch { apps = []; }
      if (!Array.isArray(apps)) apps = [];
      const app = apps.find((a) => a && a.name === process.argv[1]);
      const st = app && app.pm2_env && app.pm2_env.status;
      process.stdout.write(typeof st === "string" && st ? st : "unknown");
    });
  ' "$APP" 2>/dev/null)" || parsed=""
  [ -n "$parsed" ] && status="$parsed"
fi

if [ "$status" = "online" ]; then
  # NOT a kill, NOT a queue — the previous cycle keeps its full budget and this
  # wake simply does not happen. The next cron line is the retry.
  log "skip: previous cycle still active (app=$APP status=online job=$job)"
  exit 0
fi

log "start: job=$job app=$APP status=$status"
if SCRAPER_JOB="$job" "$PM2_BIN" start "$APP" --update-env; then
  exit 0
fi

# `pm2 start` on an app that went online between the check and the start also
# lands here (pm2 exits non-zero with "already launched"). That is the race the
# fail-open design accepts, and it is harmless: nothing was killed.
log "WARN: pm2 start failed for $APP (job=$job) — nothing was killed; the next cron line retries"
exit 1
