# shellcheck shell=sh
# redis-cli invocation without an empty AUTH username (#719). POSIX sh:
# sourced by both scripts/scraper-wake.sh (sh) and scripts/deploy-linux.sh
# (bash) — same dual-shell contract as redis-slot-prefix.sh in this dir.
#
# THE DEFECT: redis-cli >=6 parses a `redis://:<pw>@host:port/db` userinfo
# (no username before the colon — the shape of every IPODhan REDIS_URL,
# which carries only a password) as user="" — an EMPTY, non-NULL string,
# never as "no username" (redis src/cli_common.c, parseRedisUri, lines
# 341-343 at tag 7.0.15). `-u URL` then makes cliAuth (cli_common.c
# 1016-1019) send `AUTH "" <pw>` — a login as ACL user "" — which is
# WRONGPASS against a server with a password but no `user ""` ACL entry,
# followed by NOAUTH on the command itself. Every `redis-cli -u "$REDIS_URL"`
# call built from such a URL therefore fails auth every time, silently
# (scripts/scraper-wake.sh's cycle-lock TTL read failed open on every wake).
# ioredis (the app's own Redis client) does not have this defect — it treats
# a missing username as no username, so this is a redis-cli-only class.
#
# THE FIX: never hand `-u URL` to redis-cli. Parse the URL ourselves, pass
# --user only when the URL names a REAL (non-empty) username, and pass the
# password via the REDISCLI_AUTH environment variable — never on the command
# line, where it would show in a process listing and in the
# "Using a password with '-a' or '-u'..." warning redis-cli prints for that
# reason.
#
# redis_cli_prepare_auth REDIS_URL parses the URL and sets, in the CALLING
# shell (a plain sourced function call, not a subshell — the values must
# survive the call):
#   REDIS_CLI_HOST, REDIS_CLI_PORT (defaults 6379), REDIS_CLI_DB (may be
#   empty — no `-n`), REDIS_CLI_USER (empty unless the URL names a real,
#   non-empty user), and exports REDISCLI_AUTH (only when the URL carries a
#   password — an unconditionally-exported empty REDISCLI_AUTH would itself
#   make redis-cli send `AUTH ""`, the exact defect this file removes).
# Returns 0 on success. On a URL this cannot safely parse, prints the reason
# on stderr (never the URL or password itself) and returns 1 — callers keep
# their existing fail-open behaviour for that case.
redis_cli_prepare_auth() {
  _rca_url="${1:-}"
  REDIS_CLI_HOST=""
  REDIS_CLI_PORT="6379"
  REDIS_CLI_DB=""
  REDIS_CLI_USER=""
  unset REDISCLI_AUTH 2>/dev/null

  if [ -z "$_rca_url" ]; then
    echo "[redis-cli-auth] empty REDIS_URL" >&2
    return 1
  fi

  _rca_rest="${_rca_url#*://}"
  if [ "$_rca_rest" = "$_rca_url" ]; then
    echo "[redis-cli-auth] REDIS_URL has no scheme (redis:// or rediss://)" >&2
    return 1
  fi

  case "$_rca_rest" in
    */*) _rca_authority="${_rca_rest%%/*}"; _rca_path="/${_rca_rest#*/}" ;;
    *)   _rca_authority="$_rca_rest"; _rca_path="" ;;
  esac

  # First '@' splits userinfo from host; a password containing a literal '@'
  # (never our own case — the deployed passwords have none — but a real URL
  # could) still resolves correctly because the LAST '@' is used for the
  # host split below and the FIRST for userinfo — the standard two-pass trick.
  case "$_rca_authority" in
    *@*) _rca_userinfo="${_rca_authority%%@*}"; _rca_hostport="${_rca_authority##*@}" ;;
    *)   _rca_userinfo=""; _rca_hostport="$_rca_authority" ;;
  esac

  case "$_rca_userinfo" in
    *%*)
      echo "[redis-cli-auth] REDIS_URL userinfo contains a percent-encoded character; refusing rather than guess the decoded password" >&2
      return 1
      ;;
  esac

  case "$_rca_hostport" in
    *:*) REDIS_CLI_HOST="${_rca_hostport%%:*}"; REDIS_CLI_PORT="${_rca_hostport##*:}" ;;
    *)   REDIS_CLI_HOST="$_rca_hostport" ;;
  esac
  if [ -z "$REDIS_CLI_HOST" ]; then
    echo "[redis-cli-auth] REDIS_URL has no host" >&2
    return 1
  fi
  if [ -z "$REDIS_CLI_PORT" ]; then
    REDIS_CLI_PORT="6379"
  fi

  case "$_rca_userinfo" in
    "") _rca_user=""; _rca_pw="" ;;
    *:*) _rca_user="${_rca_userinfo%%:*}"; _rca_pw="${_rca_userinfo#*:}" ;;
    *) _rca_user="$_rca_userinfo"; _rca_pw="" ;;
  esac
  # THE FIX, precisely: an empty username (userinfo = ":<pw>", the shape
  # that trips `-u`) is treated as "no username" — REDIS_CLI_USER stays "",
  # so no --user flag is ever emitted for it. Only a REAL non-empty username
  # sets REDIS_CLI_USER.
  if [ -n "$_rca_user" ]; then
    REDIS_CLI_USER="$_rca_user"
  fi
  if [ -n "$_rca_pw" ]; then
    REDISCLI_AUTH="$_rca_pw"
    export REDISCLI_AUTH
  fi

  _rca_db="${_rca_path#/}"
  _rca_db="${_rca_db%%\?*}"
  _rca_db="${_rca_db%%#*}"
  REDIS_CLI_DB="$_rca_db"

  return 0
}

# redis_cli_run TIMEOUT_SECONDS REDIS_URL CMD... — parses REDIS_URL via
# redis_cli_prepare_auth above and runs `timeout TIMEOUT_SECONDS redis-cli
# ... CMD...` with the resulting host/port/user/db/auth. Never passes -u or
# the password on the command line. Returns 2 (outside redis-cli's own exit
# codes, which are 0/1/124-from-timeout) when REDIS_URL itself could not be
# parsed, so a caller can tell "redis-cli ran and failed" (a real Redis-side
# defect, signal-ownership.md R6) apart from "the URL was unusable" (this
# file's own defect) — mirroring how callers already distinguish
# "redis-cli missing" from "TTL returned no usable value".
redis_cli_run() {
  _rcr_timeout="$1"; _rcr_url="$2"; shift 2
  if ! redis_cli_prepare_auth "$_rcr_url"; then
    return 2
  fi
  if [ -n "$REDIS_CLI_USER" ]; then
    if [ -n "$REDIS_CLI_DB" ]; then
      set -- -h "$REDIS_CLI_HOST" -p "$REDIS_CLI_PORT" --user "$REDIS_CLI_USER" -n "$REDIS_CLI_DB" "$@"
    else
      set -- -h "$REDIS_CLI_HOST" -p "$REDIS_CLI_PORT" --user "$REDIS_CLI_USER" "$@"
    fi
  else
    if [ -n "$REDIS_CLI_DB" ]; then
      set -- -h "$REDIS_CLI_HOST" -p "$REDIS_CLI_PORT" -n "$REDIS_CLI_DB" "$@"
    else
      set -- -h "$REDIS_CLI_HOST" -p "$REDIS_CLI_PORT" "$@"
    fi
  fi
  timeout "$_rcr_timeout" redis-cli "$@"
}
