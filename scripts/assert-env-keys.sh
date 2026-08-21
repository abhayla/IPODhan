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
# Usage: scripts/assert-env-keys.sh <web-env-file> <scraper-env-file>

set -euo pipefail

usage() {
  echo "Usage: $0 <web-env-file> <scraper-env-file>" >&2
  exit 2
}

if [ "$#" -ne 2 ]; then
  usage
fi

WEB_ENV_FILE="$1"
SCRAPER_ENV_FILE="$2"

WEB_REQUIRED_KEYS=(
  NODE_ENV
  DATABASE_URL
  REDIS_URL
  REDIS_HOST
  REDIS_PORT
  REDIS_PASSWORD
  ADMIN_API_TOKEN
  NEXT_PUBLIC_GA_MEASUREMENT_ID
  NEXT_PUBLIC_ZERODHA_AFFILIATE_LINK
  NEXT_PUBLIC_ANGELONE_AFFILIATE_LINK
  PORT
  NOTIFIER_URL
  NOTIFIER_KEY
  NOTIFIER_PROJECT
)

SCRAPER_REQUIRED_KEYS=(
  NODE_ENV
  DATABASE_URL
  REDIS_URL
  REDIS_HOST
  REDIS_PORT
  REDIS_PASSWORD
  SCRAPER_ENABLED
  SCRAPER_INTERVAL_MODE
  ENABLE_SOURCE_TRACKING
  ENABLE_CONFLICT_DETECTION
  ENABLE_DATA_CONSOLIDATION
  ADMIN_API_TOKEN
  WEB_INTERNAL_URL
  NOTIFIER_URL
  NOTIFIER_KEY
  NOTIFIER_PROJECT
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

check_file "$WEB_ENV_FILE" "web.env.local" "${WEB_REQUIRED_KEYS[@]}"
check_file "$SCRAPER_ENV_FILE" "scraper.env" "${SCRAPER_REQUIRED_KEYS[@]}"

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

echo "OK: all required keys present and non-blank in $WEB_ENV_FILE and $SCRAPER_ENV_FILE"
