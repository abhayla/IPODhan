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
if printf '%s' "$OUT1" | grep -qF 'lock_key=lock:resource:filing-auto-persist:cycle'; then
  pass "case 1: the skip line names the lock key (the identity)"
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
if printf '%s' "$OUT2" | grep -qF 'ceiling-tripped'; then
  fail "case 2: a job that finished cleanly printed the ceiling line"
else
  pass "case 2: a clean finish prints no ceiling line"
fi
if printf '%s' "$OUT2" | grep -qF 'wake-skipped'; then
  fail "case 2: a wake that ran the job also printed a skip line"
else
  pass "case 2: a wake that ran the job printed no skip line"
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
  if printf '%s' "$OUT3" | grep -qF 'ceiling-tripped'; then
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
  # The termination must be real, not merely reported: a wrapper that printed
  # the line but let the 60s job run to completion would take ~60s here.
  # Three conditions together, because each alone passes on the wrong thing:
  # elapsed<30 alone passes on a job that crashed instantly (never reaching the
  # ceiling at all); THE_JOB_RAN alone proves only that it started; elapsed>=1
  # proves the ceiling — not an instant failure — is what ended it.
  if printf '%s' "$OUT3" | grep -qF 'THE_JOB_RAN' && [ "$ELAPSED3" -ge 1 ] && [ "$ELAPSED3" -lt 30 ]; then
    pass "case 3: the job started, ran into the ceiling, and was TERMINATED there (${ELAPSED3}s, not its full 60s)"
  else
    fail "case 3: expected a job that started and was cut short by the ceiling; got elapsed=${ELAPSED3}s"
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
if printf '%s' "$OUT3B" | grep -qF 'ceiling-tripped'; then
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
if grep -qE '(^|[^a-zA-Z-])timeout --signal=TERM --kill-after=[0-9]+ "\$SCRAPER_CEILING_SECONDS"' "$WAKE"; then
  pass "case 5: the ceiling is an external 'timeout' supervising the job process"
else
  fail "case 5: no external timeout supervisor found — a renamed in-extractor timeout does not satisfy OD-55"
  grep -n 'timeout' "$WAKE" | head
fi

# --- Case 6: the live job is NOT gated on the heavy lock (OD-27) ----------
# The design's check D17 fails the whole design if the live-figures job is ever
# described as waiting on or skipped by the heavy lock. Same rule in code.
OUT6="$(SCRAPER_WAKE_FAKE_LOCK_TTL="free" \
        SCRAPER_WAKE_CMD="$FIXDIR/job-ok.sh" \
        SCRAPER_CEILING_SECONDS=30 \
        sh "$WAKE" live 2>&1)"
if printf '%s' "$OUT6" | grep -qF 'lock:resource:scraper:cycle'; then
  pass "case 6: a live wake reads the whole-cycle lock, not the document lock (OD-27)"
else
  fail "case 6: a live wake did not read lock:resource:scraper:cycle"
  printf '%s\n' "$OUT6"
fi
if printf '%s' "$OUT6" | grep -qF 'filing-auto-persist'; then
  fail "case 6: a live wake read the HEAVY document lock — OD-27 says it must never be gated on it"
else
  pass "case 6: a live wake never touches the heavy document lock"
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
  CRON_CALLS="$(grep -c 'install_scraper_cron "' "$DEPLOY_SCRIPT" || true)"
  if [ "${CRON_CALLS:-0}" -ge 2 ]; then
    pass "case 9: install_scraper_cron is invoked on both the real and dry-run paths ($CRON_CALLS call sites)"
  else
    fail "case 9: install_scraper_cron is defined but invoked only ${CRON_CALLS:-0}x - a definition nothing calls schedules nothing"
  fi

  # The scheduled line must name the WRAPPER. A cron entry pointing straight at
  # the tsx entrypoint would wake the scraper but bypass the lock-skip AND the
  # ceiling - the two guards this whole slice exists to add.
  if grep -F 'install_scraper_cron "' "$DEPLOY_SCRIPT" | grep -qF 'scraper-wake.sh'; then
    pass "case 9: the scheduled invoker points at scraper-wake.sh (guards stay in the path)"
  else
    fail "case 9: the scheduled invoker does not name scraper-wake.sh"
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
  # Slot-scoped marker: a prod deploy must not clobber staging's line.
  if printf '%s\n' "$PRODCRON" | grep -qF 'ipodhan-scraper-wake:prod' && printf '%s\n' "$STAGCRON" | grep -qF 'ipodhan-scraper-wake:staging'; then
    pass "case 9: each slot's cron line carries its own marker (a deploy rewrites only its own slot)"
  else
    fail "case 9: the cron lines are not slot-scoped - one slot's deploy could clobber the other's schedule"
  fi
else
  fail "case 9: deploy script not found at $DEPLOY_SCRIPT"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "scraper-wake.test.sh: FAILED"
  exit 1
fi
echo "scraper-wake.test.sh: all cases passed"
