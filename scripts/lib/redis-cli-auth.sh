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
# password to redis-cli via a REDISCLI_AUTH prefix on that ONE invocation
# only (`REDISCLI_AUTH="$pw" redis-cli ...`) — never on the command line
# (where it would show in a process listing and in the "Using a password
# with '-a' or '-u'..." warning redis-cli prints for that reason), and never
# `export`ed into the calling shell (round 1 review, MAJOR 2: an exported
# REDISCLI_AUTH survives in that shell's environment for every process it
# spawns afterwards — e.g. deploy-linux.sh's clear_legacy_unprefixed_cache_keys
# runs on the AUTO-ROLLBACK path, before rollback_start_web and the
# EXIT-trap's resume_scraper start pm2 apps from the SAME shell — and a
# secret in a live process's env is visible to anyone who can run
# `pm2 env <id>`).
#
# redis_cli_prepare_auth REDIS_URL parses the URL and sets, in the CALLING
# shell (a plain sourced function call, not a subshell — the values must
# survive the call):
#   REDIS_CLI_HOST, REDIS_CLI_PORT (defaults 6379), REDIS_CLI_DB (may be
#   empty — no `-n`), REDIS_CLI_USER (empty unless the URL names a real,
#   non-empty user), REDIS_CLI_PASSWORD (may be empty — NEVER exported here;
#   a caller that runs redis-cli directly, rather than through
#   redis_cli_run, MUST pass it as a same-command prefix,
#   `REDISCLI_AUTH="$REDIS_CLI_PASSWORD" redis-cli ...`, and MUST NOT export
#   it or leave it set after the call).
# Returns 0 on success. On a URL this cannot safely parse, prints the reason
# on stderr (never the URL or password itself) and returns 1 — callers keep
# their existing fail-open behaviour for that case.
redis_cli_prepare_auth() {
  _rca_url="${1:-}"
  REDIS_CLI_HOST=""
  REDIS_CLI_PORT="6379"
  REDIS_CLI_DB=""
  REDIS_CLI_USER=""
  REDIS_CLI_PASSWORD=""

  # Round 1 review, MINOR: a trailing (or leading) newline/space on the URL
  # — e.g. from a `.env` line read with a trailing CRLF — would otherwise
  # ride along into the last field parsed (the db number), producing
  # `-n "1 "`, which redis-cli rejects. Trim leading/trailing whitespace
  # (space/tab/CR/LF, [:space:]) before anything else.
  _rca_url="${_rca_url#"${_rca_url%%[![:space:]]*}"}"
  _rca_url="${_rca_url%"${_rca_url##*[![:space:]]}"}"

  if [ -z "$_rca_url" ]; then
    echo "[redis-cli-auth] empty REDIS_URL" >&2
    return 1
  fi

  case "$_rca_url" in
    redis://*) _rca_rest="${_rca_url#redis://}" ;;
    rediss://*)
      # MINOR: `rediss://` (TLS) parsed the same as `redis://` would silently
      # connect in PLAINTEXT — redis-cli needs an explicit `--tls` (and
      # usually `-p 6380`) to actually use TLS. Every IPODhan REDIS_URL is
      # `redis://` (no TLS), so refuse rather than guess at --tls/cert flags
      # we have never had to support.
      echo "[redis-cli-auth] REDIS_URL uses rediss:// (TLS); this helper only supports plain redis:// (refusing rather than silently connecting without TLS)" >&2
      return 1
      ;;
    *)
      echo "[redis-cli-auth] REDIS_URL has no scheme (redis:// or rediss://)" >&2
      return 1
      ;;
  esac

  case "$_rca_rest" in
    */*) _rca_authority="${_rca_rest%%/*}"; _rca_path="/${_rca_rest#*/}" ;;
    *)   _rca_authority="$_rca_rest"; _rca_path="" ;;
  esac

  # Round 1 review, MAJOR 1: split userinfo/host at the LAST '@', not the
  # first — a password containing a literal '@' (e.g. `redis://:FA@KEPW@host`)
  # must keep the whole `FA@KEPW` as the password. `${x%@*}` (single %,
  # shortest suffix removed) cuts at the LAST '@'; `${x##*@}` (longest
  # prefix removed) leaves whatever is after that SAME last '@'. Using the
  # first '@' for userinfo previously silently dropped everything between
  # the first and last '@' (REDISCLI_AUTH=FA instead of FA@KEPW).
  case "$_rca_authority" in
    *@*) _rca_userinfo="${_rca_authority%@*}"; _rca_hostport="${_rca_authority##*@}" ;;
    *)   _rca_userinfo=""; _rca_hostport="$_rca_authority" ;;
  esac

  case "$_rca_userinfo" in
    *%*)
      echo "[redis-cli-auth] REDIS_URL userinfo contains a percent-encoded character; refusing rather than guess the decoded password" >&2
      return 1
      ;;
  esac

  case "$_rca_hostport" in
    "["*)
      # MINOR: a bracketed IPv6 literal (`[::1]:6379`) needs the brackets
      # stripped before -h, or redis-cli gets a host of literally `[::1]`.
      # No IPODhan REDIS_URL uses IPv6, so refuse rather than parse it
      # untested.
      echo "[redis-cli-auth] REDIS_URL host is a bracketed IPv6 literal, which this helper does not parse; refusing rather than pass a malformed -h" >&2
      return 1
      ;;
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
  REDIS_CLI_PASSWORD="$_rca_pw"

  _rca_db="${_rca_path#/}"
  _rca_db="${_rca_db%%\?*}"
  _rca_db="${_rca_db%%#*}"
  REDIS_CLI_DB="$_rca_db"

  return 0
}

# redis_cli_run TIMEOUT_SECONDS REDIS_URL CMD... — parses REDIS_URL via
# redis_cli_prepare_auth above and runs `timeout TIMEOUT_SECONDS redis-cli
# ... CMD...` with the resulting host/port/user/db/auth. Never passes -u or
# the password on the command line, and the password reaches redis-cli only
# as a same-command REDISCLI_AUTH prefix — it is never exported, so it never
# outlives this one call in the shell's own environment. Returns 2 (outside
# redis-cli's own exit codes, which are 0/1/124-from-timeout) when REDIS_URL
# itself could not be parsed, so a caller can tell "redis-cli ran and
# failed" (a real Redis-side defect, signal-ownership.md R6) apart from
# "the URL was unusable" (this file's own defect) — mirroring how callers
# already distinguish "redis-cli missing" from "TTL returned no usable
# value".
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
  if [ -n "$REDIS_CLI_PASSWORD" ]; then
    REDISCLI_AUTH="$REDIS_CLI_PASSWORD" timeout "$_rcr_timeout" redis-cli "$@"
  else
    timeout "$_rcr_timeout" redis-cli "$@"
  fi
}
