#!/usr/bin/env bash
# T-242 M3 — self-test for scripts/assert-env-keys.sh. Run from anywhere:
#   bash scripts/tests/assert-env-keys.test.sh
# Exits 0 only if every case behaved as expected; prints a PASS/FAIL line
# per case either way so a CI log shows exactly what ran.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSERT_SCRIPT="$SCRIPT_DIR/../assert-env-keys.sh"
FIXTURES="$SCRIPT_DIR/fixtures/env-assert"

FAILED=0

run_case() {
  local name="$1" expect_exit="$2"
  shift 2
  local actual_exit=0
  bash "$ASSERT_SCRIPT" "$@" >/tmp/assert-env-keys.$$.out 2>&1 || actual_exit=$?

  if [ "$actual_exit" -eq "$expect_exit" ]; then
    echo "PASS: $name (exit $actual_exit, expected $expect_exit)"
  else
    echo "FAIL: $name (exit $actual_exit, expected $expect_exit)"
    sed 's/^/    /' /tmp/assert-env-keys.$$.out
    FAILED=1
  fi
  rm -f /tmp/assert-env-keys.$$.out
}

run_case "good web + scraper env -> pass" 0 \
  "$FIXTURES/web.env.local.good" "$FIXTURES/scraper.env.good"

run_case "missing key -> fail" 1 \
  "$FIXTURES/web.env.local.missing-key" "$FIXTURES/scraper.env.good"

run_case "blank value -> fail (T-230 lesson)" 1 \
  "$FIXTURES/web.env.local.blank-value" "$FIXTURES/scraper.env.good"

run_case "DATABASE_HOST present -> fail (T-241 H5)" 1 \
  "$FIXTURES/web.env.local.database-host-present" "$FIXTURES/scraper.env.good"

run_case "missing env file -> fail" 1 \
  "$FIXTURES/does-not-exist.env" "$FIXTURES/scraper.env.good"

# --- T-243: slot DSN assert (staging must never target the production db) ---
run_case "slot staging + staging DSN -> pass" 0 \
  "$FIXTURES/slot/staging/web.env.local" "$FIXTURES/slot/staging/scraper.env"

run_case "slot staging pointed at PROD db ipodhan -> fail (T-243)" 1 \
  "$FIXTURES/slot/staging/web.env.local.points-at-prod" "$FIXTURES/slot/staging/scraper.env"

run_case "slot prod + prod DSN -> pass" 0 \
  "$FIXTURES/slot/prod/web.env.local" "$FIXTURES/slot/prod/scraper.env"

run_case "no DSN_ASSERT_DB -> assert is advisory, still passes" 0 \
  "$FIXTURES/web.env.local.good" "$FIXTURES/scraper.env.good"

run_case "wrong arg count -> usage error" 2 \
  "$FIXTURES/web.env.local.good"

if [ "$FAILED" -ne 0 ]; then
  echo "assert-env-keys.test.sh: FAILED"
  exit 1
fi

echo "assert-env-keys.test.sh: all cases passed"
