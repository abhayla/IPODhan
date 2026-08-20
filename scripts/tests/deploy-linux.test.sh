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

if [ "$FAILED" -ne 0 ]; then
  echo "deploy-linux.test.sh: FAILED"
  exit 1
fi

echo "deploy-linux.test.sh: all cases passed"
