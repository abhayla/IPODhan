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
