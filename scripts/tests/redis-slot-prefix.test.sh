#!/usr/bin/env bash
# #151: the shell twin of packages/shared/src/cache/redis-slot.ts must name the
# SAME Redis prefix as the Node clients for every case in the shared fixture,
# so deploy-linux.sh / scraper-wake.sh read and release the lock key the
# scraper process actually holds. Runs the helper under plain `sh` too, since
# scraper-wake.sh is POSIX sh.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/../lib/redis-slot-prefix.sh"
FIXTURE="$SCRIPT_DIR/fixtures/redis-slot-cases.json"
PASS=0; FAIL=0

CASES="$(node -e '
  const f = require(process.argv[1]);
  for (const c of f.cases) {
    const e = c.env;
    console.log([e.DATABASE_URL||"", e.DATABASE_HOST||"", e.DATABASE_PASSWORD||"", e.DATABASE_NAME||"", e.DEPLOY_SLOT||"", c.prefix||"", c.error||""].join("|"));
  }' "$FIXTURE")"
[ -n "$CASES" ] || { echo "FAIL: fixture produced no cases"; exit 1; }

for shell in bash sh; do
  while IFS='|' read -r url host pw name deploy want err; do
    got="$("$shell" -c '. "$1"; redis_slot_prefix "$2" "$3" "$4" "$5" "$6"' _ "$LIB" "$url" "$host" "$pw" "$name" "$deploy" 2>/tmp/rsp-err.$$)"
    rc=$?
    msg="$(cat /tmp/rsp-err.$$)"
    if [ -n "$want" ]; then
      if [ "$rc" -eq 0 ] && [ "$got" = "$want" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL [$shell] url=$url host=$host deploy=$deploy: want $want, got '$got' rc=$rc $msg"; fi
    else
      if [ "$rc" -ne 0 ] && [ -z "$got" ] && printf '%s' "$msg" | grep -q "$err"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL [$shell] url=$url deploy=$deploy: want error '$err', got '$got' rc=$rc $msg"; fi
    fi
  done <<< "$CASES"
done
rm -f /tmp/rsp-err.$$

# redis_slot_env_value reads the last value and strips quotes.
tmp="$(mktemp)"
printf 'DATABASE_URL=postgresql://a@h/old\nDATABASE_URL="postgresql://a@h/ipodhan_staging"\n' > "$tmp"
v="$(bash -c '. "$1"; redis_slot_env_value "$2" DATABASE_URL' _ "$LIB" "$tmp")"
rm -f "$tmp"
if [ "$v" = "postgresql://a@h/ipodhan_staging" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL env_value: got '$v'"; fi

echo "redis-slot-prefix: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
