#!/usr/bin/env bash
# scripts/vps-prod-verify-cron.sh — T-294 (P2-4): runs the repo's own browser-level
# production verification (web/tests/e2e/production-verification.spec.ts) as a
# Linux VPS cron, because the GitHub Actions daily schedule for prod-verify.yml
# was deliberately removed (commit b5011df5, to save Actions minutes) and GH
# Actions billing is separately broken until 2026-09-01 — so a GH cron is not
# viable right now. This script is the interim live-site browser gate: it runs
# ON the box that already serves ipodhan.com (72.61.240.224), with its own
# dedicated checkout at /root/prod-verify-ipodhan/repo (kept fresh via `git pull`
# each run) — it does NOT touch /var/www/ipodhan (the actual deploy target) or
# any scraper/consolidation code.
#
# Alerting: on any failure, POSTs to the Notifier gateway (127.0.0.1:3300,
# project "ipodhan") with a dedupeKey scoped to the day, so a red run pages the
# owner once per day, not once per cron tick, until it goes green again.
#
# Revert to GitHub Actions cron (once Actions billing resumes, ~2026-09-01):
#   1. In .github/workflows/prod-verify.yml, uncomment/add back the `schedule:` block.
#   2. Remove this VPS crontab line: `crontab -l | grep -v vps-prod-verify-cron.sh | crontab -`
#   (Leaving both running is harmless — just double coverage — but the VPS cron
#   was only ever the fallback while GH cron was unavailable.)

set -uo pipefail

DIR="/root/prod-verify-ipodhan"
REPO="$DIR/repo"
STATE_DIR="$DIR/state"
DATE_TAG="$(date +%F)"
LOG="$STATE_DIR/run-$DATE_TAG.log"
NOTIFIER_ENV="/root/notifier/.env"

mkdir -p "$STATE_DIR"

# run_verify is a FUNCTION, not a brace group: `return` inside it ends only the
# function, so a `cd` failure or a red test run always falls through to the
# alert + log-retention logic below — nothing that happens inside here can
# terminate the whole script (a brace group's `exit` would; a function's
# `return` does not). This is the fix for the T-294 checker P1 finding: the
# old brace-group body ended in `exit $RESULT`, which is unreachable-after
# dead code because a redirected brace group is NOT a subshell.
run_verify() {
  echo "=== prod-verify VPS cron run: $(date -Iseconds) ==="

  if [[ -f "$NOTIFIER_ENV" ]]; then
    set -a; source "$NOTIFIER_ENV"; set +a
  fi

  cd "$REPO" || { echo "FATAL: repo checkout missing at $REPO"; return 1; }
  git fetch origin main --quiet
  git reset --hard origin/main --quiet
  echo "checked out: $(git log -1 --oneline)"

  cd "$REPO/web" || { echo "FATAL: web/ missing"; return 1; }

  # --ignore-scripts skips the root `prepare: husky` hook (no git-hook context
  # on this box); playwright chromium is installed explicitly next.
  npm ci --production=false --ignore-scripts --silent
  npx playwright install --with-deps chromium

  # CI=true makes the html reporter open:'never' (no blocking local report
  # server) and switches workers/retries to the CI-safe values in
  # playwright.config.ts — required for a non-interactive cron run.
  CI=true PROD_BASE_URL="https://ipodhan.com" npm run test:prod-verify
  local result=$?

  echo "=== exit code: $result ==="
  return "$result"
}

run_verify >> "$LOG" 2>&1
RESULT=$?

if [[ $RESULT -ne 0 ]]; then
  TAIL="$(tail -c 1500 "$LOG")"
  if [[ -n "${NOTIFIER_KEY_IPODHAN:-}" ]]; then
    PAYLOAD=$(python3 -c "
import json, sys
print(json.dumps({
  'project': 'ipodhan',
  'severity': 'P2',
  'title': 'prod-verify browser sweep FAILED',
  'body': sys.argv[1][-1200:],
  'type': 'prod-verify',
  'dedupeKey': 'prod-verify-' + sys.argv[2],
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
