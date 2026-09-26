# shellcheck shell=sh
# Redis slot namespace for shell callers (#151). POSIX sh: sourced by both
# scripts/scraper-wake.sh (sh) and scripts/deploy-linux.sh (bash).
#
# This is the shell twin of packages/shared/src/cache/redis-slot.ts, which
# every Node Redis client uses as its ioredis keyPrefix. Both derive the
# prefix from the database the process connects to (ipodhan -> prod:,
# ipodhan_staging -> staging:, any other name -> db-<name>:), cross-check
# DEPLOY_SLOT, and refuse when no database name is derivable. Both are pinned
# to scripts/tests/fixtures/redis-slot-cases.json (TS: redis-slot.test.ts;
# shell: scripts/tests/redis-slot-prefix.test.sh), so a lock key named here
# is the exact key the scraper process holds.

# redis_slot_env_value FILE KEY -> the last KEY=value in FILE, quotes stripped
# (the same read pattern deploy-linux.sh uses for REDIS_URL).
redis_slot_env_value() {
  _rsev="$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  _rsev="${_rsev%\"}"; _rsev="${_rsev#\"}"
  _rsev="${_rsev%\'}"; _rsev="${_rsev#\'}"
  printf '%s' "$_rsev"
}

# redis_slot_pct_decode STRING -> STRING with every %HH decoded, the way the
# TS twin's decodeURIComponent does for the characters a database name may
# hold. A %HH that decodes to anything outside [A-Za-z0-9_/-] is left as a
# literal "%", so the unsafe-name check below refuses it exactly as the TS
# side refuses the decoded character (never silently dropped - e.g. a %0A
# would otherwise vanish inside $(...), turning "ipodhan%0A" into "ipodhan").
redis_slot_pct_decode() {
  _rspd_in="$1"; _rspd_out=""
  while [ -n "$_rspd_in" ]; do
    case "$_rspd_in" in
      %[0-9A-Fa-f][0-9A-Fa-f]*)
        _rspd_rest="${_rspd_in#%??}"
        _rspd_hex="${_rspd_in#%}"; _rspd_hex="${_rspd_hex%"$_rspd_rest"}"
        _rspd_oct="$(printf '%03o' "0x$_rspd_hex")"
        # shellcheck disable=SC2059
        _rspd_ch="$(printf "\\$_rspd_oct")"
        case "$_rspd_ch" in
          [A-Za-z0-9_/-]) _rspd_out="$_rspd_out$_rspd_ch" ;;
          *) _rspd_out="$_rspd_out%" ;;
        esac
        _rspd_in="$_rspd_rest"
        ;;
      *)
        _rspd_rest="${_rspd_in#?}"
        _rspd_out="$_rspd_out${_rspd_in%"$_rspd_rest"}"
        _rspd_in="$_rspd_rest"
        ;;
    esac
  done
  printf '%s' "$_rspd_out"
}

# redis_slot_prefix DATABASE_URL DATABASE_HOST DATABASE_PASSWORD DATABASE_NAME DEPLOY_SLOT
# Prints the prefix (e.g. "prod:") and returns 0, or prints the reason on
# stderr and returns 1. Branch order mirrors the pg pool (initPool): discrete
# DATABASE_HOST + DATABASE_PASSWORD -> DATABASE_NAME, else DATABASE_URL.
redis_slot_prefix() {
  _rsp_url="${1:-}"; _rsp_host="${2:-}"; _rsp_pw="${3:-}"; _rsp_name="${4:-}"; _rsp_deploy="${5:-}"
  if [ -n "$_rsp_host" ] && [ -n "$_rsp_pw" ]; then
    _rsp_db="$_rsp_name"
  elif [ -n "$_rsp_url" ]; then
    _rsp_db="${_rsp_url#*://}"
    case "$_rsp_db" in
      */*) _rsp_db="${_rsp_db#*/}" ;;
      *) _rsp_db="" ;;
    esac
    _rsp_db="${_rsp_db%%\?*}"
    _rsp_db="${_rsp_db%%#*}"
    # new URL().pathname then decodeURIComponent, then the first segment.
    _rsp_db="$(redis_slot_pct_decode "$_rsp_db")"
    _rsp_db="${_rsp_db%%/*}"
  else
    _rsp_db=""
  fi
  if [ -z "$_rsp_db" ]; then
    echo "[redis-slot] no database name (DATABASE_URL path, or DATABASE_NAME with DATABASE_HOST) is set; refusing to name an unprefixed Redis key" >&2
    return 1
  fi
  case "$_rsp_db" in
    *[!A-Za-z0-9_-]*)
      echo "[redis-slot] database name \"$_rsp_db\" contains characters that are unsafe in a Redis key pattern" >&2
      return 1
      ;;
  esac
  case "$_rsp_db" in
    ipodhan) _rsp_slot=prod ;;
    ipodhan_staging) _rsp_slot=staging ;;
    *) _rsp_slot="db-$_rsp_db" ;;
  esac
  if [ -n "$_rsp_deploy" ] && [ "$_rsp_deploy" != "$_rsp_slot" ]; then
    echo "[redis-slot] DEPLOY_SLOT=$_rsp_deploy disagrees with the connected database \"$_rsp_db\" (slot $_rsp_slot)" >&2
    return 1
  fi
  printf '%s:' "$_rsp_slot"
}
