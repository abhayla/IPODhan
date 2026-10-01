#!/usr/bin/env bash
# T-267 — self-test for scripts/assert-migrations-applied.sh. Run from anywhere:
#   bash scripts/tests/assert-migrations-applied.test.sh
# Uses a fake `psql` on PATH (fixtures/migrations-assert/fake-bin) so this
# runs with no real Postgres, mirroring assert-env-keys.test.sh's no-DB style.
# Exits 0 only if every case behaved as expected; prints a PASS/FAIL line per
# case either way so a CI log shows exactly what ran.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT_SCRIPT="$SCRIPT_DIR/../assert-migrations-applied.sh"
FIXTURES="$SCRIPT_DIR/fixtures/migrations-assert"
JOURNAL="$FIXTURES/journal.json"

export PATH="$FIXTURES/fake-bin:$PATH"

FAILED=0

# #1177: fail closed unless `psql` resolves to THIS fixture. The fake was
# committed as mode 100644; Windows Git Bash runs it anyway, but on Linux a
# non-executable file is skipped during PATH lookup, so CI's real psql ran
# instead: the two "pass" cases exited 1 on `could not translate host name
# "fake"`, and the three "fail loud" cases passed for that same wrong reason.
# Both checks below go red on that shape, on any OS.
FAKE_PSQL="$FIXTURES/fake-bin/psql"
if [ "$(command -v psql 2>/dev/null)" != "$FAKE_PSQL" ]; then
  echo "FAIL: precondition: psql resolves to '$(command -v psql 2>/dev/null)', not the fixture $FAKE_PSQL (not executable?)"
  FAILED=1
fi
if git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  FAKE_MODE="$(git -C "$SCRIPT_DIR" ls-files -s -- "$FAKE_PSQL" | cut -d' ' -f1)"
  if [ "$FAKE_MODE" != "100755" ]; then
    echo "FAIL: precondition: $FAKE_PSQL is git mode '${FAKE_MODE:-untracked}', not 100755 - Linux CI will skip it and run the real psql"
    FAILED=1
  fi
fi
if [ "$FAILED" -eq 0 ]; then
  echo "PASS: precondition: psql resolves to the executable fixture (git mode 100755)"
fi

run_case() {
  local name="$1" expect_exit="$2"
  shift 2
  local actual_exit=0
  bash "$ASSERT_SCRIPT" "$@" >/tmp/assert-migrations-applied.$$.out 2>&1 || actual_exit=$?

  if [ "$actual_exit" -eq "$expect_exit" ]; then
    echo "PASS: $name (exit $actual_exit, expected $expect_exit)"
  else
    echo "FAIL: $name (exit $actual_exit, expected $expect_exit)"
    sed 's/^/    /' /tmp/assert-migrations-applied.$$.out
    FAILED=1
  fi
  rm -f /tmp/assert-migrations-applied.$$.out
}

# journal fixture's newest `when` (across its 3 entries, incl. one
# deliberately out-of-order entry) is 3000 — see fixtures/migrations-assert/journal.json

FAKE_PSQL_MAX_CREATED_AT=3000 \
  run_case "DB exactly at newest journaled migration -> pass" 0 \
  "postgresql://fake/db" "$JOURNAL"

FAKE_PSQL_MAX_CREATED_AT=5000 \
  run_case "DB ahead of newest journaled migration -> pass" 0 \
  "postgresql://fake/db" "$JOURNAL"

FAKE_PSQL_MAX_CREATED_AT=2000 \
  run_case "DB behind newest journaled migration -> fail loud (T-267)" 1 \
  "postgresql://fake/db" "$JOURNAL"

FAKE_PSQL_MAX_CREATED_AT=0 \
  run_case "DB never baselined (0 rows) -> fail loud (the exact #139 gap)" 1 \
  "postgresql://fake/db" "$JOURNAL"

FAKE_PSQL_FAIL=1 \
  run_case "DB unreachable -> fail loud, not silently skip" 1 \
  "postgresql://fake/db" "$JOURNAL"

run_case "missing journal file -> fail" 1 \
  "postgresql://fake/db" "$FIXTURES/does-not-exist.json"

run_case "empty DATABASE_URL -> fail" 1 \
  "" "$JOURNAL"

run_case "wrong arg count -> usage error" 2 \
  "postgresql://fake/db"

if [ "$FAILED" -ne 0 ]; then
  echo "assert-migrations-applied.test.sh: FAILED"
  exit 1
fi

echo "assert-migrations-applied.test.sh: all cases passed"
