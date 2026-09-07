#!/usr/bin/env bash
# SessionStart hook — T-499, .claude/rules/signal-ownership.md.
# Thin wrapper: real logic (ssh fetch / cache fallback / floor-delta diff /
# merged-not-deployed brief) lives in scripts/ops/morning-read-gate.mjs so it
# is unit-testable (.claude/hooks/tests/morning-read-gate.test.mjs). This
# wrapper always exits 0 — a SessionStart hook must never block a session.
root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ]; then
  echo "morning-read-gate: fail-open (not inside a git repo)"
  exit 0
fi
node "$root/scripts/ops/morning-read-gate.mjs" 2>&1
exit 0
