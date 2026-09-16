#!/usr/bin/env bash
# Fires one staging window deploy from the VPS's own root crontab.
#
# Why this exists (owner standing rule 2026-09-16, "staging deploys in
# windows, not per merge"): GitHub's `schedule` trigger was measured
# unreliable on this repo's Actions setup (see .github/workflows/
# deploy-linux.yml header, slice s17 -> s20 history) - it never fired.
# The reliable timer is the box's own crontab, already used for
# scripts/scraper-wake.sh (item 7 slice 1, #660) and the vps-*-cron.sh
# family. This script is that timer's payload: it asks GitHub to run
# deploy-linux.yml with mode=window, then gets out of the way. It never
# waits for the run - the workflow's own decide/deploy jobs, Notifier
# alert-on-failure step and DEPLOYED_SHA file are the source of truth for
# whether the deploy actually happened.
#
# Runs as root on the VPS via cron. Requires `gh` on PATH, already
# authenticated as abhayla (the same identity the deploy runner itself
# uses to talk to GitHub).
#
# Usage:
#   staging-window-deploy.sh            # dispatch for real
#   staging-window-deploy.sh --dry-run  # print the exact gh command, exit 0

set -euo pipefail

LOG_FILE="${STAGING_WINDOW_LOG:-/var/log/ipodhan-staging-window.log}"
REPO="${STAGING_WINDOW_REPO:-abhayla/IPODhan}"
GH_BIN="${GH_BIN:-gh}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "FATAL: unknown argument '$arg' (only --dry-run is accepted)" >&2
      exit 2
      ;;
  esac
done

GH_CMD=("$GH_BIN" workflow run deploy-linux.yml --repo "$REPO" --ref main -f slot=staging -f mode=window)

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "${GH_CMD[*]}"
  exit 0
fi

log() {
  local stamp
  stamp="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "[$stamp] $1" >> "$LOG_FILE"
}

notify_failure() {
  local reason="$1"
  if [ -z "${NOTIFIER_URL:-}" ] || [ -z "${NOTIFIER_KEY:-}" ]; then
    log "WARNING: NOTIFIER_URL/NOTIFIER_KEY not set - cannot page the owner about a failed window dispatch (see runner .env setup in GLOBAL.md section 2)."
    return 0
  fi
  local body
  body="$(node -e '
    const [reason] = process.argv.slice(1);
    process.stdout.write(JSON.stringify(`staging-window-deploy.sh failed to dispatch deploy-linux.yml: ${reason}`));
  ' "$reason" 2>/dev/null || printf '"%s"' "staging-window-deploy.sh dispatch failed")"
  local response
  response="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "${NOTIFIER_URL%/}/notify" \
    -H 'Content-Type: application/json' \
    -H "X-Api-Key: ${NOTIFIER_KEY}" \
    --max-time 5 \
    -d "{\"project\":\"ipodhan\",\"severity\":\"P2\",\"title\":\"staging window dispatch failed\",\"body\":${body},\"type\":\"deploy\",\"dedupeKey\":\"staging-window-deploy-failed-$(date -u '+%Y-%m-%dT%H:%M')\"}" 2>/dev/null || echo "curl-failed")"
  log "Notifier /notify HTTP status: $response"
}

log "dispatching: ${GH_CMD[*]}"
if "${GH_CMD[@]}" >>"$LOG_FILE" 2>&1; then
  log "dispatch OK (exit 0)"
  exit 0
else
  rc=$?
  log "dispatch FAILED (exit $rc)"
  notify_failure "gh workflow run exited $rc - see $LOG_FILE"
  exit "$rc"
fi
