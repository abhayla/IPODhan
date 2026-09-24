#!/usr/bin/env bash
#
# Regression guard for scripts/scraper-wake.sh (item 7 slice 1, 2026-09-16).
#
# WHY THIS SUITE EXISTS: this wrapper replaced pm2's --cron-restart, which was
# the only thing bounding a hung scraper on prod. Both of its guards fail
# SILENTLY when they break:
#
#   - a lock-skip that stops printing its reason line is indistinguishable
#     from a wake that never fired (signal-ownership.md R1);
#   - a ceiling that stops firing looks exactly like a job that is still
#     working, for as long as the job keeps not returning.
#
# Neither announces itself in production, so every branch is pinned here.
#
# The suite drives the REAL script (never a re-implementation) through two
# seams the script defines for exactly this purpose:
#   SCRAPER_WAKE_FAKE_LOCK_TTL - the lock reading, without a Redis
#   SCRAPER_WAKE_CMD           - the job process, without a scraper
#   SCRAPER_CEILING_SECONDS    - the ceiling, so a 2-hour bound is testable
#                                in a second or two
#
# Usage: bash scripts/tests/scraper-wake.test.sh
# Exit 0 = every case behaves; exit 1 = at least one case failed.

set -uo pipefail

# Review round 5, item D: the wrapper now REFUSES to run when DEPLOY_SLOT is
# unset AND its own path matches neither */current nor */current-staging
# (this repo checkout, or any CI/dev sandbox, matches neither). Every
# PRE-EXISTING case in this suite is testing something else entirely (lock
# handling, the ceiling, venv resolution) and is not about slot resolution,
# so DEPLOY_SLOT is set once here -- exactly what every case already
# implicitly assumed before this feature existed (the wrapper used to default
# silently to "prod"). Case 18 (below) is the ONLY case that unsets/varies it
# on purpose, to test slot resolution itself.
export DEPLOY_SLOT=prod

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAKE="$SCRIPT_DIR/../scraper-wake.sh"
DEPLOY_SCRIPT="$SCRIPT_DIR/../deploy-linux.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

if [ ! -f "$WAKE" ]; then
  echo "FAIL: wrapper not found at $WAKE" >&2
  exit 1
fi

# Fake job processes. SCRAPER_WAKE_CMD takes a PATH to an executable (not a
# command line), so each shape the suite needs gets its own tiny script.
FIXDIR="$(mktemp -d)"
trap 'rm -rf "$FIXDIR"' EXIT

printf '%s\n' '#!/bin/sh' 'echo THE_JOB_RAN' 'exit 0' > "$FIXDIR/job-ok.sh"
printf '%s\n' '#!/bin/sh' 'echo THE_JOB_RAN' 'sleep 60' > "$FIXDIR/job-hang.sh"
printf '%s\n' '#!/bin/sh' 'echo THE_JOB_RAN' 'exit 3' > "$FIXDIR/job-crash.sh"
chmod +x "$FIXDIR"/job-*.sh

# The script must be POSIX sh, not bash — the deploy host runs it
# non-interactively under /bin/sh (dash on Debian/Ubuntu). A bashism here is a
# production-only failure that never shows up on a dev box.
if sh -n "$WAKE" 2>/tmp/wake-shn.log; then
  pass "case 0: the wrapper parses under POSIX sh"
else
  fail "case 0: the wrapper does not parse under sh (a bashism would break it on the deploy host)"
  cat /tmp/wake-shn.log
fi
if command -v dash >/dev/null 2>&1; then
  if dash -n "$WAKE" 2>/tmp/wake-dash.log; then
    pass "case 0b: the wrapper parses under real dash"
  else
    fail "case 0b: the wrapper does not parse under dash"
    cat /tmp/wake-dash.log
  fi
fi

# --- Case 0c: the wrapper is committed EXECUTABLE ---------------------------
# pm2 starts this script directly (`pm2 start scripts/scraper-wake.sh`), so a
# non-executable mode in the index is a deploy-time failure that no amount of
# local `bash scraper-wake.sh` testing would ever surface - the suite runs it
# through an explicit interpreter, production does not.
MODE="$(cd "$SCRIPT_DIR/../.." && git ls-files -s scripts/scraper-wake.sh 2>/dev/null | awk '{print $1}')"
if [ "$MODE" = "100755" ]; then
  pass "case 0c: scraper-wake.sh is committed executable (100755) - pm2 can start it"
elif [ -z "$MODE" ]; then
  fail "case 0c: scraper-wake.sh is not tracked by git - cannot verify its committed mode"
else
  fail "case 0c: scraper-wake.sh is committed as $MODE, not 100755 - pm2 start would fail on the deploy host"
fi

# --- Case 1: lock HELD -> skip, with a reason line, exit 0 -----------------
# The skip line is the proof artifact. Asserted on three things, not one:
# that it skipped, that it said WHY, and that it named the lock key and the
# remaining TTL (an identity + a number, never a bare "skipped").
OUT1="$(SCRAPER_WAKE_FAKE_LOCK_TTL="900" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        sh "$WAKE" data 2>&1)"
ST1=$?
if [ "$ST1" -eq 0 ]; then
  pass "case 1: a wake on a held lock exits 0 (a skip is a correct outcome, not a failure)"
else
  fail "case 1: a wake on a held lock exited $ST1, expected 0"
fi
if printf '%s' "$OUT1" | grep -qF 'wake-skipped'; then
  pass "case 1: the skip prints its greppable token (wake-skipped)"
else
  fail "case 1: no wake-skipped line — a silent skip is indistinguishable from a wake that never fired"
  printf '%s\n' "$OUT1"
fi
if printf '%s' "$OUT1" | grep -qF 'lock_key=lock:resource:scraper:cycle'; then
  pass "case 1: the skip line names the OUTER lock the cycle actually takes (the identity)"
else
  fail "case 1: the skip line does not name the lock key"
fi
if printf '%s' "$OUT1" | grep -qF 'lock_ttl=900s remaining'; then
  pass "case 1: the skip line carries the remaining TTL (the number)"
else
  fail "case 1: the skip line does not carry the remaining TTL"
fi
# The decisive half: the job MUST NOT have run.
if printf '%s' "$OUT1" | grep -qF 'THE_JOB_RAN'; then
  fail "case 1: the job RAN despite the lock being held — the skip did not actually skip"
else
  pass "case 1: the job did not run while the lock was held"
fi

# --- Case 2: lock FREE -> the job runs, clean exit, no ceiling line --------
OUT2="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        SCRAPER_CEILING_SECONDS=30 \
        sh "$WAKE" data 2>&1)"
ST2=$?
if [ "$ST2" -eq 0 ]; then
  pass "case 2: a wake on a free lock exits 0"
else
  fail "case 2: a wake on a free lock exited $ST2, expected 0"
  printf '%s\n' "$OUT2"
fi
if printf '%s' "$OUT2" | grep -qF 'THE_JOB_RAN'; then
  pass "case 2: the job actually ran when the lock was free"
else
  fail "case 2: the job did not run on a free lock"
  printf '%s\n' "$OUT2"
fi
if printf '%s' "$OUT2" | grep -qF 'wake-complete'; then
  pass "case 2: a clean finish prints wake-complete"
else
  fail "case 2: no wake-complete line on a clean finish"
fi
# A clean finish must NOT look like a ceiling trip.
if printf '%s' "$OUT2" | grep -qF 'scraper-wake: ceiling-tripped'; then
  fail "case 2: a job that finished cleanly printed the ceiling line"
else
  pass "case 2: a clean finish prints no ceiling line"
fi
if printf '%s' "$OUT2" | grep -qF 'wake-skipped'; then
  fail "case 2: a wake that ran the job also printed a skip line"
else
  pass "case 2: a wake that ran the job printed no skip line"
fi

# --- Case 2b: the live job gets its OWN short ceiling (item 7 S1 round 1) ---
# The live-figures job holds a 4-minute lock (spec section 2.1); under the
# 2-hour data ceiling a live process that ignored its in-process deadline could
# live for 2 hours. With no SCRAPER_CEILING_SECONDS override, a live wake must
# run under 300 s and a data wake under 7200 s.
OUT2B_LIVE="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        sh "$WAKE" live 2>&1)"
if printf '%s' "$OUT2B_LIVE" | grep -F 'wake-starting' | grep -qF 'under a 300s hung-process ceiling'; then
  pass "case 2b: a live wake runs under its own 300s ceiling, not the 2-hour data ceiling"
else
  fail "case 2b: a live wake did not run under the 300s ceiling"
  printf '%s\n' "$OUT2B_LIVE"
fi
OUT2B_DATA="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        sh "$WAKE" data 2>&1)"
if printf '%s' "$OUT2B_DATA" | grep -F 'wake-starting' | grep -qF 'under a 7200s hung-process ceiling'; then
  pass "case 2b: a data wake keeps the 7200s ceiling (OD-55 unchanged)"
else
  fail "case 2b: a data wake no longer runs under the 7200s ceiling"
  printf '%s\n' "$OUT2B_DATA"
fi

# --- Case 3: job EXCEEDS the ceiling -> terminated, ceiling line, exit 124 --
# This is the case the whole slice exists for. The ceiling is set to 2s and the
# job sleeps 60s, so a ceiling that does not fire makes this case HANG rather
# than pass — it cannot pass by the guard being absent.
if command -v timeout >/dev/null 2>&1; then
  START3="$(date -u '+%s')"
  OUT3="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
          SCRAPER_WAKE_CMD="$FIXDIR/job-hang.sh" \
          SCRAPER_CEILING_SECONDS=2 \
          sh "$WAKE" data 2>&1)"
  ST3=$?
  ELAPSED3=$(( $(date -u '+%s') - START3 ))

  if [ "$ST3" -eq 124 ]; then
    pass "case 3: a job past the ceiling exits 124 (distinguishable from clean 0 and from a crash)"
  else
    fail "case 3: a job past the ceiling exited $ST3, expected 124"
    printf '%s\n' "$OUT3"
  fi
  if printf '%s' "$OUT3" | grep -qF 'scraper-wake: ceiling-tripped'; then
    pass "case 3: the ceiling trip prints its greppable token (ceiling-tripped)"
  else
    fail "case 3: no ceiling-tripped line — a ceiling that fires silently is unreadable in a log"
    printf '%s\n' "$OUT3"
  fi
  if printf '%s' "$OUT3" | grep -qE 'elapsed=[0-9]+s'; then
    pass "case 3: the ceiling line carries the elapsed time"
  else
    fail "case 3: the ceiling line does not carry the elapsed time"
  fi
  # The termination must be real, not merely reported. This assertion used to
  # measure the HARNESS's wall-clock, and it measured the wrong thing: under
  # `setsid` the job leads its own process group, so `timeout` correctly kills
  # the direct child at the ceiling while an orphaned grandchild keeps the
  # command substitution's pipe open until IT exits. CI proved the wrapper right
  # and this check wrong - the job log showed
  #   "ceiling-tripped ... elapsed=2s ... exit=124"
  # while the harness's own $ELAPSED3 read 61s and failed the case.
  #
  # So assert the WRAPPER's own elapsed figure, which is the number under test,
  # against the ceiling it was given. That is deterministic - it does not race a
  # sleep against a timeout, and a slower runner cannot change it. The harness
  # wall-clock is deliberately NOT asserted: it is a property of pipe lifetimes,
  # not of the ceiling.
  WRAPPER_ELAPSED3="$(printf '%s\n' "$OUT3" | sed -n 's/.*ceiling-tripped:.*elapsed=\([0-9][0-9]*\)s.*/\1/p' | head -1)"
  if [ -z "$WRAPPER_ELAPSED3" ]; then
    fail "case 3: no elapsed figure in the ceiling line - cannot tell whether the ceiling or something else ended the job"
    printf '%s\n' "$OUT3"
  elif printf '%s' "$OUT3" | grep -qF 'THE_JOB_RAN' && [ "$WRAPPER_ELAPSED3" -ge 1 ] && [ "$WRAPPER_ELAPSED3" -le 10 ]; then
    # >=1 proves it ran rather than failing instantly; <=10 proves the 2s ceiling
    # (not the job's own 60s sleep) is what ended it, with slack for a loaded
    # runner that is still nowhere near 60.
    pass "case 3: the job started and the WRAPPER cut it short at ${WRAPPER_ELAPSED3}s against its 2s ceiling, not its own 60s (harness wall-clock ${ELAPSED3}s is pipe lifetime, not job runtime)"
  else
    fail "case 3: expected the wrapper to end the job at its ceiling; its own elapsed reads ${WRAPPER_ELAPSED3}s"
    printf '%s\n' "$OUT3"
  fi
else
  fail "case 3: GNU coreutils 'timeout' not on PATH — the ceiling cannot be exercised here"
fi

# --- Case 3b: a job that CRASHES is not reported as a ceiling trip ---------
# Three outcomes, three readings. A crash must propagate its own status and
# must not borrow the ceiling's token or its 124.
OUT3B="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
         SCRAPER_WAKE_CMD="$FIXDIR/job-crash.sh" \
         SCRAPER_CEILING_SECONDS=30 \
         sh "$WAKE" data 2>&1)"
ST3B=$?
if [ "$ST3B" -eq 3 ]; then
  pass "case 3b: a crashing job propagates its own exit status (3), not 0 and not 124"
else
  fail "case 3b: a crashing job exited $ST3B, expected its own 3"
fi
if printf '%s' "$OUT3B" | grep -qF 'scraper-wake: ceiling-tripped'; then
  fail "case 3b: a crash was reported as a ceiling trip"
else
  pass "case 3b: a crash is not reported as a ceiling trip"
fi
if printf '%s' "$OUT3B" | grep -qF 'wake-failed'; then
  pass "case 3b: a crash prints its own wake-failed line"
else
  fail "case 3b: a crash printed no wake-failed line"
fi

# --- Case 4: the ceiling's DEFAULT is 2 hours -----------------------------
# Static, because waiting 2 hours is not a test. The default is what production
# runs — SCRAPER_CEILING_SECONDS is only ever set by this suite — so a typo
# there (720 for 7200, say) would be invisible to every case above.
if grep -qE 'SCRAPER_CEILING_SECONDS="\$\{SCRAPER_CEILING_SECONDS:-7200\}"' "$WAKE"; then
  pass "case 4: the default ceiling is 7200s (2 hours, OD-55)"
else
  fail "case 4: the default ceiling is not 7200s — production would run on the wrong bound"
  grep -n 'SCRAPER_CEILING_SECONDS' "$WAKE" | head
fi

# --- Case 5: the ceiling is EXTERNAL (timeout), per OD-55 as corrected -----
# PR #644: the ceiling must supervise the job process from outside, not be a
# value handed to the extractor (a spawn timeout bounds only the child; a hung
# parent wedges it with nothing watching). Asserted statically on the shape.
# EVERY branch that launches the job must be timeout-supervised, not merely one
# of them. There are two (setsid present / absent); a mutation that stripped the
# ceiling from just one of them survived a "does a timeout exist anywhere" grep.
JOB_LAUNCHES="$(grep -vE '^[[:space:]]*#' "$WAKE" | grep -cE 'cd "\$SCRAPER_DIR" && exec ' || true)"
JOB_BOUNDED="$(grep -vE '^[[:space:]]*#' "$WAKE" | grep -cE 'cd "\$SCRAPER_DIR" && exec timeout --signal=TERM --kill-after=[0-9]+ "\$SCRAPER_CEILING_SECONDS"' || true)"
if [ "${JOB_LAUNCHES:-0}" -gt 0 ] && [ "${JOB_LAUNCHES:-0}" = "${JOB_BOUNDED:-0}" ]; then
  pass "case 5: every job launch is wrapped in the external timeout ceiling (${JOB_BOUNDED}/${JOB_LAUNCHES})"
else
  fail "case 5: only ${JOB_BOUNDED:-0} of ${JOB_LAUNCHES:-0} job launches are timeout-supervised - an unbounded branch means a hung job nothing stops"
  grep -nE 'cd "\$SCRAPER_DIR" && exec ' "$WAKE" || true
fi

# --- Case 6: the lock READ matches the command RUN --------------------------
# The CRITICAL this case exists for: the wrapper used to read the INNER
# document lock (filing-auto-persist:cycle) while starting `--source=all`,
# which takes the OUTER lock (scraper:cycle, index.ts:177/:719). During a
# running cycle's non-document phase the inner lock reads free, so the wrapper
# would start a second cycle, that cycle would exit 0 on the outer lock it
# cannot get, and the wrapper would log `wake-complete` - reporting SUCCESS for
# a wake that did nothing. Worse than no check at all.
#
# Static, and deliberately so: the pairing is a property of the source, and a
# runtime test with a fake job cannot observe which lock the REAL scraper takes.
# Item 7 S1: the lock is now picked per job, in ONE case statement that also
# picks the --job= flag. Read the lock each job actually resolves at RUNTIME
# (the skip line names it) rather than grepping one assignment line.
lock_key_for_job() {
  SCRAPER_WAKE_FAKE_LOCK_TTL=100 SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" SCRAPER_CEILING_SECONDS=30 \
    sh "$WAKE" "$1" 2>&1 | sed -n 's/.*lock_key=\([^ ]*\).*/\1/p' | head -1
}
DATA_LOCK6="$(lock_key_for_job data)"
LIVE_LOCK6="$(lock_key_for_job live)"
CLOSED_LOCK6="$(lock_key_for_job closed)"
OPENING_LOCK6="$(lock_key_for_job opening)"
if [ "$DATA_LOCK6" = "lock:resource:scraper:cycle" ]; then
  pass "case 6: a data wake reads scraper:cycle - the lock its --job=data command takes"
else
  fail "case 6: a data wake reads '$DATA_LOCK6', not scraper:cycle; it would gate on a lock the command it runs does not take"
fi
if [ "$CLOSED_LOCK6" = "lock:resource:scraper:cycle" ]; then
  pass "case 6: a closed wake reads scraper:cycle (--job=closed takes the SAME heavy lock as --job=data, item 7 S3)"
else
  fail "case 6: a closed wake reads '$CLOSED_LOCK6', not scraper:cycle"
fi
if [ "$OPENING_LOCK6" = "lock:resource:scraper:cycle" ]; then
  pass "case 6: an opening-day wake reads scraper:cycle (--job=opening takes the SAME heavy lock as --job=data/closed, item 7 S4, OD-31)"
else
  fail "case 6: an opening-day wake reads '$OPENING_LOCK6', not scraper:cycle"
fi
# OD-27: the live wake must read its OWN lock. Reading scraper:cycle would let
# a data job holding the heavy lock for hours skip every live wake - the exact
# thing the owner's rule forbids.
if [ "$LIVE_LOCK6" = "lock:resource:scraper:live" ]; then
  pass "case 6: a live wake reads scraper:live, never the heavy scraper:cycle (OD-27)"
else
  fail "case 6: a live wake reads '$LIVE_LOCK6', not scraper:live - a data job would block the live figures"
fi
if grep -vE '^[[:space:]]*#' "$WAKE" | grep -qF 'filing-auto-persist'; then
  fail "case 6: the wrapper still references the INNER document lock - false-negative machine, see the comment above"
else
  pass "case 6: the wrapper does not gate an outer-lock command on the inner document lock"
fi

# --- Case 7: cwd-independence --------------------------------------------
# pm2 and cron invoke this from wherever they happen to be. A wrapper that
# only works from the repo root is a wrapper that does not run in production.
TMP7="$(mktemp -d)"
OUT7="$(cd "$TMP7" && SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        SCRAPER_CEILING_SECONDS=30 \
        sh "$WAKE" data 2>&1)"
ST7=$?
rm -rf "$TMP7"
if [ "$ST7" -eq 0 ] && printf '%s' "$OUT7" | grep -qF 'THE_JOB_RAN'; then
  pass "case 7: the wrapper works when invoked from an unrelated cwd"
else
  fail "case 7: the wrapper failed from an unrelated cwd (exit $ST7)"
  printf '%s\n' "$OUT7"
fi

# --- Case 8: the deploy script's kill switch is gone, one-shot survives ----
# Duplicated deliberately from deploy-linux.test.sh case 31: this pairing is
# the dangerous half of the slice (removing --cron-restart leaves NOTHING
# bounding a hung job unless the wrapper above is what runs), so it is asserted
# in the wrapper's own suite too rather than depending on a sibling file being
# wired into CI.
if [ -f "$DEPLOY_SCRIPT" ]; then
  # A multi-line pm2 invocation (trailing backslash, flags on the NEXT line)
  # must be joined before grepping, or a per-line grep for "pm2 start ...
  # --flag" can never match and passes for the wrong reason. Mutation testing
  # caught exactly that: restoring --cron-restart onto the continuation line
  # SURVIVED a per-line grep. The awk program lives in a temp file so neither
  # shell quoting nor sed label syntax can mangle it (a sed continuation loop
  # collapsed the WHOLE script into one line - its comment blocks end in
  # backslashes too).
  JOINPROG="$(mktemp)"
  {
    printf '%s\n' '{'
    printf '%s\n' '  line = $0'
    printf '%s\n' '  while (substr(line, length(line)) == "\\" && (getline nxt) > 0) {'
    printf '%s\n' '    line = substr(line, 1, length(line) - 1) nxt'
    printf '%s\n' '  }'
    printf '%s\n' '  print line'
    printf '%s\n' '}'
  } > "$JOINPROG"
  JOINED="$(awk -f "$JOINPROG" "$DEPLOY_SCRIPT")"
  rm -f "$JOINPROG"

  SCRAPER_STARTS="$(printf '%s\n' "$JOINED" | grep -F 'pm2 start' | grep -F 'PM2_SCRAPER_APP')"
  if [ -z "$SCRAPER_STARTS" ]; then
    fail "case 8: found no pm2 start line for the scraper app at all - every assertion below would pass vacuously"
  else
    pass "case 8: found the scraper pm2 start invocation(s) to assert against"

    if printf '%s\n' "$SCRAPER_STARTS" | grep -F -- '--cron-restart' >/dev/null 2>&1; then
      fail "case 8: a scraper pm2 start still passes --cron-restart - the 30-min kill switch is back and the ceiling is decorative"
      printf '%s\n' "$SCRAPER_STARTS"
    else
      pass "case 8: no scraper pm2 start passes --cron-restart (the kill switch is gone)"
    fi

    STARTS_TOTAL="$(printf '%s\n' "$SCRAPER_STARTS" | grep -c 'pm2 start')"
    STARTS_ONESHOT="$(printf '%s\n' "$SCRAPER_STARTS" | grep -c -- '--no-autorestart')"
    if [ "$STARTS_TOTAL" -gt 0 ] && [ "$STARTS_ONESHOT" -eq "$STARTS_TOTAL" ]; then
      pass "case 8: all $STARTS_TOTAL scraper pm2 start(s) carry --no-autorestart (still one-shot)"
    else
      fail "case 8: only $STARTS_ONESHOT of $STARTS_TOTAL scraper pm2 start(s) carry --no-autorestart - a dropped flag means a hot restart loop"
      printf '%s\n' "$SCRAPER_STARTS"
    fi

    STARTS_WRAPPED="$(printf '%s\n' "$SCRAPER_STARTS" | grep -c 'scraper-wake.sh')"
    if [ "$STARTS_WRAPPED" -eq "$STARTS_TOTAL" ]; then
      pass "case 8: all $STARTS_TOTAL scraper pm2 start(s) invoke scraper-wake.sh (both guards in the path)"
    else
      fail "case 8: only $STARTS_WRAPPED of $STARTS_TOTAL scraper pm2 start(s) invoke scraper-wake.sh - a bare tsx start bypasses the lock-skip AND the ceiling"
      printf '%s\n' "$SCRAPER_STARTS"
    fi
  fi
else
  fail "case 8: deploy script not found at $DEPLOY_SCRIPT"
fi

# --- Case 9: SOMETHING ACTUALLY WAKES THE WRAPPER --------------------------
# The defect this case exists for: pm2's --cron-restart was not only the kill
# switch, it was also the ALARM CLOCK - the thing that woke the scraper every
# 30 minutes. Removing it without installing a replacement scheduler leaves
# `pm2 start ... --no-autorestart` running the wrapper ONCE at deploy and never
# again, and that state LOOKS HEALTHY (an exited app is exactly what pm2 shows
# for --no-autorestart), so a scraper that had silently stopped scraping would
# raise no alarm. Asserted here so the scheduler's absence can never be silent.
if [ -f "$DEPLOY_SCRIPT" ]; then
  if grep -qF 'install_scraper_cron()' "$DEPLOY_SCRIPT"; then
    pass "case 9: the deploy installs a scheduled invoker (install_scraper_cron)"
  else
    fail "case 9: NO scheduled invoker in the deploy - with --cron-restart gone, nothing would ever wake the scraper"
  fi

  # It must be CALLED, not merely defined - on the real path and the dry-run path.
  CRON_CALLS="$(grep -cE '^[[:space:]]*install_scraper_cron[[:space:]]*$' "$DEPLOY_SCRIPT" || true)"
  if [ "${CRON_CALLS:-0}" -ge 3 ]; then
    pass "case 9: install_scraper_cron is invoked on the real, dry-run AND resume paths ($CRON_CALLS call sites; case 11 counts them against pm2 start sites)"
  else
    fail "case 9: install_scraper_cron is defined but invoked only ${CRON_CALLS:-0}x - a definition nothing calls schedules nothing"
  fi

  # The scheduled line must name the WRAPPER. A cron entry pointing straight at
  # the tsx entrypoint would wake the scraper but bypass the lock-skip AND the
  # ceiling - the two guards this whole slice exists to add.
  # The scheduled line must name the WRAPPER (a cron entry pointing straight at
  # tsx would wake the scraper but bypass the lock-skip AND the ceiling), and it
  # must resolve through $CURRENT_LINK, never a release dir that retention
  # pruning deletes out from under the schedule after a rollback.
  if grep -F 'local wake_script=' "$DEPLOY_SCRIPT" | grep -qF 'scraper-wake.sh'; then
    pass "case 9: the scheduled invoker points at scraper-wake.sh (guards stay in the path)"
  else
    fail "case 9: the scheduled invoker does not name scraper-wake.sh"
  fi
  if grep -F 'local wake_script=' "$DEPLOY_SCRIPT" | grep -qF 'CURRENT_LINK'; then
    pass "case 9: the scheduled line resolves through \$CURRENT_LINK (survives rollback + release pruning)"
  else
    fail "case 9: the scheduled line pins a release dir - pruning would leave cron invoking a deleted path"
  fi

  # Cadence preserved, not silently changed: the line carries SCRAPER_CRON, the
  # same per-slot value that fed --cron-restart (*/30 prod, 15,45 staging).
  if grep -F 'cron_line=' "$DEPLOY_SCRIPT" | grep -qF '$SCRAPER_CRON'; then
    pass "case 9: the scheduled line carries \$SCRAPER_CRON (per-slot cadence preserved)"
  else
    fail "case 9: the scheduled line does not carry \$SCRAPER_CRON - the per-slot cadence would be lost"
  fi

  # End-to-end on the real script: a prod dry-run must EMIT a schedule line at
  # the prod cadence, and a staging dry-run at staging's offset cadence. This is
  # the non-static half - it runs deploy-linux.sh and reads what it produced.
  CRONROOT="$(mktemp -d)"
  PRODCRON="$(DEPLOY_ROOT="$CRONROOT/p" bash "$DEPLOY_SCRIPT" prod --dry-run --force 2>&1 | grep -i 'would install crontab line' || true)"
  STAGCRON="$(DEPLOY_ROOT="$CRONROOT/s" bash "$DEPLOY_SCRIPT" staging --dry-run --force 2>&1 | grep -i 'would install crontab line' || true)"
  rm -rf "$CRONROOT"

  if printf '%s\n' "$PRODCRON" | grep -qF '*/30 * * * *' && printf '%s\n' "$PRODCRON" | grep -qF 'scraper-wake.sh'; then
    pass "case 9: a prod deploy schedules the wrapper at */30 (the cadence --cron-restart used to carry)"
  else
    fail "case 9: a prod deploy emitted no */30 schedule line for the wrapper"
    printf '%s\n' "$PRODCRON"
  fi
  if printf '%s\n' "$STAGCRON" | grep -qF '15,45 * * * *'; then
    pass "case 9: a staging deploy schedules at the offset 15,45 (slots never extract in the same minute, W-178)"
  else
    fail "case 9: a staging deploy did not emit the offset 15,45 schedule line"
    printf '%s\n' "$STAGCRON"
  fi
  # Item 7 S1 (OD-27/OD-28): a SECOND line wakes the live-figures job every 30
  # minutes, any hour, any day, with its own marker - at minutes that never
  # coincide with ANY data wake (round 1: prod 5,35, staging 20,50; data is
  # */30 prod and 15,45 staging).
  if printf '%s
' "$PRODCRON" | grep -F 'scraper-wake.sh live' | grep -F '5,35 * * * *' | grep -qF 'ipodhan-scraper-live:prod'; then
    pass "case 9: a prod deploy also schedules the live wake (scraper-wake.sh live) at 5,35 with its own marker"
  else
    fail "case 9: a prod deploy emitted no 5,35 live-wake line - the live figures would never be fetched"
    printf '%s
' "$PRODCRON"
  fi
  if printf '%s
' "$STAGCRON" | grep -F 'scraper-wake.sh live' | grep -F '20,50 * * * *' | grep -qF 'ipodhan-scraper-live:staging'; then
    pass "case 9: a staging deploy schedules the live wake at 20,50"
  else
    fail "case 9: a staging deploy emitted no 20,50 live-wake line"
    printf '%s
' "$STAGCRON"
  fi
  # No live minute may equal any data minute of EITHER slot (W-178 shape).
  LIVE_MIN9="$(printf '%s
%s
' "$PRODCRON" "$STAGCRON" | grep -F 'scraper-wake.sh live' | sed 's/.*crontab line: //' | awk '{print $1}' | tr ',' '\n')"
  DATA_MIN9="$(printf '%s
%s
' "$PRODCRON" "$STAGCRON" | grep -F 'scraper-wake.sh data' | sed 's/.*crontab line: //' | awk '{print $1}' | sed 's#^\*/30$#0,30#' | tr ',' '\n')"
  CLASH9=""
  for _m in $LIVE_MIN9; do
    if printf '%s\n' "$DATA_MIN9" | grep -qx "$_m"; then CLASH9="$CLASH9 $_m"; fi
  done
  if [ -n "$LIVE_MIN9" ] && [ -n "$DATA_MIN9" ] && [ -z "$CLASH9" ]; then
    pass "case 9: no live-wake minute coincides with any data-wake minute of either slot (live: $(echo $LIVE_MIN9); data: $(echo $DATA_MIN9))"
  else
    fail "case 9: live and data wakes share a minute:${CLASH9:- (could not read minutes)}"
  fi
  if printf '%s
' "$PRODCRON" | grep -F 'ipodhan-scraper-wake:prod' | grep -qF 'scraper-wake.sh data'; then
    pass "case 9: the data line still runs 'scraper-wake.sh data' (cadence unchanged in this slice)"
  else
    fail "case 9: the data line no longer runs 'scraper-wake.sh data'"
  fi
  # Slot-scoped marker: a prod deploy must not clobber staging's line.
  if printf '%s\n' "$PRODCRON" | grep -qF 'ipodhan-scraper-wake:prod' && printf '%s\n' "$STAGCRON" | grep -qF 'ipodhan-scraper-wake:staging'; then
    pass "case 9: each slot's cron line carries its own marker (a deploy rewrites only its own slot)"
  else
    fail "case 9: the cron lines are not slot-scoped - one slot's deploy could clobber the other's schedule"
  fi
else
  fail "case 9: deploy script not found at $DEPLOY_SCRIPT"
fi

# --- Case 10: a crontab line is REALLY WRITTEN ------------------------------
# THE GAP THIS CLOSES (Tier A review, "Mutation A"): every assertion in case 9
# is about the deploy script's SOURCE and its dry-run ECHO. Replacing the real
# `... | crontab -` with `if true; then` left all 36 cases passing. So case 9
# proved the call sites exist and the line text is right; it never proved a
# line reaches a crontab. This case runs install_scraper_cron() for real
# against a FAKE crontab on PATH and reads back what was stored.
#
# The function is extracted from the script and eval'd (the case 9b/11/32e
# pattern already used here for restart_pm2 and resume_scraper), so an edit to
# deploy-linux.sh is what this test sees.
CRON_FN="$(sed -n '/^install_scraper_cron()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$CRON_FN" ]; then
  fail "case 10: could not extract install_scraper_cron() from $DEPLOY_SCRIPT - renamed?"
else
  C10="$(mktemp -d)"
  mkdir -p "$C10/bin"
  # A fake `crontab` behaving like the real one for the two modes the function
  # uses: `-l` prints the stored table, `-` stores stdin. Anything else errors,
  # so a wrong invocation cannot pass quietly.
  cat > "$C10/bin/crontab" <<'FAKECRON'
#!/bin/sh
TAB="$FAKE_CRONTAB_FILE"
case "${1:-}" in
  -l) [ -f "$TAB" ] && cat "$TAB"; exit 0 ;;
  -)  cat > "$TAB"; exit 0 ;;
  *)  echo "fake crontab: unexpected args: $*" >&2; exit 2 ;;
esac
FAKECRON
  chmod +x "$C10/bin/crontab"

  FAKE_CRONTAB_FILE="$C10/table"
  export FAKE_CRONTAB_FILE
  echo '0 3 * * * /usr/local/bin/some-other-job.sh' > "$FAKE_CRONTAB_FILE"

  (
    PATH="$C10/bin:$PATH"; export PATH
    DRY_RUN=0
    SLOT=prod
    SCRAPER_CRON='*/30 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake.log"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
    install_scraper_cron
  ) > "$C10/install.log" 2>&1

  STORED="$(cat "$FAKE_CRONTAB_FILE" 2>/dev/null || true)"

  if echo "$STORED" | grep -qF 'scraper-wake.sh'; then
    pass "case 10: install_scraper_cron REALLY WRITES a crontab line (not just echoes one)"
  else
    fail "case 10: no scraper-wake line reached the crontab - the write is a no-op"
    echo "$STORED"; cat "$C10/install.log"
  fi

  if echo "$STORED" | grep -F 'scraper-wake.sh' | grep -qF '*/30 * * * *'; then
    pass "case 10: the stored line carries this slot's cadence"
  else
    fail "case 10: the stored line does not carry the slot cadence"
  fi

  WAKE_LINES10="$(echo "$STORED" | grep -cF 'ipodhan-scraper-wake:prod' || true)"
  if [ "${WAKE_LINES10:-0}" -eq 1 ]; then
    pass "case 10: two installs leave exactly one wake line (idempotent)"
  else
    fail "case 10: two installs left ${WAKE_LINES10:-0} wake lines - a deploy would keep appending duplicates"
    echo "$STORED"
  fi

  LIVE_LINES10="$(echo "$STORED" | grep -cF 'ipodhan-scraper-live:prod' || true)"
  if [ "${LIVE_LINES10:-0}" -eq 1 ] && echo "$STORED" | grep -F 'ipodhan-scraper-live:prod' | grep -qF 'scraper-wake.sh live'; then
    pass "case 10: the live wake line REALLY reaches the crontab, exactly once after two installs"
  else
    fail "case 10: expected exactly one stored live-wake line, found ${LIVE_LINES10:-0}"
    echo "$STORED"
  fi

  if echo "$STORED" | grep -qF 'some-other-job.sh'; then
    pass "case 10: an unrelated pre-existing crontab entry is preserved"
  else
    fail "case 10: the install DESTROYED an unrelated crontab entry"
    echo "$STORED"
  fi

  # Round 1 fix (Tier A finding 2): the closed-IPO wake line REALLY reaches
  # the crontab, exactly once after two installs.
  CLOSED_LINES10="$(echo "$STORED" | grep -cF 'ipodhan-scraper-closed:prod' || true)"
  if [ "${CLOSED_LINES10:-0}" -eq 1 ] && echo "$STORED" | grep -F 'ipodhan-scraper-closed:prod' | grep -qF 'scraper-wake.sh closed'; then
    pass "case 10: the closed-IPO wake line REALLY reaches the crontab, exactly once after two installs"
  else
    fail "case 10: expected exactly one stored closed-IPO line, found ${CLOSED_LINES10:-0}"
    echo "$STORED"
  fi

  # Round 1 fix (Tier A finding 1): the closed line's minutes never equal a
  # data or live minute on either slot -- the exact collision class this round
  # fixes. Extract the closed cron's minute field and confirm it shares no
  # value with the data (*/30 -> 0,30) or live (5,35) minute sets on prod.
  CLOSED_CRON_LINE10="$(echo "$STORED" | grep -F 'ipodhan-scraper-closed:prod' | grep -oE '^[^ ]+ [^ ]+')"
  CLOSED_MIN10="$(echo "$CLOSED_CRON_LINE10" | awk '{print $1}')"
  COLLIDES10=0
  for m in $(echo "$CLOSED_MIN10" | tr ',' ' '); do
    case ",0,30," in *",$m,"*) COLLIDES10=1 ;; esac
    case ",5,35," in *",$m,"*) COLLIDES10=1 ;; esac
  done
  if [ "$COLLIDES10" -eq 0 ] && [ -n "$CLOSED_MIN10" ]; then
    pass "case 10: prod closed-wake minutes ($CLOSED_MIN10) never equal a data (0,30) or live (5,35) minute"
  else
    fail "case 10: prod closed-wake minutes ($CLOSED_MIN10) collide with a data/live minute - the night's run can be silently lost"
  fi

  # Round 1 (rollback): DEPLOY_SCRAPER_LIVE_JOB=0 must REMOVE this slot's live
  # line (idempotently) and keep the data line and every unrelated entry.
  (
    PATH="$C10/bin:$PATH"; export PATH
    DRY_RUN=0
    SLOT=prod
    SCRAPER_CRON='*/30 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake.log"
    DEPLOY_SCRAPER_LIVE_JOB=0
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
    install_scraper_cron
  ) > "$C10/disable.log" 2>&1
  STORED_OFF="$(cat "$FAKE_CRONTAB_FILE" 2>/dev/null || true)"
  if ! echo "$STORED_OFF" | grep -qF 'ipodhan-scraper-live:prod' \
     && [ "$(echo "$STORED_OFF" | grep -cF 'ipodhan-scraper-wake:prod')" -eq 1 ] \
     && echo "$STORED_OFF" | grep -qF 'some-other-job.sh'; then
    pass "case 10: DEPLOY_SCRAPER_LIVE_JOB=0 removes the live line, keeps exactly one data line and the unrelated entry"
  else
    fail "case 10: disabling the live job did not remove its line cleanly"
    echo "$STORED_OFF"; cat "$C10/disable.log"
  fi

  # Round 1 fix (Tier A finding 2): DEPLOY_SCRAPER_CLOSED_JOB=0 must REMOVE
  # this slot's closed-IPO line (idempotently) and keep the data/live lines
  # and every unrelated entry.
  (
    PATH="$C10/bin:$PATH"; export PATH
    DRY_RUN=0
    SLOT=prod
    SCRAPER_CRON='*/30 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake.log"
    DEPLOY_SCRAPER_CLOSED_JOB=0
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
    install_scraper_cron
  ) > "$C10/disable-closed.log" 2>&1
  STORED_CLOSED_OFF="$(cat "$FAKE_CRONTAB_FILE" 2>/dev/null || true)"
  if ! echo "$STORED_CLOSED_OFF" | grep -qF 'ipodhan-scraper-closed:prod' \
     && echo "$STORED_CLOSED_OFF" | grep -qF 'ipodhan-scraper-live:prod' \
     && [ "$(echo "$STORED_CLOSED_OFF" | grep -cF 'ipodhan-scraper-wake:prod')" -eq 1 ] \
     && echo "$STORED_CLOSED_OFF" | grep -qF 'some-other-job.sh'; then
    pass "case 10: DEPLOY_SCRAPER_CLOSED_JOB=0 removes the closed-IPO line, keeps the data/live lines and the unrelated entry"
  else
    fail "case 10: disabling the closed-IPO job did not remove its line cleanly"
    echo "$STORED_CLOSED_OFF"; cat "$C10/disable-closed.log"
  fi

  # Round 1 fix (Tier A finding 1, staging slot): the closed line's minutes
  # never equal a data or live minute on staging either (data 15,45; live
  # 20,50).
  (
    PATH="$C10/bin:$PATH"; export PATH
    DRY_RUN=0
    SLOT=staging
    SCRAPER_CRON='15,45 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake-staging.log"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
  ) > "$C10/install-staging.log" 2>&1
  STORED_STAGING10="$(cat "$FAKE_CRONTAB_FILE" 2>/dev/null || true)"
  CLOSED_CRON_LINE10S="$(echo "$STORED_STAGING10" | grep -F 'ipodhan-scraper-closed:staging' | grep -oE '^[^ ]+ [^ ]+')"
  CLOSED_MIN10S="$(echo "$CLOSED_CRON_LINE10S" | awk '{print $1}')"
  COLLIDES10S=0
  for m in $(echo "$CLOSED_MIN10S" | tr ',' ' '); do
    case ",15,45," in *",$m,"*) COLLIDES10S=1 ;; esac
    case ",20,50," in *",$m,"*) COLLIDES10S=1 ;; esac
  done
  if [ "$COLLIDES10S" -eq 0 ] && [ -n "$CLOSED_MIN10S" ]; then
    pass "case 10: staging closed-wake minutes ($CLOSED_MIN10S) never equal a data (15,45) or live (20,50) minute"
  else
    fail "case 10: staging closed-wake minutes ($CLOSED_MIN10S) collide with a data/live minute - the night's run can be silently lost"
  fi

  # Item 7 S4 (OD-31): the opening-day check line REALLY reaches the crontab
  # (prod install from earlier in this case), exactly once, and about 09:45
  # IST -- clear of prod's data (:00/:30), live (:05/:35) and closed
  # (:10/:40) minutes.
  OPENING_LINES10="$(echo "$STORED" | grep -cF 'ipodhan-scraper-opening:prod' || true)"
  if [ "${OPENING_LINES10:-0}" -eq 1 ] && echo "$STORED" | grep -F 'ipodhan-scraper-opening:prod' | grep -qF 'scraper-wake.sh opening'; then
    pass "case 10: the opening-day check line REALLY reaches the crontab, exactly once after two installs"
  else
    fail "case 10: expected exactly one stored opening-day line, found ${OPENING_LINES10:-0}"
    echo "$STORED"
  fi
  OPENING_CRON_LINE10="$(echo "$STORED" | grep -F 'ipodhan-scraper-opening:prod' | grep -oE '^[^ ]+ [^ ]+')"
  OPENING_MIN10="$(echo "$OPENING_CRON_LINE10" | awk '{print $1}')"
  OPENING_HOUR10="$(echo "$OPENING_CRON_LINE10" | awk '{print $2}')"
  COLLIDES_OPEN10=0
  for m in $(echo "$OPENING_MIN10" | tr ',' ' '); do
    case ",0,30," in *",$m,"*) COLLIDES_OPEN10=1 ;; esac
    case ",5,35," in *",$m,"*) COLLIDES_OPEN10=1 ;; esac
    case ",10,40," in *",$m,"*) COLLIDES_OPEN10=1 ;; esac
  done
  if [ "$COLLIDES_OPEN10" -eq 0 ] && [ "$OPENING_HOUR10" = "9" ] && [ -n "$OPENING_MIN10" ]; then
    pass "case 10: prod opening-day check fires at hour 9, minute $OPENING_MIN10 IST - clear of every data/live/closed minute"
  else
    fail "case 10: prod opening-day cron '$OPENING_MIN10 $OPENING_HOUR10' collides with an existing wake or is not near 09:45 IST"
  fi

  # DEPLOY_SCRAPER_OPENING_JOB=0 must REMOVE this slot's opening-day line
  # (idempotently) and keep the data/live/closed lines and any unrelated entry.
  (
    PATH="$C10/bin:$PATH"; export PATH
    DRY_RUN=0
    SLOT=prod
    SCRAPER_CRON='*/30 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake.log"
    DEPLOY_SCRAPER_OPENING_JOB=0
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
    install_scraper_cron
  ) > "$C10/disable-opening.log" 2>&1
  STORED_OPENING_OFF="$(cat "$FAKE_CRONTAB_FILE" 2>/dev/null || true)"
  if ! echo "$STORED_OPENING_OFF" | grep -qF 'ipodhan-scraper-opening:prod' \
     && echo "$STORED_OPENING_OFF" | grep -qF 'ipodhan-scraper-closed:prod' \
     && [ "$(echo "$STORED_OPENING_OFF" | grep -cF 'ipodhan-scraper-wake:prod')" -eq 1 ] \
     && echo "$STORED_OPENING_OFF" | grep -qF 'some-other-job.sh'; then
    pass "case 10: DEPLOY_SCRAPER_OPENING_JOB=0 removes the opening-day line, keeps the data/live/closed lines and the unrelated entry"
  else
    fail "case 10: disabling the opening-day job did not remove its line cleanly"
    echo "$STORED_OPENING_OFF"; cat "$C10/disable-opening.log"
  fi

  # Item 7 S4: staging's opening-day minute must not collide with staging's
  # OWN data wake (:15/:45) -- 09:45 IST would collide since staging's data
  # wake fires at :15/:45 every hour, including 09:45.
  OPENING_CRON_LINE10S="$(echo "$STORED_STAGING10" | grep -F 'ipodhan-scraper-opening:staging' | grep -oE '^[^ ]+ [^ ]+')"
  OPENING_MIN10S="$(echo "$OPENING_CRON_LINE10S" | awk '{print $1}')"
  OPENING_HOUR10S="$(echo "$OPENING_CRON_LINE10S" | awk '{print $2}')"
  COLLIDES_OPEN10S=0
  for m in $(echo "$OPENING_MIN10S" | tr ',' ' '); do
    case ",15,45," in *",$m,"*) COLLIDES_OPEN10S=1 ;; esac
    case ",20,50," in *",$m,"*) COLLIDES_OPEN10S=1 ;; esac
    case ",25,55," in *",$m,"*) COLLIDES_OPEN10S=1 ;; esac
  done
  if [ "$COLLIDES_OPEN10S" -eq 0 ] && [ "$OPENING_HOUR10S" = "9" ] && [ -n "$OPENING_MIN10S" ]; then
    pass "case 10: staging opening-day check fires at hour 9, minute $OPENING_MIN10S IST - clear of staging's data (15,45)/live (20,50)/closed (25,55) minutes"
  else
    fail "case 10: staging opening-day cron '$OPENING_MIN10S $OPENING_HOUR10S' collides with an existing staging wake or is not near 09:45 IST"
  fi

  # A crontab write that FAILS must warn loudly, never pass silently.
  mkdir -p "$C10/bin2"
  cat > "$C10/bin2/crontab" <<'FAILCRON'
#!/bin/sh
case "${1:-}" in
  -l) exit 0 ;;
  *)  exit 1 ;;
esac
FAILCRON
  chmod +x "$C10/bin2/crontab"
  (
    PATH="$C10/bin2:$PATH"; export PATH
    DRY_RUN=0; SLOT=prod; SCRAPER_CRON='*/30 * * * *'
    CURRENT_LINK="$C10/current"
    SCRAPER_CRON_MARKER="# ipodhan-scraper-wake:$SLOT"
    SCRAPER_WAKE_LOG="$C10/wake.log"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    eval "$CRON_FN"
    install_scraper_cron
  ) > "$C10/failwrite.log" 2>&1 || true
  FAILOUT10="$(cat "$C10/failwrite.log" 2>/dev/null || true)"
  if echo "$FAILOUT10" | grep -qi 'WILL NOT BE WOKEN'; then
    pass "case 10: a failed crontab write warns that the scraper will not be woken"
  else
    fail "case 10: a failed crontab write did not warn - the outage would be silent"
    echo "$FAILOUT10"
  fi

  rm -rf "$C10"
  unset FAKE_CRONTAB_FILE
fi

# --- Case 13: the bare cron environment cannot silently no-op ---------------
# CRITICAL 2 (Tier A review): cron runs the wrapper with PATH=/usr/bin:/bin, no
# login shell, no nvm, no cwd, and none of the env pm2 injects deliberately. A
# bare `npx tsx` under cron most likely resolves to NOTHING - the line fires,
# npx is not found, the log grows, and we have shipped a scheduler that never
# runs. That is the silent failure this whole slice exists to prevent, so a
# missing interpreter must REFUSE loudly, not proceed.
#
# Driven for real: the wrapper is invoked with a PATH that contains no node, and
# with the overrides pointed at nothing.
C13="$(mktemp -d)"
mkdir -p "$C13/emptybin"

# (a) No node anywhere -> refuse, do not run the job.
# The PATH keeps a usable shell and coreutils (emptying it entirely just means
# `sh` itself is not found, which tests the harness rather than the wrapper);
# what it must NOT contain is a resolvable node. SCRAPER_NODE_BIN points at a
# file that does not exist, so the wrapper's own resolution is what fails.
NODE_DIR13="$(dirname "$(command -v node 2>/dev/null || echo /nonexistent/node)")"
SAFE_PATH13="$(printf '%s' "$PATH" | tr ':' '
' | grep -vxF "$NODE_DIR13" | paste -sd: -)"
# NO SCRAPER_WAKE_CMD here, deliberately: the guard only fires on the REAL
# launch path, so substituting the job would skip the very thing under test and
# make the guard untestable - worse than the red CI this ordering change fixes.
( PATH="$SAFE_PATH13"; export PATH
  SCRAPER_NODE_BIN="$C13/emptybin/definitely-not-node"; export SCRAPER_NODE_BIN
  SCRAPER_WAKE_FAKE_LOCK_TTL=free; export SCRAPER_WAKE_FAKE_LOCK_TTL
  SCRAPER_CEILING_SECONDS=30; export SCRAPER_CEILING_SECONDS
  sh "$WAKE" data
) > "$C13/out.log" 2>&1
ST13=$?
OUT13="$(cat "$C13/out.log" 2>/dev/null || true)"
if [ "$ST13" -ne 0 ] && [ "$ST13" -ne 124 ]; then
  pass "case 13: a missing node REFUSES with a distinct non-zero exit ($ST13), rather than silently doing nothing"
else
  fail "case 13: a missing node exited $ST13 - a cron line that no-ops forever is exactly the silent failure this slice exists to prevent"
  printf '%s
' "$OUT13"
fi
if printf '%s' "$OUT13" | grep -qF 'scraper-wake: FATAL'; then
  pass "case 13: the refusal says FATAL and why"
else
  fail "case 13: the refusal printed no FATAL line - an operator reading the cron log would not know why nothing ran"
  printf '%s
' "$OUT13"
fi
if printf '%s' "$OUT13" | grep -qF 'wake-complete'; then
  fail "case 13: the wrapper reported a completed cycle despite no usable node - the guard did not guard"
else
  pass "case 13: no cycle was started when the interpreter was missing"
fi

# (b) TZ and PYTHON_BIN are what cron does NOT provide and the scraper needs
# (an unset TZ is what made NSE dates land a day early for months, T-327 P2-7;
# an unset PYTHON_BIN silently uses whatever python is on PATH, W-111/W-112).
# VALUE, not shape. These two assertions used to grep for the ASSIGNMENT's
# existence, which a surviving mutation proved worthless: setting
# `export TZ="${TZ:-Asia/Kolkata}"` passed all 54 cases, and a wrong TZ is
# exactly the defect class the code comment cites (NSE dates a day early for
# months, T-327 P2-7). `grep -qF 'PYTHON_BIN'` was worse - it matched the WARN
# string alone. So the wrapper is EXERCISED and the environment it actually
# hands the job is read back out of a fake job that prints its own env.
printf '%s
' '#!/bin/sh' 'echo "ENV_TZ=$TZ"' 'echo "ENV_PYTHON_BIN=${PYTHON_BIN:-<unset>}"' 'exit 0' > "$FIXDIR/job-env.sh"
chmod +x "$FIXDIR/job-env.sh"

# PYTHON_BIN reaches the wrapper as an exported var (that is how cron and pm2
# both pass it), so this assertion cannot prove the wrapper's own `export`. What
# it DOES prove is that the value is not swallowed or overwritten on the way to
# the job. The wrapper's export matters for the OTHER path - the venv lookup,
# where the wrapper sets PYTHON_BIN itself and the job can only see it if the
# wrapper exports it. That path is asserted separately below.
ENVOUT13="$(
  SCRAPER_WAKE_FAKE_LOCK_TTL=free   SCRAPER_WAKE_CMD="$FIXDIR/job-env.sh"   SCRAPER_CEILING_SECONDS=30   PYTHON_BIN="/tmp/fake-venv/bin/python"   sh "$WAKE" data 2>&1
)"
if printf '%s' "$ENVOUT13" | grep -qF 'ENV_TZ=UTC'; then
  pass "case 13: the job actually RECEIVES TZ=UTC (value asserted, not the assignment's existence)"
else
  fail "case 13: the job did not receive TZ=UTC - a wrong or unset TZ is what made NSE dates land a day early"
  printf '%s
' "$ENVOUT13" | grep ENV_TZ || printf '%s
' "$ENVOUT13"
fi
if printf '%s' "$ENVOUT13" | grep -qF 'ENV_PYTHON_BIN=/tmp/fake-venv/bin/python'; then
  pass "case 13: the job actually RECEIVES the PYTHON_BIN it was given (exported, not just mentioned)"
else
  fail "case 13: PYTHON_BIN did not reach the job - the extractor would fall back to system python under cron"
  printf '%s
' "$ENVOUT13" | grep ENV_PYTHON_BIN || printf '%s
' "$ENVOUT13"
fi
# The venv path: with PYTHON_BIN UNSET in the environment, the wrapper resolves
# it from the deploy venv layout itself - and the job can only see that value if
# the wrapper EXPORTS it. A mutation deleting the wrapper's `export PYTHON_BIN`
# survived until this case existed, because the other assertion passes the
# variable in already-exported and so cannot tell the two apart.
VENV13="$C13/venv/bin"
mkdir -p "$VENV13"
printf '%s
' '#!/bin/sh' 'exit 0' > "$VENV13/python"
chmod +x "$VENV13/python"
ENVOUT13C="$(
  env -u PYTHON_BIN   SCRAPER_WAKE_FAKE_LOCK_TTL=free   SCRAPER_WAKE_CMD="$FIXDIR/job-env.sh"   SCRAPER_CEILING_SECONDS=30   SCRAPER_PYTHON_BIN_CANDIDATE="$VENV13/python"   sh "$WAKE" data 2>&1
)"
if printf '%s' "$ENVOUT13C" | grep -qF "ENV_PYTHON_BIN=$VENV13/python"; then
  pass "case 13: a wrapper-RESOLVED PYTHON_BIN is exported through to the job"
elif printf '%s' "$ENVOUT13C" | grep -qF 'ENV_PYTHON_BIN=<unset>'; then
  fail "case 13: the wrapper resolved PYTHON_BIN but did not EXPORT it - the extractor would silently use system python"
  printf '%s
' "$ENVOUT13C" | grep -E 'ENV_PYTHON_BIN|no-python-bin' || true
else
  fail "case 13: unexpected PYTHON_BIN state from the venv-resolution path"
  printf '%s
' "$ENVOUT13C" | grep -E 'ENV_PYTHON_BIN|no-python-bin' || true
fi

# And an unset TZ must still arrive as UTC, since that is the cron case.
ENVOUT13B="$(
  SCRAPER_WAKE_FAKE_LOCK_TTL=free   SCRAPER_WAKE_CMD="$FIXDIR/job-env.sh"   SCRAPER_CEILING_SECONDS=30   TZ=   sh "$WAKE" data 2>&1
)"
if printf '%s' "$ENVOUT13B" | grep -qF 'ENV_TZ=UTC'; then
  pass "case 13: an empty inherited TZ still reaches the job as UTC (the cron case)"
else
  fail "case 13: with TZ unset the job did not get UTC"
  printf '%s
' "$ENVOUT13B" | grep ENV_TZ || true
fi
# And it must not depend on `npx`, which under cron would try the network.
if grep -vE '^[[:space:]]*#' "$WAKE" | grep -qE '(^|[^a-zA-Z-])npx '; then
  fail "case 13: the wrapper still invokes npx - under cron that resolves to nothing or hits the network"
else
  pass "case 13: the wrapper does not depend on npx"
fi

# (c) The TSX guard, isolated. The node guard runs first, so with node ALSO
# missing this branch is never reached - a mutation removing it would survive a
# test that only ever exercises the node path. Here node is deliberately VALID
# and only tsx is unresolvable, so the tsx guard is the thing under test.
NODE_OK13="$(command -v node 2>/dev/null || true)"
if [ -n "$NODE_OK13" ]; then
  # Again no SCRAPER_WAKE_CMD - the real launch path is the one that resolves tsx.
  ( SCRAPER_NODE_BIN="$NODE_OK13"; export SCRAPER_NODE_BIN
    SCRAPER_TSX_BIN="$C13/emptybin/definitely-not-tsx.mjs"; export SCRAPER_TSX_BIN
    SCRAPER_DIR="$C13/emptybin"; export SCRAPER_DIR
    REPO_ROOT="$C13/emptybin"; export REPO_ROOT
    SCRAPER_WAKE_FAKE_LOCK_TTL=free; export SCRAPER_WAKE_FAKE_LOCK_TTL
    SCRAPER_CEILING_SECONDS=30; export SCRAPER_CEILING_SECONDS
    sh "$WAKE" data
  ) > "$C13/tsx.log" 2>&1
  STTSX13=$?
  OUTTSX13="$(cat "$C13/tsx.log" 2>/dev/null || true)"
  if [ "$STTSX13" -ne 0 ] && [ "$STTSX13" -ne 124 ] && printf '%s' "$OUTTSX13" | grep -qF 'no-tsx'; then
    pass "case 13: an unresolvable tsx REFUSES with its own FATAL line (exit $STTSX13), node being fine"
  else
    fail "case 13: a missing tsx did not refuse (exit $STTSX13) - under cron the cycle would silently never start"
    printf '%s
' "$OUTTSX13"
  fi
  if printf '%s' "$OUTTSX13" | grep -qF 'wake-complete'; then
    fail "case 13: the wrapper reported a completed cycle with no usable tsx"
  else
    pass "case 13: no cycle was started when tsx was unresolvable"
  fi
else
  fail "case 13: no node on PATH in this harness - cannot isolate the tsx guard"
fi

rm -rf "$C13"

# --- Case 12: the FAILURE path schedules too -------------------------------
# CRITICAL 1 (Tier A review): resume_scraper() runs from the EXIT trap on every
# FAILED deploy and every rollback - the path that matters most - and it had a
# pm2 start with NO cron install, so the failure path started the wrapper once
# and scheduled nothing: the same total outage as the original defect, by a
# different route.
#
# Counting call sites globally (case 11) is not enough: a count cannot tell you
# WHICH function each call lives in, so moving or neutering resume_scraper's
# call while adding one elsewhere would keep the count right and the failure
# path broken. This extracts each function and asserts the pairing inside it.
for FN12 in resume_scraper restart_pm2; do
  BODY12="$(sed -n "/^${FN12}()/,/^}/p" "$DEPLOY_SCRIPT")"
  if [ -z "$BODY12" ]; then
    fail "case 12: could not extract ${FN12}() from $DEPLOY_SCRIPT - renamed?"
    continue
  fi
  STARTS12="$(printf '%s
' "$BODY12" | grep -vE '^[[:space:]]*#' | grep -c 'pm2 start' || true)"
  CRONS12="$(printf '%s
' "$BODY12" | grep -vE '^[[:space:]]*[#:]' | grep -cE '^[[:space:]]*install_scraper_cron[[:space:]]*$' || true)"
  if [ "${STARTS12:-0}" -gt 0 ] && [ "${CRONS12:-0}" -ge 1 ]; then
    pass "case 12: ${FN12}() starts the scraper AND schedules it (${CRONS12} install for ${STARTS12} start)"
  else
    fail "case 12: ${FN12}() has ${STARTS12:-0} pm2 start(s) but ${CRONS12:-0} cron install(s) - that path would start the wrapper once and never schedule it"
    printf '%s
' "$BODY12" | grep -nE 'pm2 start|install_scraper_cron' || true
  fi
done

# --- Case 11: every pm2 start site has a cron install -----------------------
# Counted, not fixed at a number: resume_scraper (the EXIT-trap path that runs
# on every failed deploy and rollback) had a pm2 start and NO cron install, so
# the failure path scheduled nothing. A fixed expectation goes stale the moment
# a fourth start site appears; comparing the counts keeps the invariant true as
# the script grows.
if [ -f "$DEPLOY_SCRIPT" ]; then
  PM2_SITES11="$(grep -c 'pm2 start .*scraper-wake\.sh' "$DEPLOY_SCRIPT" || true)"
  CRON_SITES11="$(grep -vE '^[[:space:]]*[#:]' "$DEPLOY_SCRIPT" | grep -cE '^[[:space:]]*install_scraper_cron[[:space:]]*$' || true)"
  if [ "${PM2_SITES11:-0}" -gt 0 ] && [ "${PM2_SITES11:-0}" = "${CRON_SITES11:-0}" ]; then
    pass "case 11: every scraper pm2 start site has a matching cron install (${CRON_SITES11}/${PM2_SITES11})"
  else
    fail "case 11: ${CRON_SITES11:-0} cron installs for ${PM2_SITES11:-0} pm2 start sites - a start site that schedules nothing is a silent outage on that path"
    grep -n 'pm2 start .*scraper-wake\.sh' "$DEPLOY_SCRIPT" || true
  fi
fi

# --- Case 14: a wrapper refusal FAILS THE DEPLOY, non-zero, with its reason ---
# The worst outcome this slice can produce: all three start sites are
# `pm2 start --no-autorestart`, which returns 0 the moment pm2 forks, so a
# wrapper that later refuses with exit 78 leaves a GREEN DEPLOY WITH A SCRAPER
# THAT NEVER RUNS - worse than the original defect, because the new machinery
# claims to work. The deploy must refuse while someone is watching.
CRON_PF="$(sed -n '/^preflight_scraper_wake()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$CRON_PF" ]; then
  fail "case 14: could not extract preflight_scraper_wake() from $DEPLOY_SCRIPT - renamed?"
else
  pass "case 14: the deploy defines a wake preflight"

  C14="$(mktemp -d)"
  mkdir -p "$C14/scripts"

  # (a) A wrapper that REFUSES (exit 78) must make the preflight fail non-zero.
  printf '%s\n' '#!/bin/sh' 'echo "scraper-wake: FATAL no-node: cannot find node"' 'exit 78' > "$C14/scripts/scraper-wake.sh"
  chmod +x "$C14/scripts/scraper-wake.sh"
  (
    DRY_RUN=0; SLOT=prod; PYTHON_BIN_PATH=/nonexistent
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    fatal() { echo "FATAL: $*" >&2; exit 1; }
    eval "$CRON_PF"
    preflight_scraper_wake "$C14/scripts/scraper-wake.sh"
  ) > "$C14/refuse.log" 2>&1
  ST14=$?
  if [ "$ST14" -ne 0 ]; then
    pass "case 14: a refusing wrapper makes the deploy step exit non-zero ($ST14) - no green deploy with a dead scraper"
  else
    fail "case 14: the deploy step exited 0 despite the wrapper refusing - this is the green-deploy-dead-scraper outcome"
    cat "$C14/refuse.log"
  fi
  # signal-ownership R6: the gate prints its REASON before the non-zero exit.
  if grep -qF 'FATAL no-node' "$C14/refuse.log"; then
    pass "case 14: the deploy surfaces the wrapper's OWN reason, not a bare 'preflight failed'"
  else
    fail "case 14: the wrapper's reason was swallowed - the operator would have to go read a log on the box"
    cat "$C14/refuse.log"
  fi

  # (b) A wrapper that PASSES must not block the deploy.
  printf '%s\n' '#!/bin/sh' 'echo "scraper-wake: check-ok: node=/usr/bin/node"' 'exit 0' > "$C14/scripts/scraper-wake.sh"
  chmod +x "$C14/scripts/scraper-wake.sh"
  (
    DRY_RUN=0; SLOT=prod; PYTHON_BIN_PATH=/nonexistent
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    fatal() { echo "FATAL: $*" >&2; exit 1; }
    eval "$CRON_PF"
    preflight_scraper_wake "$C14/scripts/scraper-wake.sh"
  ) > "$C14/ok.log" 2>&1
  ST14B=$?
  if [ "$ST14B" -eq 0 ]; then
    pass "case 14: a healthy wrapper passes the preflight (the gate is not just always-fail)"
  else
    fail "case 14: the preflight failed a HEALTHY wrapper (exit $ST14B) - it would block every deploy"
    cat "$C14/ok.log"
  fi

  # (c) A missing or non-executable wrapper is also a refusal, not a skip.
  rm -f "$C14/scripts/scraper-wake.sh"
  (
    DRY_RUN=0; SLOT=prod; PYTHON_BIN_PATH=/nonexistent
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    fatal() { echo "FATAL: $*" >&2; exit 1; }
    eval "$CRON_PF"
    preflight_scraper_wake "$C14/scripts/scraper-wake.sh"
  ) > "$C14/missing.log" 2>&1
  ST14C=$?
  if [ "$ST14C" -ne 0 ]; then
    pass "case 14: a missing wrapper fails the deploy too (exit $ST14C)"
  else
    fail "case 14: a MISSING wrapper passed the preflight - the schedule would invoke nothing"
  fi

  # (d) The preflight must be CALLED on the real path, not merely defined.
  # The read is SEPARATED from the judgement, deliberately. This assertion
  # previously collapsed "the call is missing" and "I could not read the file"
  # into one failure message, and CI then reported "never called" for a call
  # that was demonstrably present in the tested tree. A check that cannot tell
  # those apart is the vacuous-pass class we removed twice tonight, inverted
  # into a vacuous FAIL - equally useless, and more misleading because it
  # accuses the code.
  if [ ! -f "$DEPLOY_SCRIPT" ]; then
    fail "case 14: cannot READ the deploy script at '$DEPLOY_SCRIPT' (cwd=$(pwd)) - this says nothing about whether the preflight is wired"
  else
    DEPLOY_LINES14="$(grep -c '' "$DEPLOY_SCRIPT" 2>/dev/null || echo 0)"
    if [ "${DEPLOY_LINES14:-0}" -lt 100 ]; then
      fail "case 14: the deploy script at '$DEPLOY_SCRIPT' read as only ${DEPLOY_LINES14:-0} lines - truncated or wrong file, so the wiring check would be meaningless"
    else
      PF_CALLS14="$(grep -vE '^[[:space:]]*[#:]' "$DEPLOY_SCRIPT" | grep -cF 'preflight_scraper_wake "' || true)"
      if [ "${PF_CALLS14:-0}" -ge 1 ]; then
        pass "case 14: the preflight is invoked on the real deploy path (${PF_CALLS14} call site(s) in ${DEPLOY_LINES14} lines)"
      else
        fail "case 14: read ${DEPLOY_LINES14} lines of '$DEPLOY_SCRIPT' but found no preflight_scraper_wake call - it gates nothing"
        grep -n 'preflight_scraper_wake' "$DEPLOY_SCRIPT" | head -5 || echo "(no mention of preflight_scraper_wake at all)"
      fi
    fi
  fi

  rm -rf "$C14"
fi

# --- Case 16: the CEILING check is unconditional ---------------------------
# The node/tsx guards are deliberately skipped when SCRAPER_WAKE_CMD substitutes
# the job (the wrapper will not launch node or tsx, so demanding them checks the
# wrong thing - that ordering is what turned CI red). The CEILING must NOT get
# the same treatment: it supervises whatever command runs, substituted or not,
# and a ceiling that only applies to real launches is a ceiling that never
# applies in any test, i.e. untested forever.
if grep -vE '^[[:space:]]*#' "$WAKE" | grep -E 'command -v timeout' | grep -qF 'SCRAPER_WAKE_CMD'; then
  fail "case 16: the ceiling check is gated on SCRAPER_WAKE_CMD - it must stay unconditional, or the bound applies to nothing a test can observe"
  grep -nE 'command -v timeout' "$WAKE" || true
else
  pass "case 16: the ceiling check is unconditional (it supervises a substituted job too)"
fi
# And the skip must apply to the node/tsx guards ONLY - proven by naming them.
SKIPPED_GUARDS="$(grep -vE '^[[:space:]]*#' "$WAKE" | grep -cE '\[ -z "\$\{SCRAPER_WAKE_CMD:-\}" \] &&' || true)"
if [ "${SKIPPED_GUARDS:-0}" -eq 2 ]; then
  pass "case 16: exactly the two launch-only guards (node, tsx) are seam-skipped"
else
  fail "case 16: ${SKIPPED_GUARDS:-0} guards are seam-skipped, expected exactly 2 (node and tsx) - a third would be a guard quietly switched off"
  grep -nE '\[ -z "\$\{SCRAPER_WAKE_CMD:-\}" \] &&' "$WAKE" || true
fi

# --- Case 15: the shell ceiling and the TypeScript ceiling are the SAME number -
# OD-55 defines the 2-hour ceiling ONCE, but it is stated in two languages and a
# shell script cannot import a TypeScript constant - that is a real language
# boundary, not laziness. So it is GUARDED instead. Today the values agree and
# nothing is broken; this exists for the day OD-55 is revised (two hours is a
# fresh decision that could move to three, or to ninety minutes), because
# whoever changes it will change one side and miss the other, and the failure is
# SILENT AND WORSE THAN EITHER VALUE ALONE: the wrapper kills the process at one
# duration while the locks are sized for another, so either the lock expires
# while the job still runs (two cycles writing concurrently - the exact thing the
# lock prevents) or it outlives the ceiling by an hour and blocks every wake.
# Neither errors. Both look healthy.
TS_CEIL_FILE="$SCRIPT_DIR/../../scraper/src/services/filing-auto-persist.ts"
if [ ! -f "$TS_CEIL_FILE" ]; then
  fail "case 15: cannot find filing-auto-persist.ts at $TS_CEIL_FILE - the cross-language ceiling guard cannot run"
else
  # HUNG_PROCESS_CEILING_MS is the single definition; index.ts imports it.
  TS_CEIL_EXPR="$(grep -E '^export const HUNG_PROCESS_CEILING_MS = ' "$TS_CEIL_FILE" | head -1 | sed -e 's/.*= //' -e 's/;.*//')"
  TS_CEIL_MS="$(printf '%s\n' "$TS_CEIL_EXPR" | awk -F'[^0-9]+' '{ p=1; for (i=1;i<=NF;i++) if ($i != "") p*=$i; print p }')"
  SH_CEIL_SECS="$(grep -E '^SCRAPER_CEILING_SECONDS=' "$WAKE" | head -1 | sed -e 's/.*:-//' -e 's/}.*//' -e 's/"//g')"

  if [ -z "$TS_CEIL_MS" ] || [ "$TS_CEIL_MS" = "0" ]; then
    fail "case 15: could not parse HUNG_PROCESS_CEILING_MS from $TS_CEIL_FILE (expr '$TS_CEIL_EXPR') - the guard would pass vacuously"
  elif [ -z "$SH_CEIL_SECS" ]; then
    fail "case 15: could not parse SCRAPER_CEILING_SECONDS default from the wrapper - the guard would pass vacuously"
  elif [ "$(( SH_CEIL_SECS * 1000 ))" = "$TS_CEIL_MS" ]; then
    pass "case 15: the shell ceiling (${SH_CEIL_SECS}s) equals the TypeScript ceiling (${TS_CEIL_MS}ms) - one number, two languages, compared"
  else
    fail "case 15: CEILING MISMATCH - the wrapper kills at ${SH_CEIL_SECS}s ($(( SH_CEIL_SECS / 60 )) min) but the locks are sized for ${TS_CEIL_MS}ms ($(( TS_CEIL_MS / 60000 )) min). One side of OD-55 was changed without the other; this fails silently in production."
  fi

  # And index.ts must not have quietly reintroduced a literal of its own.
  IDX_CEIL="$SCRIPT_DIR/../../scraper/src/index.ts"
  if [ -f "$IDX_CEIL" ]; then
    if grep -E '^export const CYCLE_LOCK_CEILING_MS = ' "$IDX_CEIL" | grep -qE '[0-9]+[[:space:]]*\*'; then
      fail "case 15: index.ts redeclares the ceiling as a literal instead of importing it - that is the third copy, back again"
    else
      pass "case 15: index.ts imports the ceiling rather than redeclaring it"
    fi
  fi
fi

# --- Case 17: WHICH start sites require the preflight, checked not remembered -
# A REAL finding from review, not a CI artifact: there are three scraper pm2
# start sites and three cron installs (cases 11/12 pin those), but only ONE
# preflight call. I argued 706/resume_scraper is exempt because it resumes
# against the PREVIOUS release, which is already built and therefore already has
# tsx - and that is exactly the by-construction reasoning that has been wrong
# twice in this slice. So the exemption is asserted rather than trusted: if the
# premise stops holding, this fails instead of a deploy silently going green
# with a scraper that cannot start.
if [ -f "$DEPLOY_SCRIPT" ]; then
  RESUME_BODY17="$(sed -n '/^resume_scraper()/,/^}/p' "$DEPLOY_SCRIPT")"
  RESTART_BODY17="$(sed -n '/^restart_pm2()/,/^}/p' "$DEPLOY_SCRIPT")"

  if [ -z "$RESUME_BODY17" ] || [ -z "$RESTART_BODY17" ]; then
    fail "case 17: could not extract resume_scraper()/restart_pm2() - cannot check preflight coverage"
  else
    # restart_pm2 starts the NEW release, whose node_modules this deploy just
    # built. It MUST preflight: that is the path where a bad box produces a
    # green deploy and a dead scraper.
    if printf '%s\n' "$RESTART_BODY17" | grep -vE '^[[:space:]]*[#:]' | grep -qF 'preflight_scraper_wake'; then
      pass "case 17: restart_pm2() preflights before starting the NEW release"
    else
      fail "case 17: restart_pm2() starts the new release with NO preflight - a box that cannot run the wrapper would deploy green and never scrape"
    fi

    # resume_scraper is NOT exempt, and writing this check is what proved it.
    # I had argued it was safe because it resumes a PREVIOUSLY-BUILT release -
    # but SCRAPER_RESUME_TARGET is set to "new" at the atomic flip, BEFORE
    # restart_pm2 runs, so a deploy aborting in between resumes against
    # $RELEASE_DIR with nothing having checked it. The exemption argument was
    # too broad; the preflight is now on both paths. EVERY start site that can
    # target a release this deploy built must preflight.
    if printf '%s\n' "$RESUME_BODY17" | grep -vE '^[[:space:]]*[#:]' | grep -qF 'preflight_scraper_wake'; then
      pass "case 17: resume_scraper() preflights too (it can target the new release after the flip, so it is not exempt)"
    else
      fail "case 17: resume_scraper() has NO preflight, but SCRAPER_RESUME_TARGET is set to new at the flip - an abort between the flip and restart_pm2 would resume an unchecked release"
    fi
  fi
fi

# --- Case 18: DEPLOY_SLOT resolution from REPO_ROOT (review round 5, item D) ---
# #660: cron-launched staging wakes had NO DEPLOY_SLOT env var at all (only
# pm2 passes it), so every slotAwareFlagDefault flag in feature-flags.ts
# silently defaulted OFF on staging. The wrapper must derive the slot from
# its OWN location when the env var is absent, so a cron-launched wake
# resolves the SAME slot a pm2-launched one would have been told.
SLOTDIR="$(mktemp -d)"
trap 'rm -rf "$FIXDIR" "$SLOTDIR"' EXIT
mkdir -p "$SLOTDIR/current-staging/scripts" "$SLOTDIR/current/scripts" "$SLOTDIR/current-mystery/scripts"
cp "$WAKE" "$SLOTDIR/current-staging/scripts/scraper-wake.sh"
cp "$WAKE" "$SLOTDIR/current/scripts/scraper-wake.sh"
cp "$WAKE" "$SLOTDIR/current-mystery/scripts/scraper-wake.sh"
chmod +x "$SLOTDIR"/current*/scripts/scraper-wake.sh

OUT18A="$(env -u DEPLOY_SLOT \
    SCRAPER_WAKE_FAKE_LOCK_TTL=free \
    SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
    sh "$SLOTDIR/current-staging/scripts/scraper-wake.sh" data 2>&1)"
if printf '%s' "$OUT18A" | grep -qF 'DEPLOY_SLOT resolved: staging'; then
  pass "case 18a: a cron-launched wake from a current-staging path resolves DEPLOY_SLOT=staging with no env var set"
else
  fail "case 18a: no 'DEPLOY_SLOT resolved: staging' line from a current-staging path"
  printf '%s\n' "$OUT18A"
fi

OUT18B="$(env -u DEPLOY_SLOT \
    SCRAPER_WAKE_FAKE_LOCK_TTL=free \
    SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
    sh "$SLOTDIR/current/scripts/scraper-wake.sh" data 2>&1)"
if printf '%s' "$OUT18B" | grep -qF 'DEPLOY_SLOT resolved: prod'; then
  pass "case 18b: a cron-launched wake from a plain current path resolves DEPLOY_SLOT=prod with no env var set"
else
  fail "case 18b: no 'DEPLOY_SLOT resolved: prod' line from a plain current path"
  printf '%s\n' "$OUT18B"
fi

OUT18C="$(env DEPLOY_SLOT=staging \
    SCRAPER_WAKE_FAKE_LOCK_TTL=free \
    SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
    sh "$SLOTDIR/current/scripts/scraper-wake.sh" data 2>&1)"
if printf '%s' "$OUT18C" | grep -qF 'DEPLOY_SLOT resolved: staging (from the DEPLOY_SLOT env var'; then
  pass "case 18c: an explicit DEPLOY_SLOT env var (pm2) always wins over the path guess"
else
  fail "case 18c: an explicit DEPLOY_SLOT env var was not honoured over the path"
  printf '%s\n' "$OUT18C"
fi

ST18D=0
OUT18D="$(env -u DEPLOY_SLOT \
    SCRAPER_WAKE_FAKE_LOCK_TTL=free \
    SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
    sh "$SLOTDIR/current-mystery/scripts/scraper-wake.sh" data 2>&1)" || ST18D=$?
if [ "$ST18D" -ne 0 ] && printf '%s' "$OUT18D" | grep -qF 'REFUSING'; then
  pass "case 18d: a path matching neither current nor current-staging refuses rather than guessing a slot"
else
  fail "case 18d: expected a non-zero exit + REFUSING line for an unrecognised deploy path, got exit=$ST18D"
  printf '%s\n' "$OUT18D"
fi

# --- Case 19: the job flag reaches the job (item 7 S1) ---------------------
# The job and its lock are chosen together; this proves the other half - the
# flag the job is started with - by reading back the argv a fake job receives.
printf '%s\n' '#!/bin/sh' 'echo "JOB_ARGV=$*"' 'exit 0' > "$FIXDIR/job-argv.sh"
chmod +x "$FIXDIR/job-argv.sh"
argv_for_job() {
  SCRAPER_WAKE_FAKE_LOCK_TTL=free SCRAPER_WAKE_CMD="$FIXDIR/job-argv.sh" SCRAPER_CEILING_SECONDS=30 \
    sh "$WAKE" "$@" 2>&1 | sed -n 's/^JOB_ARGV=//p' | head -1
}
ARGV19L="$(argv_for_job live)"
ARGV19D="$(argv_for_job data --extra)"
ARGV19C="$(argv_for_job closed)"
ARGV19O="$(argv_for_job opening)"
ARGV19N="$(argv_for_job)"
if [ "$ARGV19L" = "--job=live" ]; then
  pass "case 19: a live wake starts the scraper with --job=live"
else
  fail "case 19: a live wake started the job with '$ARGV19L', expected --job=live"
fi
if [ "$ARGV19D" = "--job=data --extra" ]; then
  pass "case 19: a data wake passes --job=data first, then the operator's extra args"
else
  fail "case 19: a data wake started the job with '$ARGV19D', expected '--job=data --extra'"
fi
if [ "$ARGV19N" = "--job=data" ]; then
  pass "case 19: a wake with no job argument is a data wake (--job=data)"
else
  fail "case 19: a wake with no job argument started the job with '$ARGV19N'"
fi
if [ "$ARGV19C" = "--job=closed" ]; then
  pass "case 19: a closed wake starts the scraper with --job=closed (item 7 S3: its own process)"
else
  fail "case 19: a closed wake started the job with '$ARGV19C', expected --job=closed"
fi
if [ "$ARGV19O" = "--job=opening" ]; then
  pass "case 19: an opening-day wake starts the scraper with --job=opening (item 7 S4, OD-31: its own process)"
else
  fail "case 19: an opening-day wake started the job with '$ARGV19O', expected --job=opening"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "scraper-wake.test.sh: FAILED"
  exit 1
fi
echo "scraper-wake.test.sh: all cases passed"
