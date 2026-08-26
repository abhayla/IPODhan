#!/usr/bin/env bash
# T-242 M3 — required-keys assert, run by scripts/deploy-linux.sh BEFORE the
# build. Fails loudly (lists every missing/blank key) rather than letting a
# release build with a silently-empty required var — that is exactly the
# T-230 lesson (ADMIN_API_TOKEN was present-but-blank and the health check
# still reported the DB "healthy": presence is not the same as validity).
#
# Keys covered are the exact set T-241 proved required for the Linux app
# (D:\Abhay\GetWorkDone\evidence\2026-08-21-T-241\17-required-keys.md):
# BOTH env files, BOTH Redis config shapes (URL-only + discrete HOST/PORT/
# PASSWORD), and WEB_INTERNAL_URL for the scraper.
#
# Usage: scripts/assert-env-keys.sh <web-env-file> <scraper-env-file> [scraper-src-dir]
#
# The optional 3rd arg enables the flag-liveness REPORT (T-306, T-297 D9): a
# scraper ENABLE_* flag that is required-present but has no consumer reachable
# from the actual prod entrypoint (scraper/src/index.ts) is a silent no-op —
# ENABLE_PRIMARY_SOURCE_DISCOVERY is exactly this class (issue #213: true in
# prod, zero consumers outside the retired SchedulerService path). This is
# advisory-if-omitted (deploy-linux.sh passes it; the test harness and any
# older caller keep working without it) and NEVER fails the deploy on its
# own -- wiring a flag's consumer is a product decision, not a deploy-safety
# one; this ONLY makes the gap visible instead of silent.

set -euo pipefail

usage() {
  echo "Usage: $0 <web-env-file> <scraper-env-file> [scraper-src-dir]" >&2
  exit 2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage
fi

WEB_ENV_FILE="$1"
SCRAPER_ENV_FILE="$2"
SCRAPER_SRC_DIR="${3:-}"

WEB_REQUIRED_KEYS=(
  NODE_ENV
  DATABASE_URL
  REDIS_URL
  REDIS_HOST
  REDIS_PORT
  REDIS_PASSWORD
  REDIS_DB
  ADMIN_API_TOKEN
  NEXT_PUBLIC_GA_MEASUREMENT_ID
  NEXT_PUBLIC_ZERODHA_AFFILIATE_LINK
  NEXT_PUBLIC_ANGELONE_AFFILIATE_LINK
  PORT
  NOTIFIER_URL
  NOTIFIER_KEY
  NOTIFIER_PROJECT
  # T-327 P2-7: the real fix is `TZ=UTC pm2 start` (deploy-linux.sh), which is
  # what actually reaches the running process; requiring it here too is
  # belt-and-braces self-documentation on the hand-provisioned env file so a
  # human reading shared/env/<SLOT>/web.env.local sees the TZ contract
  # explicitly instead of it living only inside deploy-linux.sh.
  TZ
)

SCRAPER_REQUIRED_KEYS=(
  NODE_ENV
  DATABASE_URL
  REDIS_URL
  REDIS_HOST
  REDIS_PORT
  REDIS_PASSWORD
  REDIS_DB
  SCRAPER_ENABLED
  SCRAPER_INTERVAL_MODE
  # T-339: ENABLE_SOURCE_TRACKING / ENABLE_CONFLICT_DETECTION /
  # ENABLE_DATA_CONSOLIDATION were REQUIRED here until 2026-08-26. They are now
  # RETIRED: source tracking, conflict detection and consolidation are
  # unconditional in code, so requiring the keys would demand a value the app
  # no longer reads. The scraper still refuses to start if any of them (or the
  # three *_PERCENTAGE knobs) is present with an OFF/PARTIAL value -- see
  # assertConsolidationFlagsNotDisabled() in scraper/src/config/feature-flags.ts.
  # Prod + staging still carry them set fully ON; that is tolerated, and the
  # removal is listed in docs/architecture/write-path-hardening.md as env
  # cleanup for the next deploy wave.
  # T-251 (F9): these four flags lived only in the Windows ecosystem.config.js
  # env{} block and were never carried to the Linux shared/env files at the
  # T-249 cutover -> all four silently defaulted OFF for ~70min on a closing
  # day (subscription writes stopped dead; BSE corp-action pollution came
  # back). Presence-required here so a deploy fails loudly if any of the
  # four is ever missing again; VALUE is not enforced (a value flip like
  # accidentally setting one to "false" is a product/owner decision, not a
  # deploy-safety one) -- see scraper/.env.example for the values this repo
  # documents as correct for prod.
  ENABLE_GMP_NAME_MATCH
  ENABLE_MONEYCONTROL_SUBSCRIPTION
  ENABLE_BSE_API
  ENABLE_PRIMARY_SOURCE_DISCOVERY
  ADMIN_API_TOKEN
  WEB_INTERNAL_URL
  NOTIFIER_URL
  NOTIFIER_KEY
  NOTIFIER_PROJECT
  # T-327 P2-7: same TZ contract as WEB_REQUIRED_KEYS above — the scraper is
  # the process that actually parses NSE/BSE/... date strings, so this is the
  # required key that matters most; see date-string-parsing.ts for why the
  # date-parse fix no longer DEPENDS on this value (belt-and-braces, not the
  # only guard).
  TZ
)

MISSING=()
BLANK=()

# Prints the raw value for KEY in FILE (last occurrence wins); returns 1 if
# the key is not present at all.
get_value() {
  local file="$1" key="$2" line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1)" || return 1
  if [ -z "$line" ]; then
    return 1
  fi
  printf '%s\n' "${line#*=}"
}

check_file() {
  local file="$1" label="$2"
  shift 2
  local keys=("$@")
  local key value

  if [ ! -f "$file" ]; then
    echo "FATAL: $label env file not found: $file" >&2
    exit 1
  fi

  for key in "${keys[@]}"; do
    if value="$(get_value "$file" "$key")"; then
      # Strip one layer of surrounding quotes before the blank check —
      # KEY="" and KEY='' are blank, KEY=x is not.
      value="${value%\"}"
      value="${value#\"}"
      value="${value%\'}"
      value="${value#\'}"
      if [ -z "$value" ]; then
        BLANK+=("$label:$key")
      fi
    else
      MISSING+=("$label:$key")
    fi
  done

  # T-241 19-handoffs-m3.md H5: DATABASE_HOST present flips both pool
  # factories to the discrete-var branch, which ignores DATABASE_URL's
  # sslmode and silently drops TLS. The Linux env files are DSN-only.
  if grep -qE '^DATABASE_HOST=' "$file" 2>/dev/null; then
    echo "FATAL: $label sets DATABASE_HOST — this silently disables TLS (T-241 H5)." >&2
    echo "       Remove it; the Linux env files are DATABASE_URL-only by design." >&2
    exit 1
  fi
}

# T-243 - SLOT DSN ASSERT. Beyond "is the key present", a slot must target the
# database it declares. Without this, a copy-pasted env file leaves the STAGING
# slot building and writing against PRODUCTION db `ipodhan` - the exact accident
# the staging rehearsal exists to prevent, and one no key-presence check can
# see. The slot is derived from the env file's own directory
# (<root>/shared/env/<slot>/web.env.local), so deploy-linux.sh needs no new
# argument. DSN_ASSERT_DB is advisory-if-absent, so pre-T-243 env files and
# local/dev copies keep working; when present it is enforced.
assert_slot_dsn() {
  local file="$1" label="$2" slot dsn db want
  slot="$(basename "$(dirname "$file")")"
  want="$(grep -E "^DSN_ASSERT_DB=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
  [ -n "$want" ] || return 0
  dsn="$(get_value "$file" DATABASE_URL)" || return 0
  dsn="${dsn%\"}"; dsn="${dsn#\"}"
  # Strip the query string BEFORE taking the basename: the DSN carries
  # sslrootcert=/var/www/.../pg-server.crt, so "everything after the last /"
  # would return the certificate filename, not the database.
  db="${dsn%%\?*}"
  db="${db##*/}"
  if [ "$db" != "$want" ]; then
    echo "FATAL: $label declares DSN_ASSERT_DB=$want but DATABASE_URL targets database '$db'." >&2
    exit 1
  fi
  if [ "$slot" != "prod" ] && [ "$db" = "ipodhan" ]; then
    echo "FATAL: slot '$slot' is not prod but $label targets the PRODUCTION database 'ipodhan'." >&2
    exit 1
  fi
  echo "OK: $label -> database '$db' (slot '$slot', DSN-asserted)"
}

# T-264 F2 / T-268 - SLOT REDIS-DB ASSERT. Mirrors assert_slot_dsn above, one
# level down: even with the client fixed to honor REDIS_URL/REDIS_DB, a
# copy-pasted env file can still leave a non-prod slot pointed at Redis db0 -
# the exact db prod uses - silently sharing prod's cache (F2: staging wrote
# into the key prod served, because BOTH the client bug AND this class of
# env mistake had to be closed). Effective db resolution mirrors the
# client's own precedence: REDIS_DB wins when set; otherwise it is read off
# the REDIS_URL path suffix (redis://host:port/N); otherwise db0.
# DSN_ASSERT_REDIS_DB is advisory-if-absent, like DSN_ASSERT_DB.
resolve_redis_db() {
  local file="$1" redis_db redis_url path
  redis_db="$(get_value "$file" REDIS_DB)" || redis_db=""
  redis_db="${redis_db%\"}"; redis_db="${redis_db#\"}"
  redis_db="${redis_db%\'}"; redis_db="${redis_db#\'}"
  if [ -n "$redis_db" ]; then
    printf '%s\n' "$redis_db"
    return 0
  fi
  redis_url="$(get_value "$file" REDIS_URL)" || redis_url=""
  redis_url="${redis_url%\"}"; redis_url="${redis_url#\"}"
  # redis://[:pass@]host:port[/db] - take the segment after the last '/',
  # but only if the URL actually carries a path (has a 3rd '/').
  if printf '%s' "$redis_url" | grep -qE '^redis(s)?://[^/]+/[0-9]+$'; then
    path="${redis_url##*/}"
    printf '%s\n' "$path"
    return 0
  fi
  printf '%s\n' "0"
}

assert_slot_redis_db() {
  local file="$1" label="$2" slot want effective
  slot="$(basename "$(dirname "$file")")"
  want="$(grep -E "^DSN_ASSERT_REDIS_DB=" "$file" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d "\"'" || true)"
  # Advisory-if-absent, exactly like assert_slot_dsn: a file that doesn't
  # opt in with DSN_ASSERT_REDIS_DB is unaffected (pre-T-268 env files and
  # local/dev copies keep working).
  [ -n "$want" ] || return 0
  effective="$(resolve_redis_db "$file")"
  if [ "$effective" != "$want" ]; then
    echo "FATAL: $label declares DSN_ASSERT_REDIS_DB=$want but resolves to Redis db '$effective'." >&2
    exit 1
  fi
  if [ "$slot" != "prod" ] && [ "$effective" = "0" ]; then
    echo "FATAL: slot '$slot' is not prod but $label resolves to Redis db 0 (T-264 F2 — the PRODUCTION cache db)." >&2
    exit 1
  fi
  echo "OK: $label -> Redis db '$effective' (slot '$slot', Redis-db-asserted)"
}

# T-306 (T-297 D9 liveness class, issue #213). Reports (never fails) any
# required ENABLE_* scraper flag whose name appears NOWHERE in the source tree
# except inside scheduler/** (the retired SchedulerService path, never
# imported by the prod entrypoint) or its own declaration in
# config/feature-flags.ts (reading it from process.env is not "using" it).
# A flag that only shows up in those two places has zero live consumers on
# `scraper/src/index.ts`, the ONLY process PM2 actually runs.
report_dead_flags() {
  local src_dir="$1"
  [ -n "$src_dir" ] || return 0
  [ -d "$src_dir" ] || { echo "WARN: flag-liveness report skipped, scraper src dir not found: $src_dir" >&2; return 0; }

  local key hits dead=()
  for key in "${SCRAPER_REQUIRED_KEYS[@]}"; do
    case "$key" in
      ENABLE_*) ;;
      *) continue ;;
    esac
    hits="$( { grep -rl "$key" "$src_dir" --include='*.ts' 2>/dev/null \
      | grep -v '/scheduler/' \
      | grep -v 'config/feature-flags\.ts$' || true; } | wc -l | tr -d ' ')"
    if [ "$hits" -eq 0 ]; then
      dead+=("$key")
    fi
  done

  if [ "${#dead[@]}" -gt 0 ]; then
    echo "WARNING: the following scraper flag(s) have NO live consumer outside scheduler/** (T-297 D9 liveness class — the retired SchedulerService path). Setting them true/false in prod is a no-op on the actual entrypoint (scraper/src/index.ts):" >&2
    for key in "${dead[@]}"; do
      echo "  - $key" >&2
    done
  fi
}

check_file "$WEB_ENV_FILE" "web.env.local" "${WEB_REQUIRED_KEYS[@]}"
check_file "$SCRAPER_ENV_FILE" "scraper.env" "${SCRAPER_REQUIRED_KEYS[@]}"
report_dead_flags "$SCRAPER_SRC_DIR"

if [ "${#MISSING[@]}" -gt 0 ] || [ "${#BLANK[@]}" -gt 0 ]; then
  echo "FATAL: required-keys assert failed — deploy refused." >&2
  if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "  Missing keys:" >&2
    for key in "${MISSING[@]}"; do
      echo "    - $key" >&2
    done
  fi
  if [ "${#BLANK[@]}" -gt 0 ]; then
    echo "  Blank values (T-230 lesson — blank is as bad as missing):" >&2
    for key in "${BLANK[@]}"; do
      echo "    - $key" >&2
    done
  fi
  exit 1
fi

assert_slot_dsn "$WEB_ENV_FILE" "web.env.local"
assert_slot_dsn "$SCRAPER_ENV_FILE" "scraper.env"
assert_slot_redis_db "$WEB_ENV_FILE" "web.env.local"
assert_slot_redis_db "$SCRAPER_ENV_FILE" "scraper.env"

echo "OK: all required keys present and non-blank in $WEB_ENV_FILE and $SCRAPER_ENV_FILE"
