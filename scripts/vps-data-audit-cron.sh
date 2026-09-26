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
#   1. audit-ipo-coverage.mjs --gate       (DB invariants + substance; needs the DB)
#   2. audit-prod.mjs                      (live HTTP/API audit; needs no DB)
#   3. audit-detection-floor.mjs --gate    (round-7 coverage floor; needs the DB)
#   4. audit-findings-to-issues.mjs        (recurrence loop part 2: sync tonight's
#                                            FAIL/UNVERIFIABLE findings to GitHub
#                                            issues; fail-open, never fails this cron)
#   5. assert-schema-drift.ts              (T-330: live DB vs schema.ts; needs the DB)
#   6. audit-reverse-sweep.mjs --gate      (#187/T-461: external chittorgarh.com
#                                            calendar vs our site -- catches an
#                                            IPO the market lists that we never
#                                            created; non-fatal, HTML-scrape dependency)
#   7. audit-alert-channel.mjs --gate      (#195 J1: weekly signal:noise on the
#                                            Notifier's own delivery log --
#                                            dominant-type/P1-share/self-
#                                            comparison; non-fatal on merge --
#                                            see the step's own comment for why)
# All of 1-3, 5, 6 and 7 are strictly read-only: SELECT-only SQL, GET requests,
# and a local file read of the Notifier's delivery log.
# Step 4 WRITES to GitHub (issues) but never to the database, Redis, or the
# local filesystem outside this script's state dir.
#
# INSTALL (one manual step — a production mutation, so it is NOT done by the
# worker that authored this file):
#
#   mkdir -p /root/data-audit-ipodhan/state
#   git clone https://github.com/abhayla/IPODhan /root/data-audit-ipodhan/repo
#   chmod +x /root/data-audit-ipodhan/repo/scripts/vps-data-audit-cron.sh
#   crontab -e   # add, off-peak IST, staggered away from the 03:15 prod-verify:
#   45 3 * * * /bin/bash /root/data-audit-ipodhan/repo/scripts/vps-data-audit-cron.sh >> /root/data-audit-ipodhan/state/cron.log 2>&1
#
# NOTE the leading `/bin/bash` - it is NOT cosmetic (T-335C checker finding).
# This script's own `git reset --hard origin/main` restores the file's TRACKED
# mode on every run. While that tracked mode was 100644, the script ran once,
# reset its own bit back to 0644, and every later cron tick died with
# "/bin/sh: Permission denied" - the audit silently disabled itself and nobody
# was paged, because cron's failure never reaches the alert path inside the
# script. The tracked mode is 100755 now, but invoking through `bash` makes the
# executable bit no longer load-bearing, so ANY future mode drift self-heals.
# Applied on the box 2026-08-26 (one-time chmod +x plus the crontab rewrite) and
# proven with the file deliberately left at 0644: the crontab command ran the
# full audit to completion. Evidence:
# GetWorkDone/evidence/2026-08-26-T-335/fix-round-1/box-bootstrap-proof.log
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

# Overridable via env for scripts/tests/vps-cron-reexec.test.sh (#348) — the
# production default (no env vars set) is byte-for-byte what it always was.
DIR="${DATA_AUDIT_DIR:-/root/data-audit-ipodhan}"
REPO="${DATA_AUDIT_REPO:-$DIR/repo}"
STATE_DIR="${DATA_AUDIT_STATE_DIR:-$DIR/state}"
NOTIFIER_ENV="${DATA_AUDIT_NOTIFIER_ENV:-/root/notifier/.env}"
PROD_ENV="${DATA_AUDIT_PROD_ENV:-/var/www/ipodhan/shared/env/prod/web.env.local}"
# #687 slice 2: VPS clock is UTC but the nightly run fires 02:00-03:45 IST
# (still the previous UTC day) -- use the IST calendar day, not the host clock,
# so the floor state file and run log land on the day the run actually happened in IST.
# IST is UTC+5:30 with no DST, computed here by fixed-offset arithmetic on the
# epoch second (never `TZ=Asia/Kolkata date`) so it needs no /usr/share/zoneinfo
# tzdata on the host -- mirrors scripts/lib/ist-day.mjs.
DATE_TAG="$(date -u -d "@$(( $(date +%s) + 19800 ))" +%F)"
LOG="$STATE_DIR/run-$DATE_TAG.log"

mkdir -p "$STATE_DIR"

# #348 fix — RCA: run_audit() below is a bash FUNCTION, and bash parses a
# function's body exactly once, when this script starts. The old code did
# `git fetch` + `git reset --hard origin/main` INSIDE run_audit(), so by the
# time that reset landed a new script body on disk, this already-running
# process was executing the OLD body from memory — the reset only took
# effect on the FOLLOWING cron tick, one night late.
#
# Class: every future change to this file — new steps, fixed flags, notifier
# changes — must take effect the SAME night it merges to main, not the next
# one. This block fixes the class, not one instance, because it runs before
# ANY of run_audit's logic is parsed.
#
# Fix: fetch + reset happen HERE, before run_audit is even defined, then the
# process re-execs itself once (`exec bash "$0" "$@"`) so bash re-parses this
# file from disk with tonight's content. DATA_AUDIT_REEXECED guards against a
# re-exec loop.
#
# If the fetch or reset fails (network blip, GitHub outage, a bad checkout),
# the audit is NOT skipped: the currently checked-out copy runs as-is and a
# WARN line names the cause, so a transient git failure never costs a night
# of the audit outright — it only risks one more night of staleness, which is
# exactly the failure mode this fix exists to shrink from "always" to "rare".
if [[ -z "${DATA_AUDIT_REEXECED:-}" ]]; then
  REEXEC_WARN=""
  if [[ -d "$REPO/.git" ]]; then
    if ! FETCH_ERR="$(git -C "$REPO" fetch origin main --quiet 2>&1)"; then
      REEXEC_WARN="git fetch failed: ${FETCH_ERR:-no output}"
    elif ! RESET_ERR="$(git -C "$REPO" reset --hard origin/main --quiet 2>&1)"; then
      REEXEC_WARN="git reset --hard failed: ${RESET_ERR:-no output}"
    fi
  else
    REEXEC_WARN="no .git checkout found at $REPO"
  fi
  if [[ -n "$REEXEC_WARN" ]]; then
    echo "WARN: #348 pre-reexec fetch/reset skipped ($REEXEC_WARN) — running the currently checked-out copy of $0, it may be one night stale" >> "$LOG" 2>&1
  fi
  export DATA_AUDIT_REEXECED=1
  exec bash "$0" "$@"
fi

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
  # #348: fetch + reset already happened ONCE, at the very top of this file,
  # before run_audit() was even parsed (see the re-exec block above this
  # function). Removed here rather than kept as a no-op safety net — this
  # process is already running the freshly-reset tree by construction (it IS
  # the re-exec'd process, or the fetch/reset failed and it deliberately fell
  # through to run the on-disk copy as-is), so a second fetch+reset here would
  # be a redundant network call, not an extra safety margin.
  #
  # Detection (the issue's own idea, #348): print the checked-out sha and this
  # script's OWN step count at the start of every run, so a stale run — one
  # still running an old body after a merge — is visible directly in the log
  # rather than needing a second tool to notice.
  STEP_COUNT="$(grep -c '^  echo "--- \[' "$0")"
  echo "checked out: $(git log -1 --oneline) ($STEP_COUNT audit steps in this script)"

  # --ignore-scripts skips the root `prepare: husky` hook (no git-hook context
  # on this box). Only `pg` is actually needed by the audit scripts.
  npm ci --production=false --ignore-scripts --silent

  local failed=0

  echo "--- [1/5] audit-ipo-coverage --gate (DB invariants + substance) ---"
  node scripts/audit-ipo-coverage.mjs --gate || { failed=1; echo "GATE FAILED: audit-ipo-coverage"; }

  echo "--- [2/5] audit-prod (live HTTP/API) ---"
  BASE_URL="https://ipodhan.com" node scripts/audit-prod.mjs || { failed=1; echo "GATE FAILED: audit-prod"; }

  # T-335: the fresh-review coverage floor, promoted to FAIL-level checks —
  # live-IPO cross-source conflicts, issue_size/lot-band plausibility, a full
  # API route sweep, conflict-noise ratio, per-type freshness, pm2 env/log
  # health, scheduler wire-or-retire, and the P3 gates (sector %, cron exec
  # bit, dead-source retire-by). It sends its OWN Notifier pages: ONE DIGEST
  # per check per night (dedupeKey = detection-floor-<check>-<date>), P1 only
  # when a check has rows that are new versus the previous run, plus a P2 page
  # for every UNVERIFIABLE check. It needs NOTIFIER_KEY_IPODHAN, already
  # sourced above from $NOTIFIER_ENV.
  #
  # Exit codes: 0 clean, 1 a check FAILed, 3 no FAIL but at least one check was
  # UNVERIFIABLE (the audit was BLIND tonight, not green - it still pages and
  # still fails this cron run), 2 the audit crashed.
  # T-497 (signal-ownership.md R3): tee this step's own [FAIL]/[PASS] lines to
  # ONE fixed path per night, separate from the combined run-<date>.log (which
  # mixes in steps 1/2/4/5/6 and gets overwritten if the cron runs twice in a
  # day). scripts/ops/floor-delta.mjs reads two of these files to diff tonight
  # against last night — a nightly signal with no consumer that diffs it is,
  # per that rule, no detection at all. `tee -a` (append) is deliberate: if
  # this step ever runs twice in one calendar day the second run's lines
  # accumulate rather than clobbering the first, and floor-delta's [FAIL]/
  # [PASS] parser is keyed by check id so a duplicate line changes nothing.
  mkdir -p "$STATE_DIR/floor"
  echo "--- [3/5] audit-detection-floor --gate (round-7 coverage floor) ---"
  BASE_URL="https://ipodhan.com" node scripts/audit-detection-floor.mjs --gate | tee -a "$STATE_DIR/floor/$DATE_TAG.txt"
  DF_CODE=${PIPESTATUS[0]}
  case "$DF_CODE" in
    0) ;;
    3) failed=1; echo "GATE BLIND: audit-detection-floor exited 3 - at least one check was UNVERIFIABLE (not a pass)" ;;
    *) failed=1; echo "GATE FAILED: audit-detection-floor exited $DF_CODE" ;;
  esac

  # Recurrence loop part 2 (T-added 2026-09-06): sync tonight's FAIL/UNVERIFIABLE
  # findings (written by step 3 above to <STATE_DIR>/findings-latest.json) to
  # GitHub issues — one issue per check, commented only when the failing rows
  # change, closed automatically when the check goes back to PASS. This step is
  # FAIL-OPEN BY DESIGN: `|| true` means a missing `gh`, a revoked login, or a
  # network error can never turn a green (or already-alerted) audit run into a
  # failed cron run — the script itself already prints `ISSUES-SKIP: <reason>`
  # and exits 0 in every one of those cases (see its own header comment).
  #
  # DEFAULT IS DRY-RUN. Without this, the very first cron tick on a fresh box
  # (nothing set AUDIT_ISSUES_DRY_RUN) would file every currently-FAILing check
  # as a real GitHub issue in one shot — ~17 issues on night one, against every
  # reviewer's recommendation to prove this on the box before trusting it with
  # real issue creation. Live mode is opt-in via a marker file, not an env var
  # nobody sets: it stays dry-run until `touch $STATE_DIR/issues-live` (i.e.
  # `touch /root/data-audit-ipodhan/state/issues-live`). AUDIT_ISSUES_DRY_RUN=1
  # still forces dry-run even once the marker exists (env override always wins).
  echo "--- [4/5] audit-findings-to-issues (nightly findings -> GitHub issues) ---"
  if [[ ! -f "$STATE_DIR/issues-live" ]]; then
    echo "ISSUES-DRY-RUN: no $STATE_DIR/issues-live marker; touch it to go live"
    AUDIT_ISSUES_DRY_RUN=1 node scripts/audit-findings-to-issues.mjs || true
  else
    # T-497 (contract DoD item 3): once live, file NEW-only, not every SAME
    # finding again every night — that is what turned the nightly audit into
    # a standing wall of red nobody read (RC1, docs/reviews/rca-2026-09-07-
    # missed-live-defects.md). Going live at all is still gated by the
    # issues-live marker above; the --new-only flip is the OWNER's decision,
    # made 2026-09-08 (T-505 owner decision 3): once live, file only NEW
    # findings, not every SAME finding again every night.
    node scripts/audit-findings-to-issues.mjs --new-only || true
  fi

  # T-330: read-only schema-drift check — compares the live column/matview set
  # against packages/shared/src/db/schema.ts. Catches the class where a
  # migration is journaled as applied but the live DDL never actually matched
  # (ipo_scores.algorithm_version varchar(10) vs SSOT varchar(50); calendar_view
  # never created) between deploys, e.g. after an out-of-band manual DB change.
  # #665: SCHEMA_DRIFT_CHECK_UNDECLARED=1 adds the reverse direction (a live
  # index/unique constraint schema.ts never declares, e.g. ipos_symbol_key) —
  # opted in here, and only here, because pr-gate.yml's ephemeral CI database
  # and deploy-linux.sh have not been verified clean of the same pre-existing
  # drift (see assert-schema-drift.ts main()'s comment on this flag).
  echo "--- [5/6] assert-schema-drift (live DB vs schema.ts, both directions) ---"
  SCHEMA_DRIFT_CHECK_UNDECLARED=1 npx tsx scripts/assert-schema-drift.ts || { failed=1; echo "GATE FAILED: assert-schema-drift"; }

  # #187 (T-461), g_reverse_sweep: the reverse sweep (external chittorgarh.com
  # calendar -> is this IPO visible on our site). Wired NON-FATAL like step 4
  # (audit-findings-to-issues) deliberately: it depends on chittorgarh.com's
  # public HTML shape staying stable (a scrape-parsing dependency, not a DB
  # invariant), and this cron script itself carries the one-night-lag class
  # (#348 -- a change to THIS file only takes effect the run after it lands,
  # because run_audit() is defined once and bash keeps the old function body
  # for the remainder of a tick that already started). `|| true` means a
  # chittorgarh.com HTML-shape change can never turn a green data-integrity
  # night into a failed cron run; its own exit code (0/1/3/2) is still
  # printed to the log for a human to read.
  echo "--- [6/7] audit-reverse-sweep --gate (external market calendar vs our site, #187) ---"
  BASE_URL="https://ipodhan.com" node scripts/audit-reverse-sweep.mjs --gate || echo "NON-FATAL: audit-reverse-sweep exited $? (see docs/reviews/detection-checks.json:g_reverse_sweep)"

  # #195 J1: alert-channel signal:noise, weekly. Reads the Notifier's own
  # delivery log directly off this box's local disk (this cron already runs
  # on the SAME host as the Notifier, 72.61.240.224 — no SSH, no copy).
  # WIRED NON-FATAL: this is a brand-new check running for the first time
  # against real production alert history, and it is EXPECTED to be red on
  # night one (the trailing-7-day P1 share measured 2026-09-26 was 32.1%,
  # over the 20% cap — a real, pre-existing condition, not a bug in the
  # check). Per the defect-fix contract, a new check must prove itself on
  # real data before it can turn the nightly audit red; --gate is kept so a
  # future promotion to fatal is a one-line flip once the P1 share is back
  # under the cap. `|| true` is deliberate here, same shape as step 6.
  echo "--- [7/7] audit-alert-channel --gate (#195 J1: alert signal:noise, weekly) ---"
  DELIVERY_LOG_PATH="${DATA_AUDIT_DELIVERY_LOG:-/root/notifier/state/delivery-log.jsonl}" \
    node scripts/audit-alert-channel.mjs --gate || echo "NON-FATAL: audit-alert-channel exited $? (see #195)"

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
