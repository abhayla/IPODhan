#!/usr/bin/env bash
# W-141 — self-test for scripts/deploy/require-release-branch.sh.
# Builds a throwaway git repo under mktemp with a main branch, a
# release/prod-2026-09-05 branch, and a commit that exists only on main,
# then exercises the gate's pass/refuse decisions directly (no GitHub
# Actions, no network).
#
# Run: bash scripts/deploy/tests/require-release-branch.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE_SCRIPT="$SCRIPT_DIR/../require-release-branch.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

REPO="$(mktemp -d)"
(
  cd "$REPO" || exit 1
  git init -q -b main .
  git config user.email "test@example.com"
  git config user.name "Test"
  echo "one" > file.txt
  git add file.txt
  git commit -q -m "chore: initial commit on main"
  MAIN_ONLY_SHA="$(git rev-parse HEAD)"
  echo "$MAIN_ONLY_SHA" > /tmp/w141-main-only-sha.txt

  git branch release/prod-2026-09-05
  echo "two" > file.txt
  git add file.txt
  git commit -q -m "chore: main-only follow-up commit"
  git rev-parse HEAD > /tmp/w141-main-tip-sha.txt

  git checkout -q release/prod-2026-09-05
  git rev-parse HEAD > /tmp/w141-release-tip-sha.txt
)

MAIN_ONLY_SHA="$(cat /tmp/w141-main-only-sha.txt)"
MAIN_TIP_SHA="$(cat /tmp/w141-main-tip-sha.txt)"
RELEASE_TIP_SHA="$(cat /tmp/w141-release-tip-sha.txt)"

run_gate() {
  (cd "$REPO" && bash "$GATE_SCRIPT" "$1" "$2" "$3")
}

# --- Case 1: slot=staging passes with anything (even nonsense refs) --------
OUT1="$(run_gate staging refs/heads/main "$MAIN_TIP_SHA" 2>&1)"
CODE1=$?
if [ "$CODE1" -eq 0 ]; then
  pass "case 1: slot=staging passes regardless of ref/sha"
else
  fail "case 1: slot=staging should pass, got exit $CODE1: $OUT1"
fi

OUT1B="$(run_gate staging not-a-real-ref not-a-real-sha 2>&1)"
CODE1B=$?
if [ "$CODE1B" -eq 0 ]; then
  pass "case 1b: slot=staging passes even with garbage ref/sha (short-circuits before any git call)"
else
  fail "case 1b: slot=staging should short-circuit and pass, got exit $CODE1B: $OUT1B"
fi

# --- Case 2: prod + ref=main -> REFUSED (ref is not release/prod-*) --------
OUT2="$(run_gate prod refs/heads/main "$RELEASE_TIP_SHA" 2>&1)"
CODE2=$?
if [ "$CODE2" -eq 12 ] && echo "$OUT2" | grep -q "^REFUSED:"; then
  pass "case 2: prod dispatched from main is REFUSED"
else
  fail "case 2: expected exit 12 + REFUSED for prod from main, got exit $CODE2: $OUT2"
fi

# --- Case 3: prod + release ref + sha ON the branch -> pass ----------------
OUT3="$(run_gate prod refs/heads/release/prod-2026-09-05 "$RELEASE_TIP_SHA" 2>&1)"
CODE3=$?
if [ "$CODE3" -eq 0 ]; then
  pass "case 3: prod from release branch deploying its own tip sha passes"
else
  fail "case 3: expected exit 0, got exit $CODE3: $OUT3"
fi

# Also prove the shared-ancestor commit (present on both branches) passes.
OUT3B="$(run_gate prod refs/heads/release/prod-2026-09-05 "$MAIN_ONLY_SHA" 2>&1)"
CODE3B=$?
if [ "$CODE3B" -eq 0 ]; then
  pass "case 3b: prod deploying the shared ancestor commit passes"
else
  fail "case 3b: expected exit 0 for shared ancestor, got exit $CODE3B: $OUT3B"
fi

# --- Case 4: prod + release ref + sha only on main -> REFUSED --------------
OUT4="$(run_gate prod refs/heads/release/prod-2026-09-05 "$MAIN_TIP_SHA" 2>&1)"
CODE4=$?
if [ "$CODE4" -eq 12 ] && echo "$OUT4" | grep -q "^REFUSED:"; then
  pass "case 4: prod requesting a main-only sha on the release ref is REFUSED"
else
  fail "case 4: expected exit 12 + REFUSED for main-only sha, got exit $CODE4: $OUT4"
fi

# --- Case 5: missing args -> REFUSED exit 12 -------------------------------
OUT5="$( (cd "$REPO" && bash "$GATE_SCRIPT" prod refs/heads/release/prod-2026-09-05) 2>&1)"
CODE5=$?
if [ "$CODE5" -eq 12 ] && echo "$OUT5" | grep -q "^REFUSED:"; then
  pass "case 5: missing target-sha argument is REFUSED exit 12"
else
  fail "case 5: expected exit 12 + REFUSED for missing args, got exit $CODE5: $OUT5"
fi

OUT5B="$( (cd "$REPO" && bash "$GATE_SCRIPT") 2>&1)"
CODE5B=$?
if [ "$CODE5B" -eq 12 ] && echo "$OUT5B" | grep -q "^REFUSED:"; then
  pass "case 5b: no arguments at all is REFUSED exit 12"
else
  fail "case 5b: expected exit 12 + REFUSED for zero args, got exit $CODE5B: $OUT5B"
fi

rm -rf "$REPO" /tmp/w141-main-only-sha.txt /tmp/w141-main-tip-sha.txt /tmp/w141-release-tip-sha.txt

if [ "$FAILED" -ne 0 ]; then
  echo "require-release-branch.test.sh: FAILED"
  exit 1
fi

echo "require-release-branch.test.sh: all cases passed"
