#!/bin/bash
# test-prompt-enhance-reminder.sh — bash test for the once-per-session reminder
# gate added to prompt-enhance-reminder.sh (T-448).
#
# Run: bash .claude/hooks/test-prompt-enhance-reminder.sh
# Exits 0 on all-pass, 1 on any failure (prints a FAIL line per failing case).

set -u
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prompt-enhance-reminder.sh"
fail=0

run_hook() {
  # $1 = prompt text, $2 = session_id (may be empty)
  local prompt="$1" sid="$2"
  local payload
  if [ -n "$sid" ]; then
    payload=$(printf '{"prompt": %s, "session_id": %s}' \
      "$(jq -Rn --arg p "$prompt" '$p')" \
      "$(jq -Rn --arg s "$sid" '$s')")
  else
    payload=$(printf '{"prompt": %s}' "$(jq -Rn --arg p "$prompt" '$p')")
  fi
  printf '%s' "$payload" | HOME="$FAKE_HOME" bash "$HOOK"
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc — expected to find: $needle"
    fail=1
  fi
}

assert_not_contains() {
  local desc="$1" haystack="$2" needle="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "FAIL: $desc — did NOT expect to find: $needle"
    fail=1
  else
    echo "PASS: $desc"
  fi
}

FAKE_HOME="$(mktemp -d)"
trap 'rm -rf "$FAKE_HOME"' EXIT

PROMPT="Please implement the new reporting dashboard feature end to end"
SID_A="session-aaa-111"
SID_B="session-bbb-222"

# 1. First turn of a session -> full reminder text, no marker pre-existing.
out1=$(run_hook "$PROMPT" "$SID_A")
assert_contains "turn 1 (session A) emits full REMINDER banner" "$out1" "REMINDER: Start your response"
assert_not_contains "turn 1 (session A) does not emit the pointer" "$out1" "full text shown at turn 1"
if [ -f "$FAKE_HOME/.claude/.enhance-reminder-shown/$SID_A" ]; then
  echo "PASS: marker created for session A after turn 1"
else
  echo "FAIL: marker NOT created for session A after turn 1"
  fail=1
fi

# 2. Second turn, same session -> one-line pointer only, no full text.
out2=$(run_hook "$PROMPT" "$SID_A")
assert_contains "turn 2 (session A) emits the one-line pointer" "$out2" "full text shown at turn 1"
assert_not_contains "turn 2 (session A) does not repeat the full REMINDER banner" "$out2" "REMINDER: Start your response"

# 3. New session_id -> full text again (marker is per-session, not global).
out3=$(run_hook "$PROMPT" "$SID_B")
assert_contains "turn 1 (session B, new session_id) emits full REMINDER banner" "$out3" "REMINDER: Start your response"
assert_not_contains "turn 1 (session B) does not emit the pointer" "$out3" "full text shown at turn 1"

# 4. No session_id at all -> full text every time (back-compat, no gating possible).
out4a=$(run_hook "$PROMPT" "")
out4b=$(run_hook "$PROMPT" "")
assert_contains "no session_id, call 1: full REMINDER banner" "$out4a" "REMINDER: Start your response"
assert_contains "no session_id, call 2: full REMINDER banner again (no gating)" "$out4b" "REMINDER: Start your response"

if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME TESTS FAILED"
  exit 1
fi
