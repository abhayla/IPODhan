#!/usr/bin/env bash
# T-216 - self-test for scripts/check-staged-secrets.js. Run from anywhere:
#   bash scripts/tests/check-staged-secrets.test.sh
# Every case stages one line in a THROWAWAY git repo and asserts the gate's
# exit code (1 = blocked, 0 = allowed). Exits 0 only if every case behaved.
#
# The "secret" values below are invented for this test and were never real.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCANNER="$SCRIPT_DIR/../check-staged-secrets.js"
FAILED=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init --quiet
git -C "$TMP" config user.email t216@test.local
git -C "$TMP" config user.name t216-test
git -C "$TMP" config core.autocrlf false

run_case() {
  local name="$1" expect_exit="$2" line="$3"
  printf '%s\n' "$line" > "$TMP/probe.txt"
  git -C "$TMP" add probe.txt
  local actual_exit=0
  (cd "$TMP" && node "$SCANNER") >"$TMP/out" 2>&1 || actual_exit=$?
  git -C "$TMP" rm -f --cached --quiet probe.txt

  if [ "$actual_exit" -eq "$expect_exit" ]; then
    echo "PASS: $name (exit $actual_exit)"
  else
    echo "FAIL: $name (exit $actual_exit, expected $expect_exit)"
    sed 's/^/    /' "$TMP/out"
    FAILED=1
  fi
}

echo "=== must BLOCK (exit 1) ==="
# The exact shape of the issue #1 leak - a quoted password literal in JS config.
run_case "quoted password literal (issue #1 shape)" 1 "  password: 'Zq7tPl2wRn4x',"  # secret-scan:allow (deliberate dummy fixture)
run_case "double-quoted password literal"           1 '  "password": "Zq7tPl2wRn4x",'  # secret-scan:allow (deliberate dummy fixture)
run_case "env-style DB_PASSWORD assignment"         1 "DB_PASSWORD=Zq7tPl2wRn4x"
run_case "connection string, raw password"          1 "DATABASE_URL=postgresql://postgres:Zq7tPl2wRn4x@1.2.3.4:5432/db"  # secret-scan:allow (deliberate dummy fixture)
# Percent-encoded is the variant that made the T-216 history leak double-sized.
run_case "connection string, %-encoded password"    1 "DATABASE_URL=postgresql://postgres:Zq7tPl2w%40Rn4x@1.2.3.4:5432/db"  # secret-scan:allow (deliberate dummy fixture)
run_case "PGPASSWORD literal"                       1 "PGPASSWORD=Zq7tPl2wRn4x psql -h x"  # secret-scan:allow (deliberate dummy fixture)
run_case "AWS access key id"                        1 "aws_access_key_id = AKIAZQ7TPL2WRN4XABCD"  # secret-scan:allow (deliberate dummy fixture)
run_case "hardcoded api key"                        1 'const api_key = "Zq7tPl2wRn4xZq7tPl2wRn4x";'  # secret-scan:allow (deliberate dummy fixture)

echo "=== must ALLOW (exit 0) ==="
run_case "angle-bracket placeholder"      0 "DATABASE_URL=postgresql://user:<db-password>@host:5432/db"
run_case "env var reference"              0 "  password: process.env.DB_PASSWORD,"
run_case "shell variable reference"       0 "DB_PASSWORD=\$PGPASS"
run_case "docs filler value"              0 "  password: 'your_password_here',"
run_case "the literal word password"      0 '  password: "password",'
run_case "asterisk masking"               0 "  password: '**********',"
run_case "identifier reference, not a literal" 0 "  password: dbPassword,"
run_case "explicit allow marker"          0 "  password: 'Zq7tPl2wRn4x',  // secret-scan:allow"
run_case "ordinary code line"             0 "export function hashPassword(input: string) {"
# All-lowercase-letters values are docs filler, not credentials (see FILLER_WORD).
run_case "docs filler env value"          0 "REDIS_PASSWORD=something"
run_case "PGPASSWORD from a code expression" 0 'env = dict(os.environ, PGPASSWORD=urllib.parse.unquote(u.password or ""))'

if [ "$FAILED" -eq 0 ]; then
  echo "ALL CASES PASSED"
else
  echo "SOME CASES FAILED"
fi
exit "$FAILED"
