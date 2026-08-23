#!/usr/bin/env bash
# scripts/vps-data-audit-cron.sh — T-297 (gap G3).
#
# WHY THIS EXISTS
# ---------------
# The repo has a genuinely good data-integrity gate: `audit-ipo-coverage.mjs
# --gate` holds the invisible-SME invariant (PR #181), duplicate detection,
# name-quality smells, stage-sliced completeness thresholds and nine substance
# checks. It was wired to NO npm script, NO CI workflow and NO cron — it ran
# only when a worker typed the path. `audit-prod.mjs` had an npm alias and no
# schedule either. Five consecutive review rounds each found data defects that
# these very checks describe, because nothing was running them.
#
# The 2026-08-23 discovery-coverage analysis calls that state "U" — automated
# but unscheduled — and names it the cheapest, most damaging gap in the matrix:
# a gate that is not scheduled is a document. See
# docs/data-quality/discovery-coverage.md §4.1 and §5.1 (G3).
#
# This script is the "U" -> "A" promotion. It is modelled line-for-line on the
# working scripts/vps-prod-verify-cron.sh (T-294), including the function-not-
# brace-group structure that the T-294 checker found was silently swallowing the
# alert path.
#
# WHAT IT RUNS
#   1. audit-ipo-coverage.mjs --gate   (DB invariants + substance; needs the DB)
#   2. audit-prod.mjs                  (live HTTP/API audit; needs no DB)
# Both are strictly read-only: SELECT-only SQL and GET requests. Neither writes
# to the database, Redis, or the filesystem outside this script's state dir.
#
# INSTALL (one manual step — a production mutation, so it is NOT done by the
# worker that authored this file):
#
#   mkdir -p /root/data-audit-ipodhan/state
#   git clone https://github.com/abhayla/IPODhan /root/data-audit-ipodhan/repo
#   crontab -e   # add, off-peak IST, staggered away from the 03:15 prod-verify:
#   45 3 * * * /root/data-audit-ipodhan/repo/scripts/vps-data-audit-cron.sh >> /root/data-audit-ipodhan/state/cron.log 2>&1
#
# The DB credentials are NOT stored here. The script sources the live prod env
# that already exists on the box (/var/www/ipodhan/shared/env/prod/web.env.local),
# which supplies DATABASE_HOST/PORT/NAME/USER/PASSWORD for the least-privilege
# `ipodhan_app` role. Nothing is copied and no secret is written to disk.
#
# ALERTING: any non-zero exit POSTs to the Notifier gateway (127.0.0.1:3300,
# project "ipodhan") with a day-scoped dedupeKey, so a red run pages the owner
# once per day rather than once per tick, until it goes green again.

set -uo pipefail

DIR="/root/data-audit-ipodhan"
REPO="$DIR/repo"
STATE_DIR="$DIR/state"
DATE_TAG="$(date +%F)"
LOG="$STATE_DIR/run-$DATE_TAG.log"
NOTIFIER_ENV="/root/notifier/.env"
PROD_ENV="/var/www/ipodhan/shared/env/prod/web.env.local"

mkdir -p "$STATE_DIR"

# run_audit is a FUNCTION, not a brace group. `return` inside it ends only the
# function, so a missing checkout or a red gate always falls through to the
# alert + log-retention logic below. A redirected brace group is NOT a subshell,
# so an `exit` in its body would make everything after it dead code — that exact
# bug disabled the prod-verify alert path until the T-294 checker caught it.
run_audit() {
  echo "=== data-audit VPS cron run: $(date -Iseconds) ==="

  if [[ -f "$NOTIFIER_ENV" ]]; then
    set -a; source "$NOTIFIER_ENV"; set +a
  fi

  if [[ -f "$PROD_ENV" ]]; then
    set -a; source "$PROD_ENV"; set +a
  else
    echo "FATAL: prod env not found at $PROD_ENV — cannot reach the database"
    return 1
  fi

  cd "$REPO" || { echo "FATAL: repo checkout missing at $REPO"; return 1; }
  git fetch origin main --quiet
  git reset --hard origin/main --quiet
  echo "checked out: $(git log -1 --oneline)"

  # --ignore-scripts skips the root `prepare: husky` hook (no git-hook context
  # on this box). Only `pg` is actually needed by the audit scripts.
  npm ci --production=false --ignore-scripts --silent

  local failed=0

  echo "--- [1/2] audit-ipo-coverage --gate (DB invariants + substance) ---"
  node scripts/audit-ipo-coverage.mjs --gate || { failed=1; echo "GATE FAILED: audit-ipo-coverage"; }

  echo "--- [2/2] audit-prod (live HTTP/API) ---"
  BASE_URL="https://ipodhan.com" node scripts/audit-prod.mjs || { failed=1; echo "GATE FAILED: audit-prod"; }

  echo "=== exit code: $failed ==="
  return "$failed"
}

run_audit >> "$LOG" 2>&1
RESULT=$?

if [[ $RESULT -ne 0 ]]; then
  TAIL="$(tail -c 1500 "$LOG")"
  if [[ -n "${NOTIFIER_KEY_IPODHAN:-}" ]]; then
    PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'project': 'ipodhan',
  'severity': 'P2',
  'title': 'data-integrity audit FAILED',
  'body': sys.argv[1][-1200:],
  'type': 'data-audit',
  'dedupeKey': 'data-audit-' + sys.argv[2],
}))
" "$TAIL" "$DATE_TAG")
    curl -s -m 15 -X POST "http://127.0.0.1:3300/notify" \
      -H "X-Api-Key: $NOTIFIER_KEY_IPODHAN" -H "Content-Type: application/json" \
      -d "$PAYLOAD" >> "$LOG" 2>&1
  else
    echo "NOTIFY-SKIP: NOTIFIER_KEY_IPODHAN not set" >> "$LOG"
  fi
fi

# Keep 30 days of logs
find "$STATE_DIR" -name 'run-*.log' -mtime +30 -delete

exit $RESULT
