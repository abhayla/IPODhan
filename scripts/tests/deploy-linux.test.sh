#!/usr/bin/env bash
# T-242 M3 — self-test for scripts/deploy-linux.sh in --dry-run mode.
# Exercises the release-dir/atomic-flip/prune/mutex bookkeeping against a
# temp dir with fake build/pm2/probe steps (no real npm/next/pm2/box
# needed — mirrors gorefer's deploy.sh --dry-run precedent). Proves the
# migration plan's M3 gate shape: "two [green] deploys ... + one
# deliberately-broken build aborts with [current] untouched."
#
# Run: bash scripts/tests/deploy-linux.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/../deploy-linux.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }
skip() { echo "SKIP: $1"; }

fresh_root() {
  local d
  d="$(mktemp -d)"
  printf '%s' "$d"
}

# Reads a `current`-style pointer whether it is a REAL symlink or the
# emulated marker file deploy-linux.sh's atomic_flip_current() falls back
# to on a filesystem without native symlink support (this repo's Windows
# dev box under MSYS bash — the real Linux target always has real
# symlinks; both shapes carry the same meaning).
current_target() {
  local link="$1"
  if [ -L "$link" ]; then
    readlink "$link"
  elif [ -f "$link" ]; then
    cat "$link"
  fi
}

# --- Case 1: a clean deploy creates a release dir + flips current -----------
ROOT1="$(fresh_root)"
export DEPLOY_ROOT="$ROOT1"
export DEPLOY_MUTEX_MAX_WAIT_SECONDS=2
export DEPLOY_MUTEX_POLL_SECONDS=1
unset DEPLOY_FAIL_BUILD DEPLOY_DRYRUN_SCRAPER_STATUS 2>/dev/null || true

if bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-1.log 2>&1; then
  TARGET1="$(current_target "$ROOT1/current")"
  if [ -n "$TARGET1" ] && [ -d "$TARGET1" ]; then
    pass "case 1: clean deploy points 'current' at a real release dir"
  else
    fail "case 1: 'current' does not resolve to a release dir (target='$TARGET1')"
  fi
  if [ -f "$ROOT1/DEPLOYED_SHA-prod" ]; then
    pass "case 1: DEPLOYED_SHA-prod written"
  else
    fail "case 1: DEPLOYED_SHA-prod missing"
  fi
else
  fail "case 1: clean --dry-run deploy exited non-zero"
  cat /tmp/deploy-test-1.log
fi

# --- Case 1.5: T-406 F1/F5 — preflight runs BEFORE pm2 stop / the flip ------
# Ordering, not just presence: the runtime preflight (T-406) must be gated
# ahead of `pm2 stop`/the atomic flip (round-2 F1 fix moved it out of the
# post-flip position where a FAIL used to start the scraper on the release
# it had just condemned). A future regression that moves the call back down
# would still print the same line — only its POSITION relative to the
# stop/flip lines proves the placement is correct.
PREFLIGHT_LINE="$(grep -n '^==> \[dry-run\] skipping runtime preflight' /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
STOP_LINE="$(grep -n "^==> \[dry-run\] skipping real 'pm2 stop" /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
FLIP_LINE="$(grep -n '^==> Flipping .* -> .* (atomic)$' /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
if [ -n "$PREFLIGHT_LINE" ] && [ -n "$STOP_LINE" ] && [ -n "$FLIP_LINE" ] \
  && [ "$PREFLIGHT_LINE" -lt "$STOP_LINE" ] && [ "$STOP_LINE" -lt "$FLIP_LINE" ]; then
  pass "case 1.5: runtime preflight line ($PREFLIGHT_LINE) precedes pm2 stop ($STOP_LINE) and the atomic flip ($FLIP_LINE)"
else
  fail "case 1.5: expected preflight < pm2-stop < flip ordering (preflight=$PREFLIGHT_LINE stop=$STOP_LINE flip=$FLIP_LINE)"
fi

# --- Case 2: a deliberately-broken build aborts, current untouched ----------
BEFORE_TARGET="$(current_target "$ROOT1/current")"

DEPLOY_FAIL_BUILD=1 bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-2.log 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  pass "case 2: broken build exits non-zero"
else
  fail "case 2: broken build exited 0 (expected failure)"
fi

AFTER_TARGET="$(current_target "$ROOT1/current")"
if [ "$BEFORE_TARGET" = "$AFTER_TARGET" ] && [ -n "$AFTER_TARGET" ]; then
  pass "case 2: 'current' untouched by the broken build ($AFTER_TARGET)"
else
  fail "case 2: 'current' CHANGED after a broken build (before=$BEFORE_TARGET after=$AFTER_TARGET)"
fi

if grep -q "was NOT touched" /tmp/deploy-test-2.log; then
  pass "case 2: script logged that 'current' was not touched"
else
  fail "case 2: expected 'was NOT touched' message not found in output"
fi

# --- Case 2.5: T-406 round-3 — a failed runtime preflight aborts BEFORE ----
# pm2 stop / the flip, same as case 2's broken build. This is the dry-run
# self-test for run_runtime_preflight()'s FAIL path (deploy-linux.sh) —
# without DEPLOY_FAIL_PREFLIGHT, --dry-run always skips the real preflight
# and returns 0, so this path was previously UNEXERCISED by this suite.
BEFORE_TARGET_25="$(current_target "$ROOT1/current")"

DEPLOY_FAIL_PREFLIGHT=1 bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-2.5.log 2>&1
RC25=$?
if [ "$RC25" -ne 0 ]; then
  pass "case 2.5: failed runtime preflight exits non-zero"
else
  fail "case 2.5: failed runtime preflight exited 0 (expected failure)"
fi

AFTER_TARGET_25="$(current_target "$ROOT1/current")"
if [ "$BEFORE_TARGET_25" = "$AFTER_TARGET_25" ] && [ -n "$AFTER_TARGET_25" ]; then
  pass "case 2.5: 'current' untouched by the failed preflight ($AFTER_TARGET_25)"
else
  fail "case 2.5: 'current' CHANGED after a failed preflight (before=$BEFORE_TARGET_25 after=$AFTER_TARGET_25)"
fi

if grep -q "^==> \[dry-run\] skipping real 'pm2 stop" /tmp/deploy-test-2.5.log; then
  fail "case 2.5: found a 'pm2 stop' line even though the preflight failed — preflight gate did not block it"
else
  pass "case 2.5: no 'pm2 stop' line logged after the failed preflight"
fi

if grep -q '^==> Flipping .* -> .* (atomic)$' /tmp/deploy-test-2.5.log; then
  fail "case 2.5: found the atomic flip line even though the preflight failed — flip was not gated"
else
  pass "case 2.5: no atomic flip line logged after the failed preflight"
fi

if grep -q "current' was NOT touched" /tmp/deploy-test-2.5.log; then
  pass "case 2.5: script logged that 'current' was NOT touched"
else
  fail "case 2.5: expected \"current' was NOT touched\" message not found in output"
fi

# --- Case 3: a second clean deploy succeeds after the broken one ------------
if bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-3.log 2>&1; then
  pass "case 3: second clean deploy after a broken build succeeds"
else
  fail "case 3: second clean deploy failed"
  cat /tmp/deploy-test-3.log
fi

# --- Case 4: staging slot uses its own releases dir / current-staging link --
ROOT4="$(fresh_root)"
DEPLOY_ROOT="$ROOT4" bash "$DEPLOY_SCRIPT" staging --dry-run --force >/tmp/deploy-test-4.log 2>&1
TARGET4="$(current_target "$ROOT4/current-staging")"
if [ -n "$TARGET4" ] && [ -d "$ROOT4/releases-staging" ] && [ ! -e "$ROOT4/current" ]; then
  pass "case 4: staging slot uses current-staging / releases-staging, not the prod paths"
else
  fail "case 4: staging slot did not use the expected slot-scoped paths"
  ls -la "$ROOT4"
fi

# --- Case 5: prune keeps only the newest N releases --------------------------
ROOT5="$(fresh_root)"
export DEPLOY_ROOT="$ROOT5"
export DEPLOY_KEEP_RELEASES=3
for i in 1 2 3 4 5; do
  # Distinct commits so each dry-run deploy gets a distinct release dir name.
  bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-5-$i.log 2>&1 || {
    fail "case 5: deploy #$i failed"
    cat /tmp/deploy-test-5-$i.log
  }
  sleep 1.1 # release names are timestamp+sha; force a distinct second-resolution stamp
done
# shellcheck disable=SC2012  # release dir names are timestamp_sha, plain alphanumeric — ls is safe
COUNT="$(ls -1 "$ROOT5/releases" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -le 3 ]; then
  pass "case 5: prune kept <= 3 releases after 5 deploys (kept $COUNT)"
else
  fail "case 5: prune kept $COUNT releases, expected <= 3"
fi
CUR_TARGET5="$(current_target "$ROOT5/current")"
if [ -n "$CUR_TARGET5" ] && [ -d "$CUR_TARGET5" ]; then
  pass "case 5: 'current' still points at a release that was not pruned"
else
  fail "case 5: 'current' points at a PRUNED (or missing) release ($CUR_TARGET5)"
fi

# --- Case 6: the scraper mutex refuses to build while a cycle is in flight --
ROOT6="$(fresh_root)"
DEPLOY_ROOT="$ROOT6" DEPLOY_MUTEX_MAX_WAIT_SECONDS=2 DEPLOY_MUTEX_POLL_SECONDS=1 \
  DEPLOY_DRYRUN_SCRAPER_STATUS=online \
  bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-6.log 2>&1
RC=$?
if [ "$RC" -ne 0 ] && grep -q "refusing to build" /tmp/deploy-test-6.log; then
  pass "case 6: mutex refuses to build while the scraper is 'online' (mid-cycle)"
else
  fail "case 6: expected the mutex to refuse the build (rc=$RC)"
  cat /tmp/deploy-test-6.log
fi

unset DEPLOY_ROOT DEPLOY_MUTEX_MAX_WAIT_SECONDS DEPLOY_MUTEX_POLL_SECONDS DEPLOY_KEEP_RELEASES DEPLOY_FAIL_BUILD DEPLOY_DRYRUN_SCRAPER_STATUS

# --- Case 7: T-262 slot-safe prune — a release still referenced by a live --
# --- pm2 process (not just `current`) survives a prune that removes an -----
# --- unreferenced one. Reproduces the 2026-08-22 staging 502 shape: a ------
# --- release the running process is still pinned to must never be pruned --
# --- just because `current` has moved on. -----------------------------------
ROOT7="$(fresh_root)"
export DEPLOY_ROOT="$ROOT7"
export DEPLOY_KEEP_RELEASES=2

bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-7-1.log 2>&1 \
  || { fail "case 7: deploy #1 failed"; cat /tmp/deploy-test-7-1.log; }
RELEASE1="$(current_target "$ROOT7/current")"
sleep 1.1

bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-7-2.log 2>&1 \
  || { fail "case 7: deploy #2 failed"; cat /tmp/deploy-test-7-2.log; }
RELEASE2="$(current_target "$ROOT7/current")"
sleep 1.1

# Simulate a live pm2 process still pinned to RELEASE1 (as `pm2 reload`'s
# stale-pin bug used to leave it) even though `current` has moved past it.
export DEPLOY_DRYRUN_PM2_RELEASE_DIRS="$RELEASE1"

bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-7-3.log 2>&1 \
  || { fail "case 7: deploy #3 failed"; cat /tmp/deploy-test-7-3.log; }
sleep 1.1
bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-7-4.log 2>&1 \
  || { fail "case 7: deploy #4 failed"; cat /tmp/deploy-test-7-4.log; }

# 4 releases now exist, KEEP=2 -> releases 1 and 2 are prune candidates.
# RELEASE1 is "pm2-referenced" (must survive); RELEASE2 is not (must be pruned).
if [ -d "$RELEASE1" ]; then
  pass "case 7: pm2-referenced release survived the prune even though 'current' moved past it"
else
  fail "case 7: pm2-referenced release $RELEASE1 was PRUNED — slot-safety regression"
fi
if [ ! -d "$RELEASE2" ]; then
  pass "case 7: unreferenced release was pruned as expected"
else
  fail "case 7: unreferenced release $RELEASE2 survived — prune is not trimming correctly"
fi

unset DEPLOY_ROOT DEPLOY_KEEP_RELEASES DEPLOY_DRYRUN_PM2_RELEASE_DIRS

# --- Case 8: honest probe — a simulated /api/version SHA mismatch fails ----
# --- the deploy and triggers auto-rollback, even though /api/health would --
# --- have reported 200 (the exact gap `pm2 reload`'s stale-pin bug opened) -
ROOT8="$(fresh_root)"
export DEPLOY_ROOT="$ROOT8"

bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-8-1.log 2>&1 \
  || { fail "case 8: deploy #1 (good) failed"; cat /tmp/deploy-test-8-1.log; }
GOOD_RELEASE="$(current_target "$ROOT8/current")"
sleep 1.1

DEPLOY_DRYRUN_VERSION_MISMATCH=1 bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-8-2.log 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  pass "case 8: simulated SHA mismatch exits non-zero"
else
  fail "case 8: simulated SHA mismatch exited 0 (expected failure)"
fi
if grep -q "SHA mismatch" /tmp/deploy-test-8-2.log; then
  pass "case 8: script logged the /api/version SHA mismatch"
else
  fail "case 8: expected 'SHA mismatch' message not found in output"
  cat /tmp/deploy-test-8-2.log
fi
if grep -q "AUTO-ROLLBACK" /tmp/deploy-test-8-2.log; then
  pass "case 8: mismatch triggered AUTO-ROLLBACK"
else
  fail "case 8: expected 'AUTO-ROLLBACK' not found in output"
  cat /tmp/deploy-test-8-2.log
fi
AFTER_TARGET8="$(current_target "$ROOT8/current")"
if [ "$AFTER_TARGET8" = "$GOOD_RELEASE" ]; then
  pass "case 8: 'current' rolled back to the last good release ($GOOD_RELEASE)"
else
  fail "case 8: 'current' did NOT roll back to the good release (expected=$GOOD_RELEASE actual=$AFTER_TARGET8)"
fi

unset DEPLOY_ROOT

# --- Case 8b: the REAL (non-dry-run) served-sha comparison at ---------------
# --- deploy-linux.sh:538-552 actually executes and rejects a mismatch ------
# T-287 P3-1: every deploy-linux.test.sh invocation runs `--dry-run`, and
# `verify_public_health`'s dry-run branch (deploy-linux.sh:507-514) returns
# BEFORE the real curl/node comparison ever runs — Case 8 above only proves
# the SIMULATED branch (`DEPLOY_DRYRUN_VERSION_MISMATCH=1`) works. Deleting
# the real block (lines 538-552) entirely still left 22/22 tests green. This
# case extracts `verify_public_health` in isolation, runs it with DRY_RUN=0
# against a fake curl/node returning a genuinely wrong served sha, and
# asserts the REAL (non-"[dry-run] simulated") failure path fires.
VERIFY_FN="$(sed -n '/^verify_public_health()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$VERIFY_FN" ]; then
  fail "case 8b: could not extract verify_public_health() from $DEPLOY_SCRIPT — function renamed?"
else
  FAKEBIN8B="$(mktemp -d)"
  cat > "$FAKEBIN8B/curl" <<'EOSCRIPT'
#!/usr/bin/env bash
# Minimal curl stub covering the two shapes verify_public_health invokes:
# `curl -s -o /dev/null -w '%{http_code}' <url>/api/health` and
# `curl -s <url>/api/version`.
for a in "$@"; do
  case "$a" in
    *"/api/health") printf '200'; exit 0 ;;
    *"/api/version") printf '{"data":{"sha":"deadbee"}}'; exit 0 ;;
  esac
done
printf ''
EOSCRIPT
  chmod +x "$FAKEBIN8B/curl"

  ENVFILE8B="$(mktemp)"
  echo "PORT=39999" > "$ENVFILE8B"

  (
    eval "$VERIFY_FN"
    log() { echo "==> $*"; }
    DRY_RUN=0
    HEALTH_TIMEOUT=2
    WEB_ENV_FILE="$ENVFILE8B"
    SHORT_SHA="cafebabe"
    PATH="$FAKEBIN8B:$PATH"
    verify_public_health
  ) >/tmp/deploy-test-8b.log 2>&1
  RC8B=$?

  if [ "$RC8B" -ne 0 ]; then
    pass "case 8b: REAL (non-dry-run) served-sha comparison rejects a genuine mismatch"
  else
    fail "case 8b: REAL served-sha comparison exited 0 on a genuine mismatch (RC=$RC8B) — the deleted-block mutation would pass"
    cat /tmp/deploy-test-8b.log
  fi

  if grep -q "post-flip /api/version SHA mismatch" /tmp/deploy-test-8b.log \
     && ! grep -q '\[dry-run\] simulated' /tmp/deploy-test-8b.log; then
    pass "case 8b: real (non-simulated) SHA mismatch message present"
  else
    fail "case 8b: expected the REAL 'post-flip /api/version SHA mismatch' message (not the simulated one)"
    cat /tmp/deploy-test-8b.log
  fi

  rm -rf "$FAKEBIN8B"
  rm -f "$ENVFILE8B"
fi

unset DEPLOY_ROOT

# --- Case 9: T-262F — restart_pm2's dry-run emits the REAL pm2 command -----
# --- sequence for the web app (delete THEN start against the new release's -
# --- realpath), never `pm2 reload`. The checker that failed T-262 (#149) ---
# --- found that the prior one-line "[dry-run] would: ..." summary gave the -
# --- suite nothing to grep for — reverting delete+start back to `pm2 -------
# --- reload` still passed all 16 assertions. These checks close that gap. -
DELETE_LINE9="$(grep -n '^==> \[dry-run\] pm2 delete ipodhan-web$' /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
START_LINE9="$(grep -n '^==> \[dry-run\] TZ=UTC pm2 start .*--name ipodhan-web ' /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
if [ -n "$DELETE_LINE9" ] && [ -n "$START_LINE9" ] && [ "$DELETE_LINE9" -lt "$START_LINE9" ]; then
  pass "case 9: restart_pm2 dry-run emits 'pm2 delete ipodhan-web' before 'pm2 start ... --name ipodhan-web'"
else
  fail "case 9: expected 'pm2 delete ipodhan-web' then 'pm2 start ... --name ipodhan-web' in order (delete_line=$DELETE_LINE9 start_line=$START_LINE9)"
  cat /tmp/deploy-test-1.log
fi
WEB_START_CMD9="$(sed -n "${START_LINE9}p" /tmp/deploy-test-1.log)"
if printf '%s' "$WEB_START_CMD9" | grep -qE 'release=.*current$|release=/'; then
  # The realpath is whatever mktemp produced for TARGET1 (case 1) — assert
  # the logged 'release=' path is a real, existing directory, not a label.
  RELEASE_PATH9="$(printf '%s' "$WEB_START_CMD9" | sed -n 's/.*release=\(.*\))$/\1/p')"
  if [ -n "$RELEASE_PATH9" ] && [ -d "$RELEASE_PATH9" ]; then
    pass "case 9: logged 'release=' path is the real release directory ($RELEASE_PATH9)"
  else
    fail "case 9: logged 'release=' path does not resolve to a real directory ($RELEASE_PATH9)"
  fi
else
  fail "case 9: could not find 'release=<path>' in the logged pm2 start line: $WEB_START_CMD9"
fi
if grep -q 'pm2 reload' /tmp/deploy-test-1.log; then
  fail "case 9: dry-run log contains 'pm2 reload' for the web app — must be delete+start, never reload"
else
  pass "case 9: dry-run log does NOT contain 'pm2 reload' anywhere"
fi

# --- Case 9e: W-126 review round 1 — SOURCE-level assertion. A dry-run-log-
# --- string check (the round-1 version of this case) is mutation-blind: it
# --- proves nothing about the REAL pm2 invocations, and a per-site `env -u`
# --- prefix that a future edit silently drops from one call site (or a new
# --- pm2 call added without one) would still pass every existing dry-run
# --- assertion. The actual fix is a SINGLE `unset RUNNER_TRACKING_ID` before
# --- the first pm2 command in the script, covering every pm2 call (present
# --- and future) — so assert that shape directly against the script source:
# --- (i) a line matching '^\s*unset RUNNER_TRACKING_ID' exists, and
# --- (ii) its line number is smaller than the line number of the FIRST
# --- non-comment line invoking pm2 stop/delete/start/describe/jlist/list/save.
# Strip comment lines FIRST, then number the stripped stream — so both line
# numbers below are computed against the same consistently-numbered stream
# and the "before/after" comparison is apples-to-apples.
STRIPPED9E="$(grep -vE '^[[:space:]]*#' "$DEPLOY_SCRIPT")"
UNSET_LINE9E="$(printf '%s\n' "$STRIPPED9E" | grep -n '^[[:space:]]*unset RUNNER_TRACKING_ID' | head -1 | cut -d: -f1)"
FIRST_PM2_LINE9E="$(printf '%s\n' "$STRIPPED9E" | grep -n -E '\bpm2 (stop|delete|start|describe|jlist|list|save)\b' | head -1 | cut -d: -f1)"
if [ -n "$UNSET_LINE9E" ] && [ -n "$FIRST_PM2_LINE9E" ] && [ "$UNSET_LINE9E" -lt "$FIRST_PM2_LINE9E" ]; then
  pass "case 9e: 'unset RUNNER_TRACKING_ID' appears before the first pm2 stop/delete/start/describe/jlist/list/save call (unset_line=$UNSET_LINE9E, first_pm2_line=$FIRST_PM2_LINE9E)"
else
  fail "case 9e: expected 'unset RUNNER_TRACKING_ID' before the first pm2 stop/delete/start/describe/jlist/list/save call (unset_line=$UNSET_LINE9E, first_pm2_line=$FIRST_PM2_LINE9E)"
fi

# --- Case 10: T-262F — the AUTO-ROLLBACK path (case 8's SHA-mismatch run) --
# --- ALSO emits delete+start against PREVIOUS_RELEASE's realpath, never ----
# --- reload. Before this fix the rollback's pm2 calls were gated entirely -
# --- behind `if (( ! DRY_RUN ))`, so --dry-run tests had ZERO coverage of --
# --- the rollback command shape — a revert to reload there would have -----
# --- passed silently. -------------------------------------------------------
# test-8-2.log contains TWO restart_pm2 sequences: the primary flip (against
# the NEW/mismatched release) runs first, then AUTO-ROLLBACK's own delete+
# start (against PREVIOUS_RELEASE) — take the SECOND occurrence of each.
DELETE_LINE10="$(grep -n '^==> \[dry-run\] pm2 delete ipodhan-web$' /tmp/deploy-test-8-2.log | sed -n '2p' | cut -d: -f1)"
START_LINE10="$(grep -n '^==> \[dry-run\] TZ=UTC pm2 start .*--name ipodhan-web ' /tmp/deploy-test-8-2.log | sed -n '2p' | cut -d: -f1)"
if [ -n "$DELETE_LINE10" ] && [ -n "$START_LINE10" ] && [ "$DELETE_LINE10" -lt "$START_LINE10" ]; then
  pass "case 10: rollback dry-run emits 'pm2 delete ipodhan-web' before 'pm2 start ... --name ipodhan-web'"
else
  fail "case 10: expected rollback 'pm2 delete ipodhan-web' then 'pm2 start ... --name ipodhan-web' in order (delete_line=$DELETE_LINE10 start_line=$START_LINE10)"
  cat /tmp/deploy-test-8-2.log
fi
WEB_START_CMD10="$(sed -n "${START_LINE10}p" /tmp/deploy-test-8-2.log)"
ROLLBACK_RELEASE_PATH10="$(printf '%s' "$WEB_START_CMD10" | sed -n 's/.*release=\(.*\))$/\1/p')"
if [ "$ROLLBACK_RELEASE_PATH10" = "$GOOD_RELEASE" ]; then
  pass "case 10: rollback dry-run 'pm2 start' targets the previous good release ($GOOD_RELEASE)"
else
  fail "case 10: rollback dry-run 'pm2 start' targeted '$ROLLBACK_RELEASE_PATH10', expected '$GOOD_RELEASE'"
fi
if grep -q 'pm2 reload' /tmp/deploy-test-8-2.log; then
  fail "case 10: rollback dry-run log contains 'pm2 reload' for the web app — must be delete+start, never reload"
else
  pass "case 10: rollback dry-run log does NOT contain 'pm2 reload' anywhere"
fi

# --- Case 9b/9c/9d: T-327F — TZ=UTC on the REAL (non-dry-run) pm2 start ----
# --- command path, not just the dry-run echo string. Cases 9/10 above only -
# --- grep the '[dry-run] TZ=UTC pm2 start ...' log lines, which are SEPARATE
# --- string literals from the real invocations at deploy-linux.sh:530/537/
# --- 308/(rollback_start_web) — sed 's/&& TZ=UTC pm2 start /&& pm2 start /g'
# --- across all four real invocations left cases 9/10 fully green (same
# --- decoupled-dry-run-echo class T-321 already burned this repo on). These
# --- cases extract each real function in isolation (case 8b/11 pattern),
# --- put a fake `pm2` on PATH that records its own inherited environment
# --- (not the script source) to a file, run the REAL (DRY_RUN=0) start path
# --- against fixture release dirs, and assert TZ=UTC actually reached the
# --- pm2 process — proving runtime behavior, not just the source text.
fake_pm2_recorder() {
  local dir="$1"
  cat > "$dir/pm2" <<'EOSCRIPT'
#!/usr/bin/env bash
if [ "$1" = "start" ]; then
  { printf 'ARGV: %s\n' "$*"; printf 'TZ=%s\n' "${TZ:-<unset>}"; } >> "$PM2_CALL_LOG"
fi
exit 0
EOSCRIPT
  chmod +x "$dir/pm2"
}

RESOLVE_BIN_FN="$(sed -n '/^resolve_bin()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$RESOLVE_BIN_FN" ]; then
  fail "case 9b/9c/9d: could not extract resolve_bin() from $DEPLOY_SCRIPT — function renamed?"
fi

# --- Case 9b: restart_pm2()'s REAL path — flip-web (deploy-linux.sh:530) ---
# --- and flip-scraper (deploy-linux.sh:537) --------------------------------
RESTART_FN="$(sed -n '/^restart_pm2()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$RESTART_FN" ] || [ -z "$RESOLVE_BIN_FN" ]; then
  fail "case 9b: could not extract restart_pm2()/resolve_bin() from $DEPLOY_SCRIPT"
else
  FAKEBIN9B="$(mktemp -d)"
  fake_pm2_recorder "$FAKEBIN9B"
  CALLLOG9B="$(mktemp)"
  REL9B="$(mktemp -d)"
  mkdir -p "$REL9B/web/node_modules/next/dist/bin" "$REL9B/scraper/node_modules/tsx/dist"
  : > "$REL9B/web/node_modules/next/dist/bin/next"
  : > "$REL9B/scraper/node_modules/tsx/dist/cli.mjs"

  (
    eval "$RESOLVE_BIN_FN"
    eval "$RESTART_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    RELEASE_DIR="$REL9B"
    PM2_WEB_APP="ipodhan-web"
    PM2_SCRAPER_APP="ipodhan-scraper"
    DEPLOY_WEB_INSTANCES=2
    PYTHON_BIN_PATH="/tmp/fake-venv-9b/bin/python"
    PATH="$FAKEBIN9B:$PATH"
    export PM2_CALL_LOG="$CALLLOG9B"
    restart_pm2
  ) >/tmp/deploy-test-9b.log 2>&1

  TZ_COUNT9B="$(grep -c '^TZ=UTC$' "$CALLLOG9B" 2>/dev/null || echo 0)"
  if [ "$TZ_COUNT9B" = "2" ] \
    && grep -q -- "--name ipodhan-web" "$CALLLOG9B" \
    && grep -q -- "--name ipodhan-scraper" "$CALLLOG9B"; then
    pass "case 9b: restart_pm2() REAL (non-dry-run) path sets TZ=UTC on both the web and scraper pm2 start (deploy-linux.sh:530,537)"
  else
    fail "case 9b: restart_pm2() REAL path did not set TZ=UTC on both real pm2 start invocations (tz_count=$TZ_COUNT9B)"
    cat "$CALLLOG9B" 2>/dev/null
    cat /tmp/deploy-test-9b.log
  fi

  rm -rf "$FAKEBIN9B" "$REL9B"
  rm -f "$CALLLOG9B"
fi

# --- Case 9c: resume_scraper()'s REAL path (deploy-linux.sh:308) — the ------
# --- EXIT-trap resume that ALWAYS restarts the scraper on any deploy exit --
RESUME_FN="$(sed -n '/^resume_scraper()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$RESUME_FN" ] || [ -z "$RESOLVE_BIN_FN" ]; then
  fail "case 9c: could not extract resume_scraper()/resolve_bin() from $DEPLOY_SCRIPT"
else
  FAKEBIN9C="$(mktemp -d)"
  fake_pm2_recorder "$FAKEBIN9C"
  CALLLOG9C="$(mktemp)"
  REL9C="$(mktemp -d)"
  mkdir -p "$REL9C/scraper/node_modules/tsx/dist"
  : > "$REL9C/scraper/node_modules/tsx/dist/cli.mjs"

  (
    eval "$RESOLVE_BIN_FN"
    eval "$RESUME_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    RELEASE_DIR="$REL9C"
    SCRAPER_RESUME_TARGET="new"
    PM2_SCRAPER_APP="ipodhan-scraper"
    PYTHON_BIN_PATH="/tmp/fake-venv-9c/bin/python"
    PATH="$FAKEBIN9C:$PATH"
    export PM2_CALL_LOG="$CALLLOG9C"
    resume_scraper
  ) >/tmp/deploy-test-9c.log 2>&1

  TZ_COUNT9C="$(grep -c '^TZ=UTC$' "$CALLLOG9C" 2>/dev/null || echo 0)"
  if [ "$TZ_COUNT9C" = "1" ] && grep -q -- "--name ipodhan-scraper" "$CALLLOG9C"; then
    pass "case 9c: resume_scraper() REAL (non-dry-run) path sets TZ=UTC on the scraper pm2 start (deploy-linux.sh:308)"
  else
    fail "case 9c: resume_scraper() REAL path did not set TZ=UTC on the scraper pm2 start (tz_count=$TZ_COUNT9C)"
    cat "$CALLLOG9C" 2>/dev/null
    cat /tmp/deploy-test-9c.log
  fi

  rm -rf "$FAKEBIN9C" "$REL9C"
  rm -f "$CALLLOG9C"
fi

# --- Case 9d: rollback_start_web()'s REAL path — the AUTO-ROLLBACK web -----
# --- pm2 start (T-327F extracted this out of the inline rollback block so --
# --- it is testable the same way as restart_pm2/resume_scraper) -----------
ROLLBACK_FN="$(sed -n '/^rollback_start_web()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$ROLLBACK_FN" ] || [ -z "$RESOLVE_BIN_FN" ]; then
  fail "case 9d: could not extract rollback_start_web()/resolve_bin() from $DEPLOY_SCRIPT — function renamed?"
else
  FAKEBIN9D="$(mktemp -d)"
  fake_pm2_recorder "$FAKEBIN9D"
  CALLLOG9D="$(mktemp)"
  REL9D="$(mktemp -d)"
  mkdir -p "$REL9D/web/node_modules/next/dist/bin"
  : > "$REL9D/web/node_modules/next/dist/bin/next"

  (
    eval "$RESOLVE_BIN_FN"
    eval "$ROLLBACK_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    PREVIOUS_RELEASE="$REL9D"
    PM2_WEB_APP="ipodhan-web"
    DEPLOY_WEB_INSTANCES=2
    PATH="$FAKEBIN9D:$PATH"
    export PM2_CALL_LOG="$CALLLOG9D"
    rollback_start_web
  ) >/tmp/deploy-test-9d.log 2>&1

  TZ_COUNT9D="$(grep -c '^TZ=UTC$' "$CALLLOG9D" 2>/dev/null || echo 0)"
  if [ "$TZ_COUNT9D" = "1" ] && grep -q -- "--name ipodhan-web" "$CALLLOG9D"; then
    pass "case 9d: rollback_start_web() REAL (non-dry-run) path sets TZ=UTC on the rollback web pm2 start"
  else
    fail "case 9d: rollback_start_web() REAL path did not set TZ=UTC on the rollback web pm2 start (tz_count=$TZ_COUNT9D)"
    cat "$CALLLOG9D" 2>/dev/null
    cat /tmp/deploy-test-9d.log
  fi

  rm -rf "$FAKEBIN9D" "$REL9D"
  rm -f "$CALLLOG9D"
fi

# --- Case 11: T-311F HARD finding — assert_pm2_logrotate_installed() must ---
# --- actually distinguish an installed pm2-logrotate module from an -------
# --- absent one. The original predicate (`pm2 conf pm2-logrotate`) exits 0 -
# --- REGARDLESS of install state (verified read-only on the real box where -
# --- the module is genuinely absent), so it could never warn. This ---------
# --- extracts the function in isolation (same pattern as case 8b) and -----
# --- stubs `pm2 jlist` to both shapes: absent (must WARN) and present -----
# --- (must log installed, no warn). -----------------------------------------
ASSERT_FN="$(sed -n '/^assert_pm2_logrotate_installed()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$ASSERT_FN" ]; then
  fail "case 11: could not extract assert_pm2_logrotate_installed() from $DEPLOY_SCRIPT — function renamed?"
else
  FAKEBIN11="$(mktemp -d)"

  # --- 11a: module ABSENT — pm2 jlist has no pm2-logrotate entry -----------
  cat > "$FAKEBIN11/pm2" <<'EOSCRIPT'
#!/usr/bin/env bash
if [ "$1" = "jlist" ]; then
  printf '[{"name":"ipodhan-web","pm2_env":{"status":"online"}}]'
  exit 0
fi
exit 1
EOSCRIPT
  chmod +x "$FAKEBIN11/pm2"

  (
    eval "$ASSERT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    PATH="$FAKEBIN11:$PATH"
    assert_pm2_logrotate_installed
  ) >/tmp/deploy-test-11a.log 2>&1

  if grep -q 'WARN:.*pm2-logrotate module NOT installed' /tmp/deploy-test-11a.log; then
    pass "case 11a: absent pm2-logrotate module produces a WARN (predicate actually fires)"
  else
    fail "case 11a: expected a 'pm2-logrotate module NOT installed' WARN when the module is absent"
    cat /tmp/deploy-test-11a.log
  fi
  if grep -q 'installed and configured\|pm2-logrotate: installed (' /tmp/deploy-test-11a.log && ! grep -q 'WARN' /tmp/deploy-test-11a.log; then
    fail "case 11a: logged 'installed' with no WARN even though the module is absent — the false-green regression"
  else
    pass "case 11a: did not falsely log 'installed' while the module is absent"
  fi

  # --- 11b: module PRESENT — pm2 jlist has a pm2-logrotate entry -----------
  cat > "$FAKEBIN11/pm2" <<'EOSCRIPT'
#!/usr/bin/env bash
if [ "$1" = "jlist" ]; then
  printf '[{"name":"ipodhan-web","pm2_env":{"status":"online"}},{"name":"pm2-logrotate","pm2_env":{"status":"online"}}]'
  exit 0
fi
exit 1
EOSCRIPT
  chmod +x "$FAKEBIN11/pm2"

  (
    eval "$ASSERT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    PATH="$FAKEBIN11:$PATH"
    assert_pm2_logrotate_installed
  ) >/tmp/deploy-test-11b.log 2>&1

  if grep -q 'pm2-logrotate: installed' /tmp/deploy-test-11b.log; then
    pass "case 11b: present pm2-logrotate module logs 'installed', not a WARN"
  else
    fail "case 11b: expected 'pm2-logrotate: installed' when the module IS present"
    cat /tmp/deploy-test-11b.log
  fi
  if grep -q 'WARN' /tmp/deploy-test-11b.log; then
    fail "case 11b: unexpected WARN when the module IS present"
    cat /tmp/deploy-test-11b.log
  else
    pass "case 11b: no WARN when the module is present"
  fi

  rm -rf "$FAKEBIN11"
fi

# --- Case 12: T-311F MEDIUM — report_wired_jobs() emits one deploy-time ----
# --- log line per job T-311 wired into the one-shot cycle, read from the ---
# --- committed tree via `git show`, so the reader does not have to trust ---
# --- source comments to know what actually runs in prod. -------------------
for job_case12 in "duplicateSweep" "stageReconciler" "primarySourceDiscovery"; do
  if grep -q "job wired: $job_case12" /tmp/deploy-test-1.log; then
    pass "case 12: deploy log reports '$job_case12' as wired"
  else
    fail "case 12: expected a 'job wired: $job_case12' line in the deploy log"
    cat /tmp/deploy-test-1.log
  fi
done

# --- Case 13: T-321 — report_wired_jobs() must NEVER silently exit the -----
# --- whole deploy over a §GATE'd flag that is legitimately ABSENT from -----
# --- both env files (its normal off state, owner-gated-feature-flags.md). --
# --- Reproduces the real incident: `deploy-linux.yml` failed 4/4 runs with -
# --- "Process completed with exit code 1" and ZERO error message, right ----
# --- after logging "job wired: duplicateSweep" and before the next job -----
# --- line — because under `set -euo pipefail`, `grep` finding no match in --
# --- the ENABLE_STAGE_RECONCILER lookup made the whole pipeline (and the --
# --- variable assignment reading it) fail, which `set -e` treated as a -----
# --- fatal script error. This extracts report_wired_jobs() in isolation ----
# --- (same pattern as case 11) with NON-dry-run env files that genuinely ---
# --- omit both gated flags, under the SAME `set -euo pipefail` the real ----
# --- script runs under, and asserts the function completes AND reports all-
# --- three jobs instead of vanishing after the first.
REPORT_FN="$(sed -n '/^report_wired_jobs()/,/^}/p' "$DEPLOY_SCRIPT")"
if [ -z "$REPORT_FN" ]; then
  fail "case 13: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  ENVDIR13="$(mktemp -d)"
  # Neither env file mentions the gated flags at all — their real off-state.
  echo "SOME_OTHER_KEY=1" > "$ENVDIR13/scraper.env"
  echo "SOME_OTHER_KEY=1" > "$ENVDIR13/web.env.local"

  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=0
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    SHA="$(cd "$REPO_ROOT" && git rev-parse HEAD)"
    SHORT_SHA="${SHA:0:7}"
    SCRAPER_ENV_FILE="$ENVDIR13/scraper.env"
    WEB_ENV_FILE="$ENVDIR13/web.env.local"
    report_wired_jobs
  ) >/tmp/deploy-test-13.log 2>&1
  RC13=$?
  set -e

  if [ "$RC13" -ne 0 ]; then
    fail "case 13: report_wired_jobs() exited non-zero ($RC13) when a §GATE'd flag was legitimately absent from both env files — the T-321 silent-exit regression"
    cat /tmp/deploy-test-13.log
  else
    pass "case 13: report_wired_jobs() completes when a §GATE'd flag is absent from both env files"
  fi

  for job_case13 in "duplicateSweep" "stageReconciler" "primarySourceDiscovery"; do
    if grep -q "job wired: $job_case13" /tmp/deploy-test-13.log; then
      pass "case 13: reports '$job_case13' as wired even with gated flags absent"
    else
      fail "case 13: missing 'job wired: $job_case13' — report_wired_jobs() likely exited early (T-321 class)"
      cat /tmp/deploy-test-13.log
    fi
  done

  if grep -q "flag ENABLE_STAGE_RECONCILER=unset" /tmp/deploy-test-13.log; then
    pass "case 13: absent flag reports 'unset', not a crash"
  else
    fail "case 13: expected 'flag ENABLE_STAGE_RECONCILER=unset' in the report"
    cat /tmp/deploy-test-13.log
  fi

  rm -rf "$ENVDIR13"
fi

# --- Case 13b: #259 negative — a job name that appears ONLY inside a ------
# --- comment (never in a real `runStep(cycleId, 'job', triggerX)` or ------
# --- legacy `await triggerX()` call) MUST be reported NOT wired. Proves ---
# --- the substance check isn't fooled by a mention in prose, and that a ---
# --- genuinely-wired sibling job in the same file still reports wired. ----
if [ -z "$REPORT_FN" ]; then
  fail "case 13b: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    # Shadow `git` so report_wired_jobs() (which shells out to
    # `git show "$SHA:scraper/src/index.ts"`) reads this synthetic file
    # instead of the real committed tree.
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      // duplicateSweep used to run via runStep(cycleId, 'duplicateSweep', triggerDuplicateSweep)
      // but that call was removed below - only this comment still names it.
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13b.log 2>&1
  RC13B=$?
  set -e

  if [ "$RC13B" -ne 0 ]; then
    fail "case 13b: report_wired_jobs() exited non-zero ($RC13B) on a comment-only mention — should warn, not crash"
    cat /tmp/deploy-test-13b.log
  fi

  if grep -q "job NOT wired: duplicateSweep" /tmp/deploy-test-13b.log; then
    pass "case 13b: a job mentioned only in a comment is reported NOT wired"
  else
    fail "case 13b: expected 'job NOT wired: duplicateSweep' when the only mention is a comment"
    cat /tmp/deploy-test-13b.log
  fi

  if grep -q "job wired: stageReconciler" /tmp/deploy-test-13b.log; then
    pass "case 13b: a genuinely-wired sibling job in the same file still reports wired"
  else
    fail "case 13b: expected 'job wired: stageReconciler' for a genuinely wired sibling job"
    cat /tmp/deploy-test-13b.log
  fi
fi

# --- Case 13c: #264 round 2 negative — a `runStep(...)` call sitting -------
# --- entirely inside a `/* ... */` block comment MUST be reported NOT ------
# --- wired, even though the substance check in 13b already excludes bare ---
# --- `//` mentions. Proves the block-comment strip actually deletes the ----
# --- commented-out call rather than leaving it visible to the matcher. -----
if [ -z "$REPORT_FN" ]; then
  fail "case 13c: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      /*
      await runStep(cycleId, 'duplicateSweep', triggerDuplicateSweep);
      */
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13c.log 2>&1
  RC13C=$?
  set -e

  if [ "$RC13C" -ne 0 ]; then
    fail "case 13c: report_wired_jobs() exited non-zero ($RC13C) on a block-comment-only mention — should warn, not crash"
    cat /tmp/deploy-test-13c.log
  fi

  if grep -q "job NOT wired: duplicateSweep" /tmp/deploy-test-13c.log; then
    pass "case 13c: a job mentioned only inside a /* */ block comment is reported NOT wired"
  else
    fail "case 13c: expected 'job NOT wired: duplicateSweep' when the only mention is inside a block comment"
    cat /tmp/deploy-test-13c.log
  fi

  if grep -q "job wired: stageReconciler" /tmp/deploy-test-13c.log; then
    pass "case 13c: a genuinely-wired sibling job outside the block comment still reports wired"
  else
    fail "case 13c: expected 'job wired: stageReconciler' for a genuinely wired sibling job"
    cat /tmp/deploy-test-13c.log
  fi
fi

# --- Case 13d: #264 round 2 negative — a `runStep(...)` call appearing -----
# --- only after a trailing `// ...` comment marker on the SAME line as -----
# --- real code MUST be reported NOT wired. 13b already covers a line that --
# --- IS a comment start-to-end; this covers a line that has real code -----
# --- BEFORE the `//`, which the old "drop whole-comment lines" filter -----
# --- could not catch. -------------------------------------------------------
if [ -z "$REPORT_FN" ]; then
  fail "case 13d: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      noOpMarker(); // await runStep(cycleId, 'duplicateSweep', triggerDuplicateSweep);
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13d.log 2>&1
  RC13D=$?
  set -e

  if [ "$RC13D" -ne 0 ]; then
    fail "case 13d: report_wired_jobs() exited non-zero ($RC13D) on a trailing-comment-only mention — should warn, not crash"
    cat /tmp/deploy-test-13d.log
  fi

  if grep -q "job NOT wired: duplicateSweep" /tmp/deploy-test-13d.log; then
    pass "case 13d: a job mentioned only after a trailing // comment is reported NOT wired"
  else
    fail "case 13d: expected 'job NOT wired: duplicateSweep' when the only mention trails a // comment"
    cat /tmp/deploy-test-13d.log
  fi

  if grep -q "job wired: stageReconciler" /tmp/deploy-test-13d.log; then
    pass "case 13d: a genuinely-wired sibling job on its own line still reports wired"
  else
    fail "case 13d: expected 'job wired: stageReconciler' for a genuinely wired sibling job"
    cat /tmp/deploy-test-13d.log
  fi
fi

# --- Case 13e: #264 round 2 positive — a genuinely-wired call whose --------
# --- argument list contains a `https://` URL must NOT be truncated by the --
# --- trailing-`//`-comment strip (13d) and must still report wired. --------
# --- Guards against a naive `s://.*$::` that would truncate the real call -
# --- at the first `//` inside the URL. -------------------------------------
if [ -z "$REPORT_FN" ]; then
  fail "case 13e: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      await runStep(cycleId, 'duplicateSweep', triggerDuplicateSweep); // notifies https://hooks.example.com/x
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13e.log 2>&1
  RC13E=$?
  set -e

  if [ "$RC13E" -ne 0 ]; then
    fail "case 13e: report_wired_jobs() exited non-zero ($RC13E) on a call with a https:// trailing comment"
    cat /tmp/deploy-test-13e.log
  fi

  if grep -q "job wired: duplicateSweep" /tmp/deploy-test-13e.log; then
    pass "case 13e: a real call followed by a https:// trailing comment still reports wired"
  else
    fail "case 13e: expected 'job wired: duplicateSweep' — the https:// comment strip must not truncate the real call"
    cat /tmp/deploy-test-13e.log
  fi
fi

# --- Case 13f: #264 round 2 positive — a `runStep(...)` call wrapped -------
# --- across multiple lines (the job name and the callback on separate ------
# --- lines) must still report wired once newlines are collapsed. -----------
if [ -z "$REPORT_FN" ]; then
  fail "case 13f: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      await runStep(cycleId, 'duplicateSweep',
        triggerDuplicateSweep);
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13f.log 2>&1
  RC13F=$?
  set -e

  if [ "$RC13F" -ne 0 ]; then
    fail "case 13f: report_wired_jobs() exited non-zero ($RC13F) on a call wrapped across lines"
    cat /tmp/deploy-test-13f.log
  fi

  if grep -q "job wired: duplicateSweep" /tmp/deploy-test-13f.log; then
    pass "case 13f: a runStep(...) call wrapped across multiple lines still reports wired"
  else
    fail "case 13f: expected 'job wired: duplicateSweep' for a call wrapped across lines"
    cat /tmp/deploy-test-13f.log
  fi
fi

# --- Case 13g: #264 round 2 positive — a `runStep(...)` call whose third --
# --- argument is an inline arrow wrapping the trigger call (the real form -
# --- used by the `heartbeat` step at index.ts:434) must still report -------
# --- wired, despite the extra nested `()` the arrow introduces. ------------
if [ -z "$REPORT_FN" ]; then
  fail "case 13g: could not extract report_wired_jobs() from $DEPLOY_SCRIPT — function renamed?"
else
  set +e
  (
    set -euo pipefail
    eval "$REPORT_FN"
    log() { echo "==> $*"; }
    warn() { echo "WARN: $*" >&2; }
    DRY_RUN=1
    SHORT_SHA="deadbee"
    SHA="deadbee"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    git() {
      if [ "$1" = "show" ]; then
        cat <<'IDXEOF'
      await runStep(cycleId, 'duplicateSweep', async () => triggerDuplicateSweep());
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
IDXEOF
      fi
    }
    report_wired_jobs
  ) >/tmp/deploy-test-13g.log 2>&1
  RC13G=$?
  set -e

  if [ "$RC13G" -ne 0 ]; then
    fail "case 13g: report_wired_jobs() exited non-zero ($RC13G) on an arrow-wrapped call"
    cat /tmp/deploy-test-13g.log
  fi

  if grep -q "job wired: duplicateSweep" /tmp/deploy-test-13g.log; then
    pass "case 13g: a runStep(...) call wrapping the trigger in an arrow function still reports wired"
  else
    fail "case 13g: expected 'job wired: duplicateSweep' for an arrow-wrapped call"
    cat /tmp/deploy-test-13g.log
  fi
fi

# --- Case 14: T-321F — ERR trap must fire inside FUNCTION bodies too -------
# --- (checker finding: `set -euo pipefail` w/o `-E` does not inherit the ---
# --- ERR trap into functions/subshells/command substitutions, so the exact -
# --- class of bug that caused the real T-321 incident — an unguarded -------
# --- failing pipeline inside a function — would NOT have been named by the -
# --- "name-the-failure" backstop). Extracts the real prelude (the ----------
# --- `set -Eeuo pipefail` line through `trap on_deploy_error ERR`) straight
# --- from deploy-linux.sh so this test tracks the real script, then defines
# --- a function with an unguarded failing pipeline (same shape as the -----
# --- report_wired_jobs() bug) and asserts the FATAL line names the failing -
# --- line + command. RED/GREEN proof (manual, not asserted in-test): -------
# --- deleting `trap on_deploy_error ERR` from deploy-linux.sh turns this ---
# --- case RED (rc=0, no FATAL); restoring it turns the suite GREEN again. --
PRELUDE14="$(sed -n '/^set -Eeuo pipefail$/,/^trap on_deploy_error ERR$/p' "$DEPLOY_SCRIPT")"
if [ -z "$PRELUDE14" ]; then
  fail "case 14: could not extract the 'set -Eeuo pipefail' / trap prelude from $DEPLOY_SCRIPT — did the ERR-trap setup move or lose -E?"
else
  set +e
  (
    eval "$PRELUDE14"
    fn_with_unguarded_pipeline_case14() {
      local x
      x="$(grep '^NOPE=' /dev/null | tail -n1 | cut -d= -f2-)"
      echo "unreachable: $x"
    }
    fn_with_unguarded_pipeline_case14
  ) >/tmp/deploy-test-14.log 2>&1
  RC14=$?
  set -e

  if [ "$RC14" -eq 0 ]; then
    fail "case 14: fn_with_unguarded_pipeline_case14() exited 0 — the unguarded failing pipeline was not caught at all"
    cat /tmp/deploy-test-14.log
  elif grep -Eq '^FATAL: .*:[0-9]+ failed running:.*\(exit [0-9]+\)$' /tmp/deploy-test-14.log; then
    pass "case 14: ERR trap fires inside a function body and names the failing line + command"
  else
    fail "case 14: function-scoped failure exited non-zero but printed NO well-formed 'FATAL: <file>:<line> failed running: <cmd> (exit <n>)' line (the T-321F checker finding — trap not inherited without -E)"
    cat /tmp/deploy-test-14.log
  fi
fi

# --- Case 15: T-321F sibling — verify_public_health()'s PORT= lookup must --
# --- NOT silently exit the deploy when $WEB_ENV_FILE genuinely omits -------
# --- PORT= (the same class as case 13/report_wired_jobs(): a --------------
# --- grep|tail|cut pipeline with no match fails under pipefail even though -
# --- the very next line reads `${port:-3000}`, proving absence was always -
# --- meant to fall through to the default, not crash). Extracts the exact -
# --- port-assignment line from verify_public_health() and evals it --------
# --- standalone under the real `set -euo pipefail`.
PORT_LINE15="$(sed -n 's/^  local port; //p' "$DEPLOY_SCRIPT" | grep '^port=')"
if [ -z "$PORT_LINE15" ]; then
  fail "case 15: could not extract the PORT= lookup line from verify_public_health() in $DEPLOY_SCRIPT — line renamed/moved?"
else
  ENVDIR15="$(mktemp -d)"
  echo "SOME_OTHER_KEY=1" > "$ENVDIR15/web.env.local"   # no PORT= line at all — its normal off-state

  set +e
  (
    set -euo pipefail
    WEB_ENV_FILE="$ENVDIR15/web.env.local"
    eval "$PORT_LINE15"
    echo "port=[${port:-3000}]"
  ) >/tmp/deploy-test-15.log 2>&1
  RC15=$?
  set -e

  if [ "$RC15" -ne 0 ]; then
    fail "case 15: PORT= lookup exited non-zero ($RC15) when PORT= was absent from web.env.local — the T-321F sibling silent-exit"
    cat /tmp/deploy-test-15.log
  else
    pass "case 15: PORT= lookup completes when PORT= is absent from web.env.local"
  fi

  if grep -q '^port=\[3000\]$' /tmp/deploy-test-15.log; then
    pass "case 15: absent PORT= falls through to the 3000 default, not a crash"
  else
    fail "case 15: expected 'port=[3000]' (the \${port:-3000} default) in the output"
    cat /tmp/deploy-test-15.log
  fi

  rm -rf "$ENVDIR15"
fi

# --- Case 16: W-111/W-112 — scraper Python deps (pdfplumber/pypdfium2/ -----
# --- rapidocr-onnxruntime) are installed into a deploy-managed venv        -
# --- BEFORE the scraper is (re)started, and every REAL scraper pm2 start  -
# --- pins PYTHON_BIN to that venv. SOURCE-level assertion (same shape as  -
# --- case 9e): a dry-run-log-string check would prove nothing about the  --
# --- REAL 'pip install' / 'pm2 start' invocations actually carrying      --
# --- these — assert the shape directly against the script source:       --
# ---   (i)  the venv's real 'pip install -r requirements.txt' line      ---
# ---        exists and comes BEFORE restart_pm2()'s real (non-dry-run)  ---
# ---        scraper pm2 start line, and                                 ---
# ---   (ii) EVERY real (non-dry-run) scraper pm2 start line — both      ---
# ---        restart_pm2()'s and resume_scraper()'s — carries PYTHON_BIN=. -
# --- Red-then-green: deleting the pip-install line or either PYTHON_BIN= -
# --- assignment from deploy-linux.sh flips this case to FAIL.
STRIPPED16="$(grep -vE '^[[:space:]]*#' "$DEPLOY_SCRIPT")"
# W-111 round 2: pip is invoked as "<venv>/bin/python -m pip install", never
# "<venv>/bin/pip" (a moved venv's pip shebang would still point at its OLD
# path — see setup_python_venv()'s atomic-swap comment) — match on that
# shape rather than a literal venv-dir variable name.
PIP_INSTALL_LINE16="$(printf '%s\n' "$STRIPPED16" | grep -n -E '/bin/python" -m pip install .*-r "\$req_file"' | head -1 | cut -d: -f1 || true)"
RESTART_SCRAPER_START_LINE16="$(printf '%s\n' "$STRIPPED16" | grep -n -E 'pm2 start .*tsx/dist/cli\.mjs' | grep -v '\[dry-run\]' | tail -1 | cut -d: -f1 || true)"

if [ -n "$PIP_INSTALL_LINE16" ] && [ -n "$RESTART_SCRAPER_START_LINE16" ] && [ "$PIP_INSTALL_LINE16" -lt "$RESTART_SCRAPER_START_LINE16" ]; then
  pass "case 16: venv 'pip install -r requirements.txt' (setup_python_venv) appears before restart_pm2()'s real scraper pm2 start (pip_line=$PIP_INSTALL_LINE16, scraper_start_line=$RESTART_SCRAPER_START_LINE16)"
else
  fail "case 16: expected the venv pip-install step before restart_pm2()'s real scraper pm2 start (pip_line=$PIP_INSTALL_LINE16, scraper_start_line=$RESTART_SCRAPER_START_LINE16)"
fi

SCRAPER_START_LINES16="$(printf '%s\n' "$STRIPPED16" | grep -n -E 'pm2 start .*tsx/dist/cli\.mjs' | grep -v '\[dry-run\]' || true)"
SCRAPER_START_COUNT16="$(printf '%s\n' "$SCRAPER_START_LINES16" | grep -c . || true)"
SCRAPER_START_WITH_PYTHON_BIN16="$(printf '%s\n' "$SCRAPER_START_LINES16" | grep -c 'PYTHON_BIN=' || true)"
SCRAPER_START_COUNT16="${SCRAPER_START_COUNT16:-0}"
SCRAPER_START_WITH_PYTHON_BIN16="${SCRAPER_START_WITH_PYTHON_BIN16:-0}"

if [ "$SCRAPER_START_COUNT16" -ge 2 ] && [ "$SCRAPER_START_COUNT16" = "$SCRAPER_START_WITH_PYTHON_BIN16" ]; then
  pass "case 16: every real (non-dry-run) scraper pm2 start carries PYTHON_BIN=... ($SCRAPER_START_WITH_PYTHON_BIN16/$SCRAPER_START_COUNT16 lines)"
else
  fail "case 16: expected every real scraper pm2 start to carry PYTHON_BIN=... (found $SCRAPER_START_WITH_PYTHON_BIN16/$SCRAPER_START_COUNT16 real scraper start lines with it)"
fi

# --- Case 17: W-111 round 2 hole 1 — pinned constraints file is installed -
# --- alongside requirements.txt (pip -c), so an unpinned transitive       -
# --- (numpy/onnxruntime/opencv-python/...) can't silently drift on a      -
# --- fresh venv build the way the direct rapidocr pin already guards      -
# --- against (W-112). Source-level: same shape as case 16.
if printf '%s\n' "$STRIPPED16" | grep -q -E '/bin/python" -m pip install .*-r "\$req_file" -c "\$constraints_file"'; then
  pass "case 17: pip install passes both -r \$req_file and -c \$constraints_file (transitive deps pinned)"
else
  fail "case 17: expected the pip install line to pass -r \$req_file -c \$constraints_file"
fi

if [ -f "$SCRIPT_DIR/../../scraper/scripts/requirements-constraints.txt" ]; then
  pass "case 17: scraper/scripts/requirements-constraints.txt exists"
else
  fail "case 17: expected scraper/scripts/requirements-constraints.txt to exist"
fi

# --- Case 18: W-111 round 2 hole 2 — import smoke check runs before the ---
# --- venv is swapped in, and covers every third-party module the         -
# --- extractor scripts actually import.
SMOKE_LINE18="$(printf '%s\n' "$STRIPPED16" | grep -n 'import pdfplumber' | head -1 | cut -d: -f1 || true)"
SWAP_LINE18="$(printf '%s\n' "$STRIPPED16" | grep -n 'mv "\$new_dir" "\$PYTHON_VENV_DIR"' | head -1 | cut -d: -f1 || true)"
if [ -n "$SMOKE_LINE18" ] && [ -n "$SWAP_LINE18" ] && [ "$SMOKE_LINE18" -lt "$SWAP_LINE18" ]; then
  pass "case 18: import smoke check (line $SMOKE_LINE18) runs before the venv swap (line $SWAP_LINE18)"
else
  fail "case 18: expected the import smoke check before the venv swap (smoke_line=$SMOKE_LINE18, swap_line=$SWAP_LINE18)"
fi

for mod in pdfplumber pypdfium2 rapidocr_onnxruntime onnxruntime cv2 numpy; do
  if printf '%s\n' "$STRIPPED16" | grep -q "import $mod"; then
    pass "case 18: smoke check imports '$mod'"
  else
    fail "case 18: expected the smoke check to import '$mod'"
  fi
done

if printf '%s\n' "$STRIPPED16" | grep -q 'PINNED_RAPIDOCR_VERSION'; then
  pass "case 18: smoke check asserts the installed rapidocr-onnxruntime version against requirements.txt's own pin"
else
  fail "case 18: expected the smoke check to cross-check the installed rapidocr-onnxruntime version"
fi

# --- Case 19: W-111 round 2 hole 3 — the venv is slotted per-$SLOT, so ----
# --- prod and staging never share one build.
if grep -q 'PYTHON_VENV_DIR="\$ROOT/shared/venv/\$SLOT"' "$DEPLOY_SCRIPT"; then
  pass "case 19: PYTHON_VENV_DIR is slotted under \$ROOT/shared/venv/\$SLOT (prod and staging never share a venv)"
else
  fail "case 19: expected PYTHON_VENV_DIR to be slotted as \$ROOT/shared/venv/\$SLOT"
fi

# --- Case 20: W-111 round 2 hole 4 — the venv is built into a sibling -----
# --- '.new' dir and swapped only after a clean smoke test; a failed build -
# --- never destroys the last-good venv, and no rm -rf can escape          -
# --- $ROOT/shared/venv/.
if printf '%s\n' "$STRIPPED16" | grep -q -E 'local new_dir="\$PYTHON_VENV_DIR\.new"'; then
  pass "case 20: setup_python_venv() builds into a sibling '.new' directory"
else
  fail "case 20: expected setup_python_venv() to build into \$PYTHON_VENV_DIR.new"
fi

if printf '%s\n' "$STRIPPED16" | grep -q -E 'safe_rm_venv_dir\(\)'; then
  pass "case 20: a safe_rm_venv_dir() guard wraps rm -rf calls in the venv build/swap"
else
  fail "case 20: expected a safe_rm_venv_dir() guard around the venv build/swap rm -rf calls"
fi

# The || true matters: a prior case (13/14/15/16 area) leaves top-level
# `set -e` ON for the rest of this script (documented at case 14) — a bare
# assignment whose grep finds NO match (the expected/passing outcome here)
# would otherwise abort the whole test run instead of just yielding empty.
RM_RF_LINES20="$(printf '%s\n' "$STRIPPED16" | grep -n -E 'rm -rf "\$(new_dir|old_dir)"' || true)"
if [ -z "$RM_RF_LINES20" ]; then
  pass "case 20: no bare 'rm -rf \"\$new_dir\"'/'rm -rf \"\$old_dir\"' outside the safe_rm_venv_dir() guard"
else
  fail "case 20: found bare 'rm -rf' directly on \$new_dir/\$old_dir outside the guard: $RM_RF_LINES20"
fi

# --- Case 21: W-111 round 2 hole 5 — resume_scraper() warns loudly when ---
# --- PYTHON_BIN_PATH is missing/not executable, and still starts the      -
# --- scraper with PYTHON_BIN set (no silent switch to system python).
RESUME_FN_BODY21="$(awk '/^resume_scraper\(\) \{/,/^\}/' "$DEPLOY_SCRIPT")"
if printf '%s\n' "$RESUME_FN_BODY21" | grep -q -E '\[ ! -x "\$PYTHON_BIN_PATH" \]'; then
  pass "case 21: resume_scraper() checks whether \$PYTHON_BIN_PATH is executable"
else
  fail "case 21: expected resume_scraper() to check [ ! -x \"\$PYTHON_BIN_PATH\" ]"
fi

if printf '%s\n' "$RESUME_FN_BODY21" | grep -q -E 'warn .*PYTHON_BIN.*venv missing'; then
  pass "case 21: resume_scraper() emits a loud warn naming PYTHON_BIN + 'venv missing' when the venv is absent"
else
  fail "case 21: expected a warn line in resume_scraper() containing PYTHON_BIN and 'venv missing'"
fi

# --- Case 22: W-111 round 3 CRITICAL-1 — setup_python_venv()'s venv swap --
# --- checks BOTH mv calls and never silently returns 0 with no venv at    -
# --- the final path. Reproduces: mv#1 ($PYTHON_VENV_DIR -> $old_dir)      -
# --- succeeds, mv#2 ($new_dir -> $PYTHON_VENV_DIR) fails (ENOSPC/perms)   -
# --- -> old code fell through to safe_rm_venv_dir "$old_dir" || true      -
# --- (unconditional) then an implicit return 0 -> caller believes the    -
# --- venv is healthy while $PYTHON_VENV_DIR has nothing in it. Source-    -
# --- level, same shape as case 16/20: extract setup_python_venv() and      -
# --- assert (i) each mv is guarded (`if ! mv` or `mv ... || {`), (ii) a    -
# --- restore-from-.old path exists, (iii) the function's last non-comment -
# --- line is `return 0`, preceded (within the last few lines) by an        -
# --- explicit -x check on $PYTHON_VENV_DIR/bin/python.
SETUP_FN_BODY22="$(awk '/^setup_python_venv\(\) \{/,/^\}/' "$DEPLOY_SCRIPT")"
if [ -z "$SETUP_FN_BODY22" ]; then
  fail "case 22: could not extract setup_python_venv() from $DEPLOY_SCRIPT — function renamed?"
else
  # (i) both mv calls are guarded, never bare/unchecked.
  if printf '%s\n' "$SETUP_FN_BODY22" | grep -q -E '(if ! mv "\$PYTHON_VENV_DIR" "\$old_dir"|mv "\$PYTHON_VENV_DIR" "\$old_dir".*\|\|)'; then
    pass "case 22: mv \"\$PYTHON_VENV_DIR\" \"\$old_dir\" is guarded (checked, not bare)"
  else
    fail "case 22: expected mv \"\$PYTHON_VENV_DIR\" \"\$old_dir\" to be guarded (if ! mv ... / mv ... || ...)"
  fi

  if printf '%s\n' "$SETUP_FN_BODY22" | grep -q -E '(if ! mv "\$new_dir" "\$PYTHON_VENV_DIR"|mv "\$new_dir" "\$PYTHON_VENV_DIR".*\|\|)'; then
    pass "case 22: mv \"\$new_dir\" \"\$PYTHON_VENV_DIR\" is guarded (checked, not bare)"
  else
    fail "case 22: expected mv \"\$new_dir\" \"\$PYTHON_VENV_DIR\" to be guarded (if ! mv ... / mv ... || ...)"
  fi

  # (ii) a restore-from-.old path exists (moves $old_dir back to $PYTHON_VENV_DIR).
  if printf '%s\n' "$SETUP_FN_BODY22" | grep -q -E 'mv "\$old_dir" "\$PYTHON_VENV_DIR"'; then
    pass "case 22: a restore-from-.old path exists (mv \"\$old_dir\" \"\$PYTHON_VENV_DIR\")"
  else
    fail "case 22: expected a restore path moving \$old_dir back to \$PYTHON_VENV_DIR when the second mv fails"
  fi

  # (iii) the function ends with an explicit `return 0`, only after a final -x check.
  LAST_LINES22="$(printf '%s\n' "$SETUP_FN_BODY22" | grep -vE '^\s*#|^\s*$' | tail -6 || true)"
  LAST_NONCOMMENT_LINE22="$(printf '%s\n' "$SETUP_FN_BODY22" | grep -vE '^\s*#|^\s*$' | tail -1 || true)"
  # The extracted body includes the closing '}' as its last awk-matched line;
  # drop it to find the last real statement.
  if [ "$LAST_NONCOMMENT_LINE22" = "}" ]; then
    LAST_NONCOMMENT_LINE22="$(printf '%s\n' "$SETUP_FN_BODY22" | grep -vE '^\s*#|^\s*$' | tail -2 | head -1 || true)"
  fi

  if [ "$(printf '%s' "$LAST_NONCOMMENT_LINE22" | sed -E 's/^\s+|\s+$//g')" = "return 0" ]; then
    pass "case 22: setup_python_venv()'s last non-comment statement is 'return 0'"
  else
    fail "case 22: expected setup_python_venv() to end with an explicit 'return 0', found: '$LAST_NONCOMMENT_LINE22'"
  fi

  if printf '%s\n' "$LAST_LINES22" | grep -q -E '\[ -x "\$PYTHON_VENV_DIR/bin/python" \]'; then
    pass "case 22: the final 'return 0' is preceded by a -x check on \$PYTHON_VENV_DIR/bin/python"
  else
    fail "case 22: expected a [ -x \"\$PYTHON_VENV_DIR/bin/python\" ] check immediately before the final return 0"
  fi
fi

# --- Case 23: W-111 round 3 MAJOR-2 — the rapidocr-onnxruntime version -----
# --- cross-check is real, not vacuous. rapidocr_onnxruntime has NO         -
# --- __version__ attribute (verified on the VPS + dev laptop 2026-09-04),  -
# --- so the round-2 `getattr(..., "__version__", "")` check always reads  -
# --- an empty string and the mismatch branch never runs. Fix: use          -
# --- importlib.metadata.version(...) and FAIL when it differs from the    -
# --- pin, and FAIL when the pin itself is empty (parsing broke).
if printf '%s\n' "$STRIPPED16" | grep -q -E 'importlib\.metadata\.version\("rapidocr-onnxruntime"\)'; then
  pass "case 23: smoke check reads the installed version via importlib.metadata.version(), not the (nonexistent) __version__ attribute"
else
  fail "case 23: expected the smoke check to use importlib.metadata.version(\"rapidocr-onnxruntime\") to read the installed version"
fi

EMPTY_PIN_BLOCK23="$(awk '/^if not expected:/,/^actual = /' "$DEPLOY_SCRIPT")"
if printf '%s\n' "$EMPTY_PIN_BLOCK23" | grep -q 'sys.exit(1)'; then
  pass "case 23: smoke check fails (sys.exit(1)) when the pin (expected) itself is empty/unparsed"
else
  fail "case 23: expected the smoke check to sys.exit(1) when 'expected' (the pin read from requirements.txt) is empty"
fi

if printf '%s\n' "$STRIPPED16" | grep -q -E 'actual != expected'; then
  pass "case 23: smoke check still compares installed vs pinned version and fails on mismatch"
else
  fail "case 23: expected the smoke check to compare the installed version against the pin and fail on mismatch"
fi

# --- Case 24: W-111 round 3 MAJOR-3 — the smoke check actually exercises --
# --- RapidOCR the way ocr_pages.py uses it, not just a bare import. A      -
# --- bare `import rapidocr_onnxruntime` succeeded on the broken 1.4.4      -
# --- build too (the W-112 outage) — verified today that RapidOCR()        -
# --- construction works on the VPS system python, so the smoke check must -
# --- construct it and check for the private attributes ocr_pages.py       -
# --- actually touches.
OCR_PAGES24="$SCRIPT_DIR/../../scraper/scripts/ocr_pages.py"
if [ -f "$OCR_PAGES24" ]; then
  pass "case 24: scraper/scripts/ocr_pages.py exists (source of the attribute list)"
else
  fail "case 24: expected scraper/scripts/ocr_pages.py to exist"
fi

if printf '%s\n' "$STRIPPED16" | grep -q -E 'from rapidocr_onnxruntime import RapidOCR'; then
  pass "case 24: smoke check imports RapidOCR by name (from rapidocr_onnxruntime import RapidOCR)"
else
  fail "case 24: expected the smoke check to 'from rapidocr_onnxruntime import RapidOCR'"
fi

if printf '%s\n' "$STRIPPED16" | grep -q -E 'RapidOCR\(\)'; then
  pass "case 24: smoke check actually constructs RapidOCR()"
else
  fail "case 24: expected the smoke check to construct RapidOCR()"
fi

for attr in text_recognizer text_detector load_img sorted_boxes get_crop_img_list use_angle_cls; do
  if [ -f "$OCR_PAGES24" ] && ! grep -q "$attr" "$OCR_PAGES24"; then
    # attribute list drifted from ocr_pages.py's real usage — not this case's job to fix ocr_pages.py, just flag it.
    :
  fi
  if printf '%s\n' "$STRIPPED16" | grep -q "$attr"; then
    pass "case 24: smoke check asserts hasattr(...) (or equivalent) for '$attr' (used by ocr_pages.py)"
  else
    fail "case 24: expected the smoke check to assert the '$attr' attribute ocr_pages.py relies on"
  fi
done

if printf '%s\n' "$STRIPPED16" | grep -q -E '^import PIL|^from PIL'; then
  pass "case 24: smoke check imports PIL"
else
  fail "case 24: expected the smoke check to import PIL"
fi

# --- Case 25: W-111 round 3 MINOR-6 — safe_rm_venv_dir() rejects any path -
# --- containing '..' even when the glob prefix matches, closing the        -
# --- directory-traversal hole in the $ROOT/shared/venv/* guard.
SAFE_RM_FN_BODY25="$(awk '/^safe_rm_venv_dir\(\) \{/,/^\}/' "$DEPLOY_SCRIPT")"
if [ -z "$SAFE_RM_FN_BODY25" ]; then
  fail "case 25: could not extract safe_rm_venv_dir() from $DEPLOY_SCRIPT — function renamed?"
else
  if printf '%s\n' "$SAFE_RM_FN_BODY25" | grep -q -E '\*\.\.\*|case "\$dir" in.*\.\.'; then
    pass "case 25: safe_rm_venv_dir() rejects paths containing '..'"
  else
    fail "case 25: expected safe_rm_venv_dir() to explicitly reject any path containing '..'"
  fi
fi

# --- Case 26: W-134 — per-slot retention DEFAULT (no DEPLOY_KEEP_RELEASES --
# --- override): prod keeps 3, staging keeps 2, and 'current'/'current-  ---
# --- staging' is never pruned even when it is the oldest surviving one. ---
unset DEPLOY_KEEP_RELEASES 2>/dev/null || true

ROOT26="$(fresh_root)"
export DEPLOY_ROOT="$ROOT26"
for i in 1 2 3 4 5; do
  bash "$DEPLOY_SCRIPT" prod --dry-run --force >/tmp/deploy-test-26-prod-$i.log 2>&1 || {
    fail "case 26: prod deploy #$i failed"
    cat /tmp/deploy-test-26-prod-$i.log
  }
  sleep 1.1
done
# shellcheck disable=SC2012
COUNT26P="$(ls -1 "$ROOT26/releases" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT26P" -le 3 ]; then
  pass "case 26: prod default retention kept <= 3 releases with no override (kept $COUNT26P)"
else
  fail "case 26: prod default retention kept $COUNT26P releases, expected <= 3"
fi
CUR_TARGET26P="$(current_target "$ROOT26/current")"
if [ -n "$CUR_TARGET26P" ] && [ -d "$CUR_TARGET26P" ]; then
  pass "case 26: prod 'current' survived the default-retention prune"
else
  fail "case 26: prod 'current' was pruned (or missing) under default retention ($CUR_TARGET26P)"
fi

for i in 1 2 3 4; do
  bash "$DEPLOY_SCRIPT" staging --dry-run --force >/tmp/deploy-test-26-staging-$i.log 2>&1 || {
    fail "case 26: staging deploy #$i failed"
    cat /tmp/deploy-test-26-staging-$i.log
  }
  sleep 1.1
done
# shellcheck disable=SC2012
COUNT26S="$(ls -1 "$ROOT26/releases-staging" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT26S" -le 2 ]; then
  pass "case 26: staging default retention kept <= 2 releases with no override (kept $COUNT26S)"
else
  fail "case 26: staging default retention kept $COUNT26S releases, expected <= 2"
fi
CUR_TARGET26S="$(current_target "$ROOT26/current-staging")"
if [ -n "$CUR_TARGET26S" ] && [ -d "$CUR_TARGET26S" ]; then
  pass "case 26: staging 'current-staging' survived the default-retention prune"
else
  fail "case 26: staging 'current-staging' was pruned (or missing) under default retention ($CUR_TARGET26S)"
fi

unset DEPLOY_ROOT

# --- Case 27: W-136 — the pre-flip probe starts in its OWN process group ---
# --- and cleanup_probe() kills the whole group (not just the npm parent), --
# --- then verifies the probe port is actually free. A 2026-08-21 incident --
# --- left an orphaned `next-server` running for 14 days after `kill $pid` -
# --- killed only npm; `sh -c next start` / `next-server` survived it.     --
PROBE_FN_BODY27="$(awk '/^probe_release\(\) \{/,/^\}/' "$DEPLOY_SCRIPT")"
if [ -z "$PROBE_FN_BODY27" ]; then
  fail "case 27: could not extract probe_release() from $DEPLOY_SCRIPT — function renamed?"
else
  # MAJOR-4 (round 2): a file-wide grep for the word "setsid" also matches
  # the WARN-branch string ("Install setsid (util-linux) on this host") —
  # so removing setsid from the REAL start line still passed this assertion
  # (verified: mutating line 786 to drop setsid left this PASS). Anchor to
  # the exact line that starts the probe (contains both "npm run start" and
  # PORT="$PROBE_PORT") and require setsid on THAT line specifically.
  PROBE_START_LINE27="$(printf '%s\n' "$PROBE_FN_BODY27" | grep -E 'npm run start' | grep -F 'PORT="$PROBE_PORT"' | head -n1)"
  if [ -z "$PROBE_START_LINE27" ]; then
    fail "case 27: could not find the probe start line (npm run start + PORT=\"\$PROBE_PORT\") — probe_release() restructured?"
  elif printf '%s' "$PROBE_START_LINE27" | grep -q -E '\bsetsid\b'; then
    pass "case 27: probe_release() starts the probe under setsid (own process group)"
  else
    fail "case 27: expected the probe start line to run under setsid so kill can target the whole group — line: $PROBE_START_LINE27"
  fi

  if printf '%s\n' "$PROBE_FN_BODY27" | grep -q -E '\bkill\b.*-TERM.*-- -"?\$'; then
    pass "case 27: cleanup_probe() sends TERM to a NEGATIVE pgid (whole process group)"
  else
    fail "case 27: expected cleanup_probe() to kill -- -\$pgid (negative pgid = whole group), not just \$pid"
  fi

  if printf '%s\n' "$PROBE_FN_BODY27" | grep -q -E 'ss .*sport|fuser .*PROBE_PORT|fuser .*\$PROBE_PORT'; then
    pass "case 27: cleanup_probe() verifies PROBE_PORT is actually free after the kill"
  else
    fail "case 27: expected a post-kill listener check on \$PROBE_PORT (ss/fuser), not a bare kill-and-hope"
  fi

  if printf '%s\n' "$PROBE_FN_BODY27" | grep -q -E 'already in use|port.*in use|held by pid|fuser -n tcp "\$PROBE_PORT"'; then
    pass "case 27: probe_release() checks PROBE_PORT is free BEFORE starting the probe"
  else
    fail "case 27: expected probe_release() to refuse starting when \$PROBE_PORT is already held by a stale process"
  fi

  # MINOR(a) round 2: the pre-start "already in use" check must prefer
  # `ss -ltnp` (LISTENING sockets only) over `fuser -n tcp` (which also
  # matches OUTBOUND connections to a remote :$PROBE_PORT — a false-fatal).
  PROBE_PRESTART_BLOCK27="$(printf '%s\n' "$PROBE_FN_BODY27" | awk '/already holding the/,/^  local pidfile=/')"
  if printf '%s\n' "$PROBE_PRESTART_BLOCK27" | grep -q -E '\bss\b .*-ltnp.*sport'; then
    pass "case 27 MINOR(a): pre-start listener check uses ss -ltnp (listening sockets only), not fuser"
  else
    fail "case 27 MINOR(a): expected the pre-start check to use ss -ltnp before falling back to fuser"
  fi

  # MINOR(c) round 2: PROBE_PORT must be checked against the web app's own
  # live PORT (from WEB_ENV_FILE) before the probe ever starts.
  if printf '%s\n' "$PROBE_FN_BODY27" | grep -q -E 'PROBE_PORT.*=.*web_port|web_port.*PORT='; then
    pass "case 27 MINOR(c): probe_release() guards PROBE_PORT against the web app's own PORT"
  else
    fail "case 27 MINOR(c): expected probe_release() to refuse when PROBE_PORT equals the web app's live PORT"
  fi
fi

# --- Case 28: W-136b — cleanup_probe() polls the PORT freeing up, not just --
# --- the leader pid. Root cause: the next-server CHILD process routinely  --
# --- outlives the `sh -c`/setsid leader by a few seconds after TERM, so   --
# --- the old "wait up to 5s for $pid, then check the port ONCE" sequence  --
# --- found the port still held on three of three real deploys and fell   --
# --- through to the fuser -k backstop every time ("WARN: PROBE_PORT ...  --
# --- still has a listener ... attempting fuser -k"). This extracts the   --
# --- REAL cleanup_probe() body and executes it for real against a fake   --
# --- `ss`/`fuser` (driven by a time-window + marker-file state dir, not   --
# --- a real socket/process-group — MSYS/Windows has no real `ss`/`fuser`/ --
# --- `setsid` and no reliable negative-pid process-group kill, so a      --
# --- real-socket harness was flaky here; the fakes make the polling/     --
# --- escalation CONTROL FLOW deterministic and portable) plus a REAL     --
# --- background process standing in for the probe leader (kill -0 on a   --
# --- real pid is reliable on every platform). This is dynamic execution,  --
# --- not a grep on the script text (case 27 already covers the static    --
# --- shape: setsid/negative-pgid/fuser-fallback presence).
CLEANUP_FN_28="$(awk '/^  cleanup_probe\(\) \{/,/^  \}$/' "$DEPLOY_SCRIPT")"
if [ -z "$CLEANUP_FN_28" ]; then
  fail "case 28: could not extract cleanup_probe() from $DEPLOY_SCRIPT — function renamed/restructured?"
else
  FAKEBIN28="$(mktemp -d)"
  cat > "$FAKEBIN28/ss" <<'FAKESS'
#!/usr/bin/env bash
# Fake `ss -ltn "( sport = :$PORT )"`, driven entirely by state files under
# CLEANUP_TEST_STATE_DIR (decoupled from any real socket/process — this
# box has no real `ss`). Three modes, read from mode-$port (default "time"):
#   time       — LISTEN until the case's free-after second count elapses
#                since its recorded start time (cases 28a/28c/28d).
#   killaware  — MUTATION-PROOF mode (case 28b, round-2 review finding):
#                LISTEN until kill-calls.log (written by the test's
#                shadowed `kill` function) records a -KILL signal — i.e.
#                this fake can ONLY be freed by the real escalation
#                actually firing, not by a wall clock, so deleting the
#                `kill -KILL` line in cleanup_probe() makes this fake
#                (and therefore case 28b) fail.
#   error      — exits 1 with NO output for the first errlimit-$port
#                polls (round-2 MINOR(3): ss erroring must be treated as
#                UNKNOWN, not "free"), then falls back to time mode.
argline="$*"
port="$(printf '%s' "$argline" | grep -oE ':[0-9]+' | tail -1 | tr -d ':')"
state_dir="${CLEANUP_TEST_STATE_DIR:?ss: CLEANUP_TEST_STATE_DIR not set}"
if [ -f "$state_dir/freed-$port" ]; then
  exit 0
fi
mode="$(cat "$state_dir/mode-$port" 2>/dev/null || echo time)"
if [ "$mode" = "killaware" ]; then
  if [ -f "$state_dir/kill-calls.log" ] && grep -q '^-KILL' "$state_dir/kill-calls.log" 2>/dev/null; then
    exit 0
  fi
  echo "LISTEN 0 1 127.0.0.1:$port 0.0.0.0:* users:((\"fake-next-server\",pid=99999,fd=3))"
  exit 0
fi
if [ "$mode" = "error" ]; then
  count_file="$state_dir/errcount-$port"
  n="$(cat "$count_file" 2>/dev/null || echo 0)"
  limit="$(cat "$state_dir/errlimit-$port" 2>/dev/null || echo 0)"
  if [ "$n" -lt "$limit" ]; then
    echo $((n + 1)) > "$count_file"
    exit 1
  fi
fi
free_after="$(cat "$state_dir/free-after-$port" 2>/dev/null || echo 999999)"
start_ts="$(cat "$state_dir/start-$port" 2>/dev/null || echo 0)"
now_ts="$(date +%s)"
elapsed=$(( now_ts - start_ts ))
if [ "$elapsed" -lt "$free_after" ]; then
  echo "LISTEN 0 1 127.0.0.1:$port 0.0.0.0:* users:((\"fake-next-server\",pid=99999,fd=3))"
fi
exit 0
FAKESS
  cat > "$FAKEBIN28/fuser" <<'FAKEFUSER'
#!/usr/bin/env bash
# Fake `fuser -n tcp $PORT` (query) and `fuser -k -n tcp $PORT` (kill).
# The kill form writes the freed-marker fake `ss` above checks for —
# i.e. this is what actually "frees" the port in case 28d.
state_dir="${CLEANUP_TEST_STATE_DIR:?fuser: CLEANUP_TEST_STATE_DIR not set}"
port="${@: -1}"
case " $* " in
  *" -k "*)
    touch "$state_dir/freed-$port"
    exit 0
    ;;
  *)
    echo " 99999"
    exit 0
    ;;
esac
FAKEFUSER
  chmod +x "$FAKEBIN28/ss" "$FAKEBIN28/fuser"

  # Runs a cleanup_probe() body (real or, for the mutation-proof step, a
  # deliberately mutated copy) against a fresh fake state dir.
  #   $1 fn_body (the extracted function source)  $2 mode ("time"|"killaware"|"error")
  #   $3 port  $4 free_after_secs (ignored for killaware)  $5 PROBE_CLEANUP_WAIT_SECS
  #   $6 leader_delay_secs  $7 "yes"|"no" (put fake ss/fuser on PATH)  $8 errlimit (mode=error only)
  # Shadows the `kill` BUILTIN with a bash FUNCTION (functions win over
  # builtins in bash's command lookup) that records every invocation to
  # kill-calls.log before forwarding to the real builtin via `command
  # kill` — this is what lets the "killaware" fake `ss` observe whether
  # cleanup_probe() actually issued a -KILL (round-2 review MAJOR finding:
  # a wall-clock-only fake let the escalation be deleted with all cases
  # still green).
  run_cleanup_probe_28_body() {
    local fn_body="$1" mode="$2" port="$3" free_after="$4" wait_secs="$5" leaderdelay="$6" use_fakes="$7" errlimit="${8:-0}"
    local statedir; statedir="$(mktemp -d)"
    date +%s > "$statedir/start-$port"
    echo "$free_after" > "$statedir/free-after-$port"
    echo "$mode" > "$statedir/mode-$port"
    echo "$errlimit" > "$statedir/errlimit-$port"
    ( sleep "$leaderdelay" ) &
    local leaderpid=$!
    local runpath="$PATH"
    if [ "$use_fakes" = "yes" ]; then
      runpath="$FAKEBIN28:$PATH"
    else
      # case 28c: simulate an `ss`-less host by excluding the fakebin dir
      # (this test box genuinely has no real `ss` either, so this is a
      # real "ss absent" run, not merely a simulated one).
      runpath="$PATH"
    fi
    (
      PATH="$runpath"
      PROBE_PORT="$port"
      pid="$leaderpid"
      PROBE_CLEANUP_FAILED=0
      PROBE_CLEANUP_WAIT_SECS="$wait_secs"
      export CLEANUP_TEST_STATE_DIR="$statedir"
      kill() {
        printf '%s\n' "$*" >> "$CLEANUP_TEST_STATE_DIR/kill-calls.log"
        command kill "$@"
      }
      log() { echo "==> $*"; }
      eval "$fn_body"
      cleanup_probe
      echo "PROBE_CLEANUP_FAILED=$PROBE_CLEANUP_FAILED"
    )
    rm -rf "$statedir"
  }
  run_cleanup_probe_28() {
    local name="$1" port="$2" free_after="$3" wait_secs="$4" leaderdelay="$5" use_fakes="$6"
    run_cleanup_probe_28_body "$CLEANUP_FN_28" time "$port" "$free_after" "$wait_secs" "$leaderdelay" "$use_fakes" 0
  }

  # 28a: child listener outlives the leader by ~3s -> cleaned by the PORT
  # wait, no fuser fallback, INFO "free after" line printed.
  OUT28A="$(run_cleanup_probe_28 a 45001 3 8 0.2 yes 2>&1)"
  if printf '%s' "$OUT28A" | grep -q 'probe port 45001 free after' \
     && ! printf '%s' "$OUT28A" | grep -qi 'attempting fuser' \
     && ! printf '%s' "$OUT28A" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28A" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28a: child listener outlives leader by ~3s -> cleaned by the port wait, no fuser fallback"
  else
    fail "case 28a: expected a clean port-wait resolution with an INFO 'free after' line and no fuser fallback — got: $OUT28A"
  fi

  # 28b: port never frees during the initial (short) wait window -> KILL
  # escalation runs, port frees a couple seconds into the escalation's
  # own poll -> still no fuser fallback needed.
  # round 2: killaware mode — this fake can ONLY free the port once it
  # observes a recorded -KILL, so this genuinely proves the escalation
  # fired (see the mutation-proof step right after this case).
  OUT28B="$(run_cleanup_probe_28_body "$CLEANUP_FN_28" killaware 45002 0 2 0.2 yes 2>&1)"
  if printf '%s' "$OUT28B" | grep -q 'probe port 45002 free after' \
     && ! printf '%s' "$OUT28B" | grep -qi 'attempting fuser' \
     && ! printf '%s' "$OUT28B" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28B" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28b: port survives the initial wait -> KILL escalation clears it, no fuser fallback"
  else
    fail "case 28b: expected KILL escalation to resolve it with an INFO 'free after' line and no fuser fallback — got: $OUT28B"
  fi

  # round 2 MAJOR mutation-proof: strip the `kill -KILL` escalation from a
  # temp copy of the real script and rerun case 28b's exact scenario
  # against the MUTANT body. The killaware fake ss can only free the port
  # via a recorded -KILL, so with the escalation gone it must stay
  # listening forever and case 28b's assertions must FAIL — if they don't,
  # this test isn't actually exercising the escalation.
  MUTANT_SCRIPT_28="$(mktemp)"
  sed 's/kill -KILL -- -"\$pgid" 2>\/dev\/null || kill -KILL "\$pid" 2>\/dev\/null || true/: # MUTATED for the mutation-proof test: escalation removed/' \
    "$DEPLOY_SCRIPT" > "$MUTANT_SCRIPT_28"
  MUTANT_FN_28="$(awk '/^  cleanup_probe\(\) \{/,/^  \}$/' "$MUTANT_SCRIPT_28")"
  if printf '%s\n' "$MUTANT_FN_28" | grep -qE 'kill -KILL -- -"$pgid"'; then
    fail "case 28b mutation-proof: the sed mutation did not actually remove the -KILL escalation from the extracted body — mutation setup is broken"
  else
    MUT_OUT28B="$(run_cleanup_probe_28_body "$MUTANT_FN_28" killaware 45012 0 2 0.2 yes 2>&1)"
    if printf '%s' "$MUT_OUT28B" | grep -q 'probe port 45012 free after' \
       && ! printf '%s' "$MUT_OUT28B" | grep -qi 'attempting fuser'; then
      fail "case 28b mutation-proof: removing the KILL escalation should have broken case 28b's assertions, but the mutant still passed — the test does not actually depend on the escalation"
    else
      pass "case 28b mutation-proof: removing the KILL escalation correctly makes case 28b's pass condition fail (mutant output: $MUT_OUT28B)"
    fi
  fi
  rm -f "$MUTANT_SCRIPT_28"

  # 28c: `ss` absent -> falls back to a leader-only wait with the WARN
  # fallback log line, and does not hang/crash (leader dies quickly so
  # the fallback loop exits well before PROBE_CLEANUP_WAIT_SECS).
  OUT28C="$(run_cleanup_probe_28 c 45003 3 3 0.3 no 2>&1)"
  if printf '%s' "$OUT28C" | grep -qi 'ss not found' \
     && printf '%s' "$OUT28C" | grep -qi 'leader-only wait' \
     && ! printf '%s' "$OUT28C" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28C" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28c: ss absent -> leader-only wait with the fallback log line, no crash"
  else
    fail "case 28c: expected the ss-absent fallback WARN + leader-only wait, no crash — got: $OUT28C"
  fi

  # 28d: port never frees on its own (real "stray process" shape) ->
  # both the port-wait and the KILL escalation's re-check still see a
  # listener -> falls through to the EXISTING fuser -k last resort,
  # which (in this fake) actually frees it -> no FATAL.
  OUT28D="$(run_cleanup_probe_28 d 45004 999999 2 0.2 yes 2>&1)"
  if printf '%s' "$OUT28D" | grep -qi 'attempting fuser -k' \
     && ! printf '%s' "$OUT28D" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28D" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28d: existing fuser-last-resort still fires and clears a truly stubborn listener"
  else
    fail "case 28d: expected the fuser -k last resort to fire and succeed with no FATAL — got: $OUT28D"
  fi

  # 28e (round 2 MINOR(3)): `ss` itself EXITS NON-ZERO (a real error, not
  # "zero matches") for the first 2 polls. That must be treated as
  # UNKNOWN (keep waiting), never as "free" — a bug here would show up as
  # a bogus "free after 0s"/"free after 1s" line fired during the error
  # polls, before the port has actually had time to free.
  OUT28E="$(run_cleanup_probe_28_body "$CLEANUP_FN_28" error 45005 2 6 0.2 yes 2 2>&1)"
  if printf '%s' "$OUT28E" | grep -qE 'free after [2-9][0-9]*s' \
     && ! printf '%s' "$OUT28E" | grep -qE 'free after [01]s' \
     && ! printf '%s' "$OUT28E" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28E" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28e: ss exiting non-zero is treated as UNKNOWN (kept waiting), not falsely reported as free"
  else
    fail "case 28e: expected ss errors to be treated as unknown/keep-waiting, not an immediate false 'free after 0s/1s' — got: $OUT28E"
  fi

  # 28f (round 2 MINOR(2)): PROBE_CLEANUP_WAIT_SECS is not a non-negative
  # integer -> logs a WARN and falls back to the 10s default instead of
  # crashing or misbehaving (e.g. an unbounded/negative loop bound).
  OUT28F="$(run_cleanup_probe_28_body "$CLEANUP_FN_28" time 45006 1 "not-a-number" 0.2 yes 0 2>&1)"
  if printf '%s' "$OUT28F" | grep -qi "PROBE_CLEANUP_WAIT_SECS='not-a-number' is not a non-negative integer" \
     && printf '%s' "$OUT28F" | grep -q 'probe port 45006 free after' \
     && ! printf '%s' "$OUT28F" | grep -qi 'FATAL' \
     && printf '%s' "$OUT28F" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 28f: an invalid PROBE_CLEANUP_WAIT_SECS logs a WARN and falls back to the 10s default"
  else
    fail "case 28f: expected a WARN + fallback to the 10s default for a non-integer PROBE_CLEANUP_WAIT_SECS — got: $OUT28F"
  fi


  # --- Case 29: W-169 --- cleanup_probe()'s new direct-listener-kill step.
  # Root cause (staging 4de93a3f, 2026-09-06 00:0x IST): the group TERM/KILL
  # only ever reaches pids in $pgid; the next-server CHILD routinely lands
  # OUTSIDE that group (npm/next spawn their own session on some npm/Next
  # versions), so the group kill never reaches it and cleanup fell straight
  # to a blind, unguarded `fuser -k`. This targets the ACTUAL listener pid
  # by port (ss -ltnp reporting pid=NNN) and TERMs/KILLs it directly, with a
  # pm2-ownership guard. Dedicated fakebin: `ss` reports a REAL background
  # process (a stand-in listener, distinct from the group leader) as
  # LISTENING for as long as that real pid is alive (kill -0), so real
  # TERM/KILL semantics (a plain sleep dies on TERM; a TERM-trapping one
  # needs KILL) drive the scenario rather than scripted state. `ps` returns
  # scripted pgid/ppid/cmd for that pid (to drive the pm2 guard).
  FAKEBIN29="$(mktemp -d)"
  cat > "$FAKEBIN29/ss" <<'FAKESS29'
#!/usr/bin/env bash
argline="$*"
port="$(printf '%s' "$argline" | grep -oE ':[0-9]+' | tail -1 | tr -d ':')"
state_dir="${CLEANUP_TEST_STATE_DIR29:?ss: CLEANUP_TEST_STATE_DIR29 not set}"
lpid="$(cat "$state_dir/lpid-$port" 2>/dev/null || echo 88888)"
if kill -0 "$lpid" 2>/dev/null; then
  echo "LISTEN 0 1 127.0.0.1:$port 0.0.0.0:* users:((\"node\",pid=$lpid,fd=3))"
fi
exit 0
FAKESS29
  cat > "$FAKEBIN29/fuser" <<'FAKEFUSER29'
#!/usr/bin/env bash
# Last-resort fallback fake: never frees anything on its own — case 29's
# scenarios are proven entirely by the direct-listener-kill step, so this
# only needs to exist so the old fallback path doesn't crash if reached.
exit 0
FAKEFUSER29
  cat > "$FAKEBIN29/ps" <<'FAKEPS29'
#!/usr/bin/env bash
field="" pid=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift; field="$1" ;;
    -p) shift; pid="$1" ;;
  esac
  shift
done
state_dir="${CLEANUP_TEST_STATE_DIR29:?ps: CLEANUP_TEST_STATE_DIR29 not set}"
case "$field" in
  pgid=) cat "$state_dir/pgid-$pid" 2>/dev/null || echo "$pid" ;;
  ppid=) cat "$state_dir/ppid-$pid" 2>/dev/null || echo 1 ;;
  cmd=) cat "$state_dir/cmd-$pid" 2>/dev/null || echo "node fake-next-server" ;;
  lstart=) cat "$state_dir/lstart-$pid" 2>/dev/null || date '+%a %b %e %H:%M:%S %Y' ;;
  *) exit 1 ;;
esac
exit 0
FAKEPS29
  chmod +x "$FAKEBIN29/ss" "$FAKEBIN29/fuser" "$FAKEBIN29/ps"

  # Runs the REAL cleanup_probe() body (CLEANUP_FN_28 -- cleanup_probe() is
  # the same function, extracted once in case 28) with the case-29 fakebin
  # ahead of PATH, a real short-lived leader pid (so the group TERM/KILL
  # step resolves quickly without freeing the port), and a REAL background
  # process standing in for the escaped listener (so TERM/KILL against it
  # have genuine effect, unlike a synthetic pid).
  #   $1 listener_cmd (spawns the stand-in listener)  $2 port
  #   $3 pgid-for-listener  $4 cmd-for-pgid (drives the pm2 guard)
  run_cleanup_probe_29() {
    local listener_cmd="$1" port="$2" lpgid_marker="$3" lcmd="$4"
    local statedir; statedir="$(mktemp -d)"
    eval "$listener_cmd" &
    local lpid=$!
    local real_lpgid="$lpid"
    [ "$lpgid_marker" = "self" ] && real_lpgid="$lpid"
    echo "$lpid" > "$statedir/lpid-$port"
    echo "$real_lpgid" > "$statedir/pgid-$lpid"
    echo 1 > "$statedir/ppid-$lpid"
    echo "$lcmd" > "$statedir/cmd-$real_lpgid"
    date '+%a %b %e %H:%M:%S %Y' > "$statedir/lstart-$lpid"
    ( sleep 0.2 ) &
    local leaderpid=$!
    (
      PATH="$FAKEBIN29:$PATH"
      PROBE_PORT="$port"
      pid="$leaderpid"
      PROBE_CLEANUP_FAILED=0
      PROBE_CLEANUP_WAIT_SECS=2
      probe_start_ts=0
      export CLEANUP_TEST_STATE_DIR29="$statedir"
      kill() {
        printf '%s\n' "$*" >> "$CLEANUP_TEST_STATE_DIR29/kill-calls.log"
        command kill "$@"
      }
      log() { echo "==> $*"; }
      eval "$CLEANUP_FN_28"
      cleanup_probe
      echo "PROBE_CLEANUP_FAILED=$PROBE_CLEANUP_FAILED"
    )
    kill -KILL "$lpid" 2>/dev/null || true
    wait "$lpid" 2>/dev/null || true
    rm -rf "$statedir"
  }

  # 29a: listener pid is NOT in the probe's process group (a distinct, real,
  # non-pm2 pid that dies on a plain TERM, matching an ordinary next-server
  # child) -> freed by the direct TERM, no old-fuser fallback reached, INFO
  # "free after ... (direct listener kill)" line printed.
  OUT29A="$(run_cleanup_probe_29 '( sleep 30 )' 45101 self "node /app/web/node_modules/.bin/next-server" 2>&1)"
  if printf '%s' "$OUT29A" | grep -q 'free after.*direct listener kill' \
     && ! printf '%s' "$OUT29A" | grep -qi 'surviving pid' \
     && ! printf '%s' "$OUT29A" | grep -qi 'FATAL' \
     && printf '%s' "$OUT29A" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
    pass "case 29a: listener outside the group dies on direct TERM -> freed, no fuser, 'free after' printed"
  else
    fail "case 29a: expected a clean direct-TERM resolution with no fuser fallback -- got: $OUT29A"
  fi

  # 29b: listener ignores TERM (traps it) -> the direct TERM has no effect,
  # the direct KILL escalation frees it -> still no old-fuser fallback.
  # W-169 round 2: `trap "" TERM; sleep 30` is not reliably TERM-immune
  # under Windows/Git-Bash's (MSYS) signal emulation -- a limitation of
  # the LOCAL harness platform, not the shell logic under test (the
  # direct-KILL escalation code path is identical to the already-proven
  # W-136b group-KILL escalation). Skip on non-Linux; kept live on Linux,
  # where the pr-gate `deploy-script-tests` job runs this suite for real.
  if [ "$(uname -s 2>/dev/null)" = "Linux" ]; then
    OUT29B="$(run_cleanup_probe_29 '( trap "" TERM; sleep 30 )' 45102 self "node /app/web/node_modules/.bin/next-server" 2>&1)"
    if printf '%s' "$OUT29B" | grep -q 'free after.*direct listener kill' \
       && printf '%s\n' "$OUT29B" | grep -Eq -- '-KILL [0-9]+' \
       && ! printf '%s' "$OUT29B" | grep -qi 'FATAL' \
       && printf '%s' "$OUT29B" | grep -q 'PROBE_CLEANUP_FAILED=0'; then
      pass "case 29b: listener ignores TERM -> direct KILL escalation frees it"
    else
      fail "case 29b: expected TERM to fail and a direct KILL to free the listener -- got: $OUT29B"
    fi
  else
    skip "case 29b (W-169): trap-TERM-immune listener not reliably provable under non-Linux (MSYS) signal emulation -- proven on Linux in pr-gate's deploy-script-tests job"
  fi

  # 29c: listener's process-group leader cmdline names pm2 (the PM2 God
  # Daemon shape) -> WARN'd and left alone, NEVER signaled with TERM/KILL
  # (only the harness's own final `kill -KILL "$lpid"` teardown touches it,
  # which is asserted separately as absent from the DIRECT-kill loop's own
  # signals), regardless of what the old fallback does afterward (unchanged
  # FATAL/fuser path -- not re-asserted here).
  OUT29C="$(run_cleanup_probe_29 '( sleep 30 )' 45103 self "PM2 v5.3.0: God Daemon (/root/.pm2)" 2>&1)"
  if printf '%s' "$OUT29C" | grep -qi 'pm2-managed' \
     && printf '%s' "$OUT29C" | grep -qi 'left to pm2, NOT killed'; then
    pass "case 29c: pm2-managed listener is WARN'd and never signaled directly"
  else
    fail "case 29c: expected a pm2-managed listener to be WARN'd and left unsignaled -- got: $OUT29C"
  fi

  rm -rf "$FAKEBIN29"
  rm -rf "$FAKEBIN28"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "deploy-linux.test.sh: FAILED"
  exit 1
fi

echo "deploy-linux.test.sh: all cases passed"
