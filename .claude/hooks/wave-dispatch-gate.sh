#!/usr/bin/env bash
# PreToolUse hook (matcher: Agent) — T-499, .claude/rules/signal-ownership.md
# R4. Thin wrapper: real logic lives in scripts/ops/wave-dispatch-gate.mjs so
# it is unit-testable (.claude/hooks/tests/wave-dispatch-gate.test.mjs).
# stdin (the hook JSON payload) passes through unchanged via exec; the exit
# code node produces (0 allow, 2 block) becomes this hook's exit code.
root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$root" ]; then
  exit 0
fi
exec node "$root/scripts/ops/wave-dispatch-gate.mjs"
