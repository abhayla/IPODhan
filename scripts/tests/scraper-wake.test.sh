#!/usr/bin/env bash
# Self-test for scripts/scraper-wake.sh (item 7 part B).
#
# The card said this wrapper's correctness "is proven on staging, not by a unit
# suite". That is true of the pm2 integration; it is NOT true of the property
# this script exists for — that it SKIPS rather than KILLS. That property is
# testable here with a fake pm2 on PATH, and it is the one a future edit is
# most likely to break, so it is tested here.
#
# Run: bash scripts/tests/scraper-wake.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAKE="$SCRIPT_DIR/../scraper-wake.sh"
FAILED=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"

# Fake pm2: records every invocation (and SCRAPER_JOB) to $WORK/pm2.log, and
# answers `jlist` from $WORK/jlist.json.
cat > "$WORK/bin/pm2" <<'FAKE'
#!/usr/bin/env bash
echo "pm2 $* SCRAPER_JOB=${SCRAPER_JOB:-}" >> "$PM2_FAKE_LOG"
if [ "${1:-}" = "jlist" ]; then
  cat "$PM2_FAKE_JLIST" 2>/dev/null || true
  exit 0
fi
exit "${PM2_FAKE_EXIT:-0}"
FAKE
chmod +x "$WORK/bin/pm2"
export PATH="$WORK/bin:$PATH"
export PM2_FAKE_LOG="$WORK/pm2.log"
export PM2_FAKE_JLIST="$WORK/jlist.json"

reset_case() { : > "$PM2_FAKE_LOG"; unset PM2_FAKE_EXIT; }
jlist_with_status() {
  printf '[{"name":"ipodhan-scraper","pm2_env":{"status":"%s"}}]' "$1" > "$PM2_FAKE_JLIST"
}

# --- case 1: a cycle is running -> skip, and kill NOTHING ------------------
reset_case; jlist_with_status online
out="$(bash "$WAKE" data 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && echo "$out" | grep -q 'skip: previous cycle still active'; then
  pass "case 1: an online cycle is skipped, exit 0"
else
  fail "case 1: expected a skip and exit 0, got rc=$rc out=$out"
fi
if grep -qE 'pm2 (start|restart|stop|delete|kill)' "$PM2_FAKE_LOG"; then
  fail "case 1: THE WHOLE POINT — the wrapper touched the running cycle: $(cat "$PM2_FAKE_LOG")"
else
  pass "case 1: nothing but jlist was run against the online app (no kill, no restart)"
fi

# --- case 2: idle -> start the named job ----------------------------------
reset_case; jlist_with_status stopped
out="$(bash "$WAKE" gmp 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && grep -q 'pm2 start ipodhan-scraper --update-env SCRAPER_JOB=gmp' "$PM2_FAKE_LOG"; then
  pass "case 2: a stopped scraper is started with SCRAPER_JOB=gmp"
else
  fail "case 2: expected a start carrying the job, rc=$rc log=$(cat "$PM2_FAKE_LOG") out=$out"
fi
if grep -q 'pm2 restart' "$PM2_FAKE_LOG"; then
  fail "case 2: used pm2 restart (kills an online process) instead of pm2 start"
else
  pass "case 2: used pm2 start, never pm2 restart"
fi

# --- case 3: staging picks the staging app name ---------------------------
reset_case
printf '[{"name":"ipodhan-scraper-staging","pm2_env":{"status":"stopped"}}]' > "$PM2_FAKE_JLIST"
DEPLOY_SLOT=staging bash "$WAKE" live >/dev/null 2>&1
if grep -q 'pm2 start ipodhan-scraper-staging' "$PM2_FAKE_LOG"; then
  pass "case 3: DEPLOY_SLOT=staging starts ipodhan-scraper-staging"
else
  fail "case 3: wrong app name for staging: $(cat "$PM2_FAKE_LOG")"
fi

# --- case 4: an unknown job is loud, and starts nothing --------------------
reset_case; jlist_with_status stopped
out="$(bash "$WAKE" lively 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "unknown job 'lively'"; then
  pass "case 4: an unknown job aborts non-zero"
else
  fail "case 4: expected a non-zero abort, rc=$rc out=$out"
fi
if [ -s "$PM2_FAKE_LOG" ]; then
  fail "case 4: an unknown job still talked to pm2: $(cat "$PM2_FAKE_LOG")"
else
  pass "case 4: an unknown job never reaches pm2"
fi

# --- case 5: no job at all ------------------------------------------------
reset_case
out="$(bash "$WAKE" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q 'no job given'; then
  pass "case 5: a missing job aborts non-zero"
else
  fail "case 5: expected a non-zero abort, rc=$rc out=$out"
fi

# --- case 6: pm2 status unreadable -> fail OPEN (the Redis lock is the gate)
reset_case; printf 'not json at all' > "$PM2_FAKE_JLIST"
bash "$WAKE" data >/dev/null 2>&1
if grep -q 'pm2 start ipodhan-scraper' "$PM2_FAKE_LOG"; then
  pass "case 6: an unreadable pm2 jlist fails open and still wakes the scraper"
else
  fail "case 6: an unreadable jlist silently stopped the scraper waking: $(cat "$PM2_FAKE_LOG")"
fi

# --- case 7: the script itself contains no kill path ----------------------
if grep -nE '\b(pkill|killall)\b|kill +-|pm2 +(restart|stop|delete|kill)' "$WAKE" \
     | grep -v '^[0-9]*:#' | grep -q .; then
  fail "case 7: scraper-wake.sh contains a kill/restart path: $(grep -nE '\b(pkill|killall)\b|kill +-|pm2 +(restart|stop|delete|kill)' "$WAKE" | grep -v '^[0-9]*:#')"
else
  pass "case 7: no kill, pkill, pm2 restart/stop/delete anywhere outside comments"
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "scraper-wake.test.sh: ALL PASS"; else echo "scraper-wake.test.sh: FAILURES"; fi
exit "$FAILED"
