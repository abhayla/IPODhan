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
START_LINE9="$(grep -n '^==> \[dry-run\] env -u RUNNER_TRACKING_ID TZ=UTC pm2 start .*--name ipodhan-web ' /tmp/deploy-test-1.log | head -1 | cut -d: -f1)"
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

# --- Case 9e: W-126 — every pm2 start dry-run line (web AND scraper) must -
# --- strip RUNNER_TRACKING_ID before the process is started, so the GitHub
# --- self-hosted runner's post-job "Cleaning up orphan processes" step
# --- cannot SIGKILL the freshly-started pm2 process (it kills anything
# --- carrying its own RUNNER_TRACKING_ID). Fixture-driven: greps the same
# --- dry-run log used by case 9/10 above for the literal command shape.
SCRAPER_START_LINE9E="$(grep -n '^==> \[dry-run\] .*pm2 start .*--name ipodhan-scraper ' /tmp/deploy-test-1.log | head -1)"
if printf '%s' "$SCRAPER_START_LINE9E" | grep -q 'env -u RUNNER_TRACKING_ID TZ=UTC pm2 start'; then
  pass "case 9e: scraper dry-run pm2 start line strips RUNNER_TRACKING_ID (env -u RUNNER_TRACKING_ID)"
else
  fail "case 9e: scraper dry-run pm2 start line missing 'env -u RUNNER_TRACKING_ID' ($SCRAPER_START_LINE9E)"
fi
if printf '%s' "$WEB_START_CMD9" | grep -q 'env -u RUNNER_TRACKING_ID TZ=UTC pm2 start'; then
  pass "case 9e: web dry-run pm2 start line strips RUNNER_TRACKING_ID (env -u RUNNER_TRACKING_ID)"
else
  fail "case 9e: web dry-run pm2 start line missing 'env -u RUNNER_TRACKING_ID' ($WEB_START_CMD9)"
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
START_LINE10="$(grep -n '^==> \[dry-run\] env -u RUNNER_TRACKING_ID TZ=UTC pm2 start .*--name ipodhan-web ' /tmp/deploy-test-8-2.log | sed -n '2p' | cut -d: -f1)"
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

if [ "$FAILED" -ne 0 ]; then
  echo "deploy-linux.test.sh: FAILED"
  exit 1
fi

echo "deploy-linux.test.sh: all cases passed"
