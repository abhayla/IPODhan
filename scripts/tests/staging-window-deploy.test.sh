#!/usr/bin/env bash
#
# Regression guard for scripts/ops/staging-window-deploy.sh (owner standing
# rule 2026-09-16, "staging deploys in windows, not per merge"). This is the
# payload the VPS's root crontab fires twice a day - it must never hang
# waiting on the dispatched run, and --dry-run must print the exact `gh`
# command without touching gh, the log file, or the Notifier.
#
# Usage: bash scripts/tests/staging-window-deploy.test.sh

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/ops/staging-window-deploy.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: script not found at $SCRIPT" >&2
  exit 1
fi

bash -n "$SCRIPT" || { echo "FAIL: $SCRIPT is not valid bash" >&2; exit 1; }

FAILED=0

# --- --dry-run prints the exact gh command, does not touch the log file ---
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
LOGFILE="$TMP/window.log"
OUT="$(STAGING_WINDOW_LOG="$LOGFILE" bash "$SCRIPT" --dry-run)"
EXPECTED="gh workflow run deploy-linux.yml --repo abhayla/IPODhan --ref main -f slot=staging -f mode=window"
if [ "$OUT" = "$EXPECTED" ]; then
  echo "PASS: --dry-run prints the exact gh command"
else
  echo "FAIL: --dry-run output mismatch" >&2
  echo "  got:      $OUT" >&2
  echo "  expected: $EXPECTED" >&2
  FAILED=1
fi
if [ -f "$LOGFILE" ]; then
  echo "FAIL: --dry-run touched the log file" >&2
  FAILED=1
else
  echo "PASS: --dry-run does not touch the log file"
fi

# --- STAGING_WINDOW_REPO override is honored in --dry-run output ---
OUT2="$(STAGING_WINDOW_REPO=someone/fork bash "$SCRIPT" --dry-run)"
if printf '%s' "$OUT2" | grep -qF -- "--repo someone/fork"; then
  echo "PASS: STAGING_WINDOW_REPO override is honored"
else
  echo "FAIL: STAGING_WINDOW_REPO override was not honored: $OUT2" >&2
  FAILED=1
fi

# --- an unknown argument is refused ---
if bash "$SCRIPT" --bogus >/dev/null 2>&1; then
  echo "FAIL: an unknown argument was accepted" >&2
  FAILED=1
else
  echo "PASS: an unknown argument is refused"
fi

# --- real (non-dry-run) dispatch: gh stubbed, verifies the log + gh args ---
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
echo "STUB-GH-ARGS: $*" >> "${STUB_GH_LOG:?}"
if [ "${STUB_GH_FAIL:-0}" = "1" ]; then exit 3; fi
exit 0
STUB
chmod +x "$TMP/bin/gh"

STUB_LOG="$TMP/stub-gh-calls.log"
REAL_LOG="$TMP/real-window.log"
: > "$STUB_LOG"
if PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STAGING_WINDOW_LOG="$REAL_LOG" bash "$SCRIPT"; then
  echo "PASS: a successful stubbed gh dispatch exits 0"
else
  echo "FAIL: a successful stubbed gh dispatch did not exit 0" >&2
  FAILED=1
fi
if grep -qF -- "-f slot=staging -f mode=window" "$STUB_LOG"; then
  echo "PASS: dispatches with slot=staging mode=window"
else
  echo "FAIL: gh was not called with slot=staging mode=window" >&2
  cat "$STUB_LOG" >&2
  FAILED=1
fi
if [ -f "$REAL_LOG" ] && grep -qF "dispatch OK" "$REAL_LOG"; then
  echo "PASS: success is logged to the log file"
else
  echo "FAIL: log file does not record a successful dispatch" >&2
  FAILED=1
fi

# --- failure path: gh fails, script exits non-zero and logs FAILED ---
REAL_LOG2="$TMP/real-window-fail.log"
if PATH="$TMP/bin:$PATH" STUB_GH_LOG="$STUB_LOG" STUB_GH_FAIL=1 STAGING_WINDOW_LOG="$REAL_LOG2" bash "$SCRIPT"; then
  echo "FAIL: a failing gh dispatch should exit non-zero" >&2
  FAILED=1
else
  echo "PASS: a failing gh dispatch exits non-zero"
fi
if [ -f "$REAL_LOG2" ] && grep -qF "dispatch FAILED" "$REAL_LOG2"; then
  echo "PASS: failure is logged to the log file"
else
  echo "FAIL: log file does not record the failed dispatch" >&2
  FAILED=1
fi

if [ "$FAILED" -eq 0 ]; then
  echo "staging-window-deploy.test.sh: PASSED"
else
  echo "staging-window-deploy.test.sh: FAILED"
fi
exit "$FAILED"
