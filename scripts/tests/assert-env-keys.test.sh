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

# Like run_case, but ALSO asserts the output contains a specific substring
# (T-287 P3-1) -- a bare exit-code check would still pass if the FATAL
# message text itself were gutted/removed while the exit(1) stayed intact.
run_case_grep() {
  local name="$1" expect_exit="$2" expect_grep="$3"
  shift 3
  local actual_exit=0
  bash "$ASSERT_SCRIPT" "$@" >/tmp/assert-env-keys-grep.$$.out 2>&1 || actual_exit=$?

  local exit_ok=0 grep_ok=0
  [ "$actual_exit" -eq "$expect_exit" ] && exit_ok=1
  grep -q -- "$expect_grep" /tmp/assert-env-keys-grep.$$.out && grep_ok=1

  if [ "$exit_ok" -eq 1 ] && [ "$grep_ok" -eq 1 ]; then
    echo "PASS: $name (exit $actual_exit, message contains '$expect_grep')"
  else
    echo "FAIL: $name (exit $actual_exit expected $expect_exit; message contains '$expect_grep'? $grep_ok)"
    sed 's/^/    /' /tmp/assert-env-keys-grep.$$.out
    FAILED=1
  fi
  rm -f /tmp/assert-env-keys-grep.$$.out
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

# --- T-251 (F9): revert-proof for the flag-regression ratchet. If someone
# removes ENABLE_BSE_API (or any of the other 3 flags) from a fixture -- or
# for real, from a slot's shared/env/*/scraper.env -- the assert MUST fail
# loudly rather than silently deploying with the flag defaulted OFF.
run_case "scraper.env missing ENABLE_BSE_API -> fail (T-251, F9 revert-proof)" 1 \
  "$FIXTURES/web.env.local.good" "$FIXTURES/scraper.env.missing-f9-flag"

# --- T-243: slot DSN assert (staging must never target the production db) ---
run_case "slot staging + staging DSN -> pass" 0 \
  "$FIXTURES/slot/staging/web.env.local" "$FIXTURES/slot/staging/scraper.env"

run_case "slot staging pointed at PROD db ipodhan -> fail (T-243)" 1 \
  "$FIXTURES/slot/staging/web.env.local.points-at-prod" "$FIXTURES/slot/staging/scraper.env"

# T-287 P3-1: mutation-proof for the SECONDARY branch of assert_slot_dsn
# (assert-env-keys.sh:155-158) — a fixture where DSN_ASSERT_DB=ipodhan
# matches the actual DATABASE_URL database exactly, so the PRIMARY
# "db != want" check (line 151-154) never fires; only the secondary
# "slot != prod && db == ipodhan" branch can catch this. Before this case
# existed, commenting out lines 155-158 left the whole suite green.
run_case_grep "slot staging DECLARES (and matches) PROD db ipodhan -> fail (T-287, secondary branch)" 1 \
  "targets the PRODUCTION database" \
  "$FIXTURES/slot/staging/web.env.local.declares-prod-db-on-staging" "$FIXTURES/slot/staging/scraper.env"

run_case "slot prod + prod DSN -> pass" 0 \
  "$FIXTURES/slot/prod/web.env.local" "$FIXTURES/slot/prod/scraper.env"

run_case "no DSN_ASSERT_DB -> assert is advisory, still passes" 0 \
  "$FIXTURES/web.env.local.good" "$FIXTURES/scraper.env.good"

# --- T-264 F2 / T-268: slot Redis-db assert (staging must never share prod's
# Redis db0 — the exact accident that let a staging page view overwrite the
# key prod served) ---
run_case "slot staging Redis db1 -> pass" 0 \
  "$FIXTURES/slot/staging/web.env.local" "$FIXTURES/slot/staging/scraper.env"

run_case "slot staging pointed at Redis db0 -> fail (T-264 F2)" 1 \
  "$FIXTURES/slot/staging/web.env.local.points-at-prod-redis" "$FIXTURES/slot/staging/scraper.env"

# T-287 P3-1: mutation-proof for the SECONDARY branch of assert_slot_redis_db
# (assert-env-keys.sh:205-208) — DSN_ASSERT_REDIS_DB=0 matches the actual
# resolved Redis db exactly, so the PRIMARY "effective != want" check
# (line 201-204) never fires; only the secondary "slot != prod && effective
# == 0" branch catches this. Before this case existed, commenting out lines
# 205-208 left the whole suite green.
run_case_grep "slot staging DECLARES (and matches) Redis db0 -> fail (T-287, secondary branch)" 1 \
  "the PRODUCTION cache db" \
  "$FIXTURES/slot/staging/web.env.local.declares-prod-redis-on-staging" "$FIXTURES/slot/staging/scraper.env"

run_case "slot prod + Redis db0 -> pass" 0 \
  "$FIXTURES/slot/prod/web.env.local" "$FIXTURES/slot/prod/scraper.env"

run_case "no DSN_ASSERT_REDIS_DB -> assert is advisory, still passes" 0 \
  "$FIXTURES/web.env.local.good" "$FIXTURES/scraper.env.good"

run_case "wrong arg count -> usage error" 2 \
  "$FIXTURES/web.env.local.good"

if [ "$FAILED" -ne 0 ]; then
  echo "assert-env-keys.test.sh: FAILED"
  exit 1
fi

echo "assert-env-keys.test.sh: all cases passed"
