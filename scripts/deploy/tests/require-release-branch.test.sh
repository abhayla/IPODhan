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
# Round 2 (Tier A finding #1): the refusal REASON must name "NOT reachable"
# — not the generic "could not determine ancestry" text, which is reserved
# for the genuinely undecidable case (case 4b below). Before the round-2
# fix, `MERGE_BASE_EXIT=$?` read right after an `if cmd; then ...; fi` with
# a false condition and no `else` was ALWAYS 0 (POSIX: an `if` with no
# executed branch exits 0), so this case fell through to a wasted
# `git fetch --deepen` and the misleading "could not determine" reason.
OUT4="$(run_gate prod refs/heads/release/prod-2026-09-05 "$MAIN_TIP_SHA" 2>&1)"
CODE4=$?
if [ "$CODE4" -eq 12 ] && echo "$OUT4" | grep -q "^REFUSED:" && echo "$OUT4" | grep -q "NOT reachable from"; then
  pass "case 4: prod requesting a main-only sha on the release ref is REFUSED with the 'NOT reachable' reason"
else
  fail "case 4: expected exit 12 + REFUSED + 'NOT reachable' reason for main-only sha, got exit $CODE4: $OUT4"
fi

# --- Case 4b: undecidable ancestry (target ref itself doesn't exist) -------
# Matches the release/prod-* glob but is not a real ref, so git merge-base
# cannot resolve it at all (exit >1, not 0 or 1) even after the deepen
# retry (no `origin` remote in this throwaway repo) — must REFUSE with the
# "could not determine" reason, distinct from case 4's "NOT reachable".
OUT4B="$(run_gate prod refs/heads/release/prod-doesnotexist "$RELEASE_TIP_SHA" 2>&1)"
CODE4B=$?
if [ "$CODE4B" -eq 12 ] && echo "$OUT4B" | grep -q "^REFUSED:" && echo "$OUT4B" | grep -q "could not determine whether"; then
  pass "case 4b: undecidable ancestry (nonexistent release ref) is REFUSED with the 'could not determine' reason"
else
  fail "case 4b: expected exit 12 + REFUSED + 'could not determine' reason, got exit $CODE4B: $OUT4B"
fi

# --- Case 4c: exact 'release/prod-' (no date suffix) is REFUSED -----------
# Round 2 (Tier A finding #3): the glob must require at least one char
# after the trailing dash — a branch literally named `release/prod-`
# must not satisfy check 1.
OUT4C="$(run_gate prod refs/heads/release/prod- "$RELEASE_TIP_SHA" 2>&1)"
CODE4C=$?
if [ "$CODE4C" -eq 12 ] && echo "$OUT4C" | grep -q "^REFUSED:"; then
  pass "case 4c: exact ref 'release/prod-' (no suffix) is REFUSED"
else
  fail "case 4c: expected exit 12 + REFUSED for bare 'release/prod-', got exit $CODE4C: $OUT4C"
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
