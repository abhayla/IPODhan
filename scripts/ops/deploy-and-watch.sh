#!/usr/bin/env bash
# T-501 — deploy-and-watch: dispatch + watch the prod deploy as ONE
# non-interactive command (.claude/rules/signal-ownership.md R7: "a deploy or
# a proof read with a window ... [is] executed by a command that does not
# wait for the session to be idle"). RCA: docs/reviews/rca-2026-09-07-missed-live-defects.md
# — the 20:30/21:00 session crons only fire when the session is IDLE, so a
# busy session pushed the 2026-09-07 prod deploy 90 minutes past its window
# (fired 22:29 instead of 20:30/21:00). This script removes that dependency:
# it is started with the harness's run-in-background (never a session-idle
# cron alone) so dispatch + watch always happen inside the 21:00-23:30 IST
# window regardless of what else the session is doing.
#
# Usage:
#   scripts/ops/deploy-and-watch.sh <date> <sha> [--rollback-to <prev-sha>]
#
#   <date>  the release branch date suffix: release/prod-<date>
#   <sha>   the exact commit the release branch HEAD must equal (refused
#           otherwise — never deploys a branch that moved since the brief)
#
# Behavior:
#   1. Refuses when origin/release/prod-<date>'s HEAD sha != <sha>.
#   2. Dispatches: gh workflow run deploy-linux.yml --ref release/prod-<date> -f slot=prod -f ref=<sha>
#   3. Watches: gh run watch <id> --exit-status
#   4. On completion (success or fail): greps the run log for the proof
#      lines (probe port / release_scraper_cycle_locks / Deploying /
#      rollback / migrat) and prints them.
#   5. Writes the run id to a state file (scripts/ops/state/last-deploy-run.json)
#      so a later step (or a human) can find it without re-listing runs.
#   6. On a FAILED run: exits non-zero and prints the rollback command,
#      using <prev-sha> if given via --rollback-to, else the previous
#      prod-* git tag's sha.
#
# Testing: scripts/tests/deploy-and-watch.test.sh runs this script with a
# fake `gh` shim on PATH and asserts the refuse/dispatch/watch/state/rollback
# contract above — no real GitHub Actions run.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${DEPLOY_WATCH_STATE_DIR:-$SCRIPT_DIR/state}"
STATE_FILE="$STATE_DIR/last-deploy-run.json"
WORKFLOW="deploy-linux.yml"

die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }

DATE="${1:-}"
SHA="${2:-}"
ROLLBACK_TO=""
shift 2 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --rollback-to) ROLLBACK_TO="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" 2 ;;
  esac
done

[ -n "$DATE" ] || die "usage: deploy-and-watch.sh <date> <sha> [--rollback-to <prev-sha>]" 2
[ -n "$SHA" ] || die "usage: deploy-and-watch.sh <date> <sha> [--rollback-to <prev-sha>]" 2

REF="release/prod-$DATE"

echo "==> checking origin/$REF sha == $SHA"
git -C "$REPO_ROOT" fetch origin "$REF" >/dev/null 2>&1 || die "fetch of origin/$REF failed" 1
ACTUAL_SHA="$(git -C "$REPO_ROOT" rev-parse --short "origin/$REF" 2>/dev/null)" \
  || die "origin/$REF does not exist" 1
# Compare on the shorter of the two lengths so a full sha vs short sha both work.
CMPLEN=${#SHA}
if [ "${#ACTUAL_SHA}" -lt "$CMPLEN" ]; then CMPLEN=${#ACTUAL_SHA}; fi
if [ "${ACTUAL_SHA:0:$CMPLEN}" != "${SHA:0:$CMPLEN}" ]; then
  die "release branch origin/$REF is at $ACTUAL_SHA, requested sha was $SHA — refusing (a stale brief or a moved branch)" 3
fi
echo "==> sha match: origin/$REF == $SHA"

echo "==> dispatching: gh workflow run $WORKFLOW --ref $REF -f slot=prod -f ref=$SHA"
gh workflow run "$WORKFLOW" --ref "$REF" -f slot=prod -f ref="$SHA" \
  || die "gh workflow run failed to dispatch" 1

echo "==> resolving run id"
RUN_ID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  RUN_ID="$(gh run list --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"
  [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] && break
  sleep 3
done
[ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] || die "could not resolve a run id for $WORKFLOW after dispatch" 1
echo "==> run id: $RUN_ID"

mkdir -p "$STATE_DIR"
cat > "$STATE_FILE" <<JSON
{"runId":"$RUN_ID","ref":"$REF","sha":"$SHA","workflow":"$WORKFLOW","dispatchedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
echo "==> wrote state file: $STATE_FILE"

echo "==> watching: gh run watch $RUN_ID --exit-status"
WATCH_RC=0
gh run watch "$RUN_ID" --exit-status || WATCH_RC=$?

echo "==> proof lines (grep of the run log):"
gh run view "$RUN_ID" --log 2>/dev/null | grep -E "probe port|release_scraper_cycle_locks|Deploying|rollback|migrat" || true

if [ "$WATCH_RC" -ne 0 ]; then
  ROLLBACK_SHA="$ROLLBACK_TO"
  if [ -z "$ROLLBACK_SHA" ]; then
    LAST_PROD_TAG="$(git -C "$REPO_ROOT" tag --sort=-creatordate --list 'prod-*' | head -1)"
    if [ -n "$LAST_PROD_TAG" ]; then
      # ^{commit} dereferences an ANNOTATED tag object to its commit; without
      # it, rev-parse on an annotated tag returns the tag object's own sha,
      # not the commit sha (a real bug caught by this script's own test).
      ROLLBACK_SHA="$(git -C "$REPO_ROOT" rev-parse --short "${LAST_PROD_TAG}^{commit}" 2>/dev/null)"
    fi
  fi
  echo "==> DEPLOY FAILED (run $RUN_ID, exit $WATCH_RC)" >&2
  if [ -n "$ROLLBACK_SHA" ]; then
    echo "==> rollback command: gh workflow run $WORKFLOW --ref $REF -f slot=prod -f ref=$ROLLBACK_SHA" >&2
  else
    echo "==> rollback command: gh workflow run $WORKFLOW --ref $REF -f slot=prod -f ref=<previous prod tag sha>  (no prior prod-* tag found)" >&2
  fi
  exit "$WATCH_RC"
fi

echo "==> DEPLOY SUCCEEDED (run $RUN_ID)"
exit 0
