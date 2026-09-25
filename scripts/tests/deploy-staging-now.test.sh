#!/usr/bin/env bash
#
# Regression guard for scripts/ops/deploy-staging-now.sh, the capped manual
# staging-deploy button (owner standing rule 2026-09-16, "staging deploys in
# windows, not per merge"). Covers: --reason is required, --dry-run never
# dispatches or counts, the per-day cap refuses a 3rd dispatch and prints
# the earlier reasons, and --override bypasses the cap while still logging
# itself as an override.
#
# Usage: bash scripts/tests/deploy-staging-now.test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ops/deploy-staging-now.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: script not found at $SCRIPT" >&2
  exit 1
fi

bash -n "$SCRIPT" || { echo "FAIL: $SCRIPT is not valid bash" >&2; exit 1; }

FAILED=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "STUB-GH: $*" >> "${STUB_GH_LOG:?}"
exit 0
STUB
chmod +x "$TMP/bin/gh"
STUB_LOG="$TMP/gh-calls.log"

# --- --reason is required ---
: > "$STUB_LOG"
if PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$TMP/state-noreason" bash "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: dispatch without --reason should have been refused" >&2
  FAILED=1
else
  echo "PASS: dispatch without --reason exits non-zero"
fi
if [ -s "$STUB_LOG" ]; then
  echo "FAIL: gh was invoked despite the missing --reason" >&2
  FAILED=1
else
  echo "PASS: gh is never invoked when --reason is missing"
fi

# --- --dry-run: prints the gh command, never dispatches, never counts ---
: > "$STUB_LOG"
STATE_DIR="$TMP/state-dryrun"
OUT="$(PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR" bash "$SCRIPT" --reason "checking" --dry-run)"
EXPECTED="gh workflow run deploy-linux.yml --repo abhayla/IPODhan --ref main -f slot=staging -f mode=manual"
if [ "$OUT" = "$EXPECTED" ]; then
  echo "PASS: --dry-run prints the exact gh command"
else
  echo "FAIL: --dry-run output mismatch: got '$OUT'" >&2
  FAILED=1
fi
if [ -s "$STUB_LOG" ]; then
  echo "FAIL: --dry-run invoked gh" >&2
  FAILED=1
else
  echo "PASS: --dry-run never invokes gh"
fi
if [ -d "$STATE_DIR" ] && [ -n "$(ls -A "$STATE_DIR" 2>/dev/null)" ]; then
  echo "FAIL: --dry-run wrote to the per-day counter" >&2
  FAILED=1
else
  echo "PASS: --dry-run does not touch the per-day counter"
fi

# --- the cap: 1st and 2nd allowed, 3rd refused, 3rd with --override allowed ---
: > "$STUB_LOG"
STATE_DIR2="$TMP/state-cap"
run_button() {
  PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR2" bash "$SCRIPT" "$@"
}

if run_button --reason "first" >"$TMP/out1.log" 2>&1; then
  echo "PASS: 1st dispatch of the day is allowed"
else
  echo "FAIL: 1st dispatch of the day was refused" >&2
  cat "$TMP/out1.log" >&2
  FAILED=1
fi

if run_button --reason "second" >"$TMP/out2.log" 2>&1; then
  echo "PASS: 2nd dispatch of the day is allowed"
else
  echo "FAIL: 2nd dispatch of the day was refused" >&2
  cat "$TMP/out2.log" >&2
  FAILED=1
fi

if run_button --reason "third" >"$TMP/out3.log" 2>&1; then
  echo "FAIL: 3rd dispatch of the day should have been refused" >&2
  FAILED=1
else
  echo "PASS: 3rd dispatch of the day is refused without --override"
fi
if grep -qF "first" "$TMP/out3.log" && grep -qF "second" "$TMP/out3.log"; then
  echo "PASS: the refusal prints both earlier reasons"
else
  echo "FAIL: the refusal did not print both earlier reasons" >&2
  cat "$TMP/out3.log" >&2
  FAILED=1
fi

if run_button --reason "third-override" --override >"$TMP/out4.log" 2>&1; then
  echo "PASS: 3rd dispatch with --override is allowed"
else
  echo "FAIL: 3rd dispatch with --override was refused" >&2
  cat "$TMP/out4.log" >&2
  FAILED=1
fi
if grep -qF "OVERRIDE" "$TMP/out4.log"; then
  echo "PASS: the override dispatch logs itself as an override"
else
  echo "FAIL: the override dispatch did not announce itself" >&2
  FAILED=1
fi

DISPATCH_COUNT="$(grep -c "STUB-GH: workflow run" "$STUB_LOG" || true)"
if [ "$DISPATCH_COUNT" -eq 3 ]; then
  echo "PASS: exactly 3 real gh dispatches happened (1st, 2nd, override)"
else
  echo "FAIL: expected 3 real gh dispatches, got $DISPATCH_COUNT" >&2
  FAILED=1
fi

# --- #1064: the per-day cap is keyed on the IST day, not the UTC day ---
# (.claude/rules/ist-timezone.md: every schedule/cadence is IST). Mirrors
# deploy-config.test.sh cases 17a/17b. STAGING_NOW_NOW (epoch seconds)
# injects the clock instead of reading the real one.
: > "$STUB_LOG"
STATE_DIR_IST_A="$TMP/state-ist-a"
NOW_2359_IST="$(date -u -d '2026-01-01T18:29:00Z' +%s)"   # 2026-01-01 23:59 IST
NOW_0001_IST="$(date -u -d '2026-01-01T18:31:00Z' +%s)"   # 2026-01-02 00:01 IST

PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR_IST_A" \
  STAGING_NOW_NOW="$NOW_2359_IST" bash "$SCRIPT" --reason "case-ist-a 23:59 IST" >/dev/null 2>&1
PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR_IST_A" \
  STAGING_NOW_NOW="$NOW_0001_IST" bash "$SCRIPT" --reason "case-ist-a 00:01 IST" >/dev/null 2>&1

IST_A_FILE_COUNT="$(ls -1 "$STATE_DIR_IST_A" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$IST_A_FILE_COUNT" -eq 2 ]; then
  echo "PASS: case-ist-a: 23:59 IST and 00:01 IST (2 min apart, crossing IST midnight) land in different day-state files"
else
  echo "FAIL: case-ist-a expected 2 day-state files (IST midnight crossed), got $IST_A_FILE_COUNT" >&2
  ls -la "$STATE_DIR_IST_A" >&2 || true
  FAILED=1
fi

STATE_DIR_IST_B="$TMP/state-ist-b"
NOW_0529_IST="$(date -u -d '2026-01-01T23:59:00Z' +%s)"   # 2026-01-02 05:29 IST
NOW_0531_IST="$(date -u -d '2026-01-02T00:01:00Z' +%s)"   # 2026-01-02 05:31 IST

PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR_IST_B" \
  STAGING_NOW_NOW="$NOW_0529_IST" bash "$SCRIPT" --reason "case-ist-b 05:29 IST" >/dev/null 2>&1
PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_NOW_STATE_DIR="$STATE_DIR_IST_B" \
  STAGING_NOW_NOW="$NOW_0531_IST" bash "$SCRIPT" --reason "case-ist-b 05:31 IST" >/dev/null 2>&1

IST_B_FILE_COUNT="$(ls -1 "$STATE_DIR_IST_B" 2>/dev/null | wc -l | tr -d ' ')"
if [ "$IST_B_FILE_COUNT" -eq 1 ]; then
  DISPATCH_IN_FILE="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$STATE_DIR_IST_B"/*.json)"
  if [ "$DISPATCH_IN_FILE" -eq 2 ]; then
    echo "PASS: case-ist-b: 05:29 IST and 05:31 IST (crossing UTC midnight, same IST day) land in the same day-state file and both count toward the cap"
  else
    echo "FAIL: case-ist-b same file but expected 2 dispatches recorded, got $DISPATCH_IN_FILE" >&2
    FAILED=1
  fi
else
  echo "FAIL: case-ist-b expected 1 day-state file (same IST day), got $IST_B_FILE_COUNT" >&2
  ls -la "$STATE_DIR_IST_B" >&2 || true
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "deploy-staging-now.test.sh: PASSED"
else
  echo "deploy-staging-now.test.sh: FAILED"
fi
exit "$FAILED"
