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
  # item 01 slice s5a: same belt-and-braces contract as TZ above.
  # DEPLOY_SLOT is what actually reaches the running pm2 process
  # (`DEPLOY_SLOT="$SLOT" pm2 start ...` in deploy-linux.sh's restart_pm2/
  # resume_scraper/rollback paths) — required here too so a human reading
  # shared/env/<SLOT>/web.env.local sees the slot contract explicitly, and
  # so this script fails loudly if a slot's hand-provisioned env file is
  # ever missing it. VALUE is not enforced by this check (only presence);
  # slotAwareFlagDefault() in web/lib/config/feature-flags.ts and
  # scraper/src/config/feature-flags.ts is what actually branches on the
  # VALUE at runtime.
  DEPLOY_SLOT
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
  ENABLE_SOURCE_TRACKING
  ENABLE_CONFLICT_DETECTION
  ENABLE_DATA_CONSOLIDATION
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
  # item 01 slice s5a: same belt-and-braces contract as TZ above and as
  # WEB_REQUIRED_KEYS' DEPLOY_SLOT entry — required here too so this script
  # fails loudly if the scraper slot's env file is ever missing it. VALUE is
  # not enforced by this check.
  DEPLOY_SLOT
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

# T-297 D9 / #193 (rollout-flag LIVENESS). T-282 root cause:
# CONSOLIDATION_PERCENTAGE=0 in production silently voided the entire
# consolidation pipeline -- every field-priority rule and every guard built
# across multiple review rounds -- while report_dead_flags() above and
# check_file() only prove a flag is PRESENT, never that its live VALUE
# actually turns the feature on. This asserts VALUE liveness, on the prod
# slot only (a genuine staged rollout below 100% is legitimate on any slot;
# only prod's live-traffic gates are asserted non-zero).
#
# SSOT for which flags gate live logic is scraper/src/config/feature-flags.ts
# itself (never hand-duplicated here): a `// LIVE-GATE` comment on a
# *_PERCENTAGE field means 0 there is a defect (must be integer 1-100); a
# `// PROD-REQUIRED-TRUE` comment on a boolean ENABLE_* field means it must
# be literally 'true' on the prod slot. Advisory-if-no-src-dir (mirrors
# report_dead_flags -- deploy-linux.sh always passes the 3rd arg, so real
# deploys are always covered; only the 2-arg test-harness calls above are
# unaffected).
#
# Escape hatch for a DELIBERATE ramp-down: set ALLOW_ZERO_FLAGS=A,B in the
# slot's own scraper.env -- logs a loud WARNING instead of failing.
assert_rollout_flags_live() {
  local scraper_env_file="$1" src_dir="$2" slot flags_file
  slot="$(basename "$(dirname "$scraper_env_file")")"

  if [ -z "$src_dir" ]; then
    echo "WARN: rollout-flag liveness check (T-297 D9 / #193) skipped — no scraper src dir given." >&2
    return 0
  fi
  flags_file="$src_dir/config/feature-flags.ts"
  if [ ! -f "$flags_file" ]; then
    echo "WARN: rollout-flag liveness check (T-297 D9 / #193) skipped — feature-flags.ts not found at $flags_file" >&2
    return 0
  fi

  # T-467 round 2 (Tier A HIGH): the marker match is on the LINE (key + marker
  # sharing one line), not tied to `parseInt(...)`/`process.env...` shape --
  # a reformatted/wrapped field still matches as long as the key and its
  # `// LIVE-GATE` / `// PROD-REQUIRED-TRUE` marker stay on the same line.
  local live_gate_keys=() required_true_keys=()
  while IFS= read -r key; do
    [ -n "$key" ] && live_gate_keys+=("$key")
  done < <(grep -oP "^\s*\K[A-Z0-9_]+(?=:.*//\s*LIVE-GATE)" "$flags_file" 2>/dev/null || true)
  while IFS= read -r key; do
    [ -n "$key" ] && required_true_keys+=("$key")
  done < <(grep -oP "^\s*\K[A-Z0-9_]+(?=:.*//\s*PROD-REQUIRED-TRUE)" "$flags_file" 2>/dev/null || true)

  local trim
  trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }
  # T-467 round 4 (Tier A MEDIUM): trim -> strip quotes -> trim, not
  # strip-then-trim. A value like `"100" ` (quoted + trailing space, which
  # the app's own env loader accepts fine) has its closing quote sitting
  # right before the trailing space; stripping quotes BEFORE trimming left
  # a stray `"` glued to the value ('100"', refused as non-integer) and left
  # a quoted ALLOW_ZERO_FLAGS silently un-stripped (so the allow-list never
  # matched). clean() trims first, strips one matching pair of quotes, then
  # trims again.
  clean() { local s; s="$(trim "$1")"; s="${s%\"}"; s="${s#\"}"; s="${s%\'}"; s="${s#\'}"; trim "$s"; }

  # T-467 round 2 (Tier A HIGH): a marker-wording change, a reflow that puts
  # the key and its marker on different lines, or a `grep` without -P support
  # all collapse to the SAME symptom -- zero keys derived, loop bodies never
  # run, exit 0. That is a silent false negative on the exact class this
  # check exists to catch. Refuse to pass quietly -- but only where the gate
  # actually enforces anything (the prod slot): a non-prod caller (or a
  # deliberately marker-less fixture, like the report_dead_flags tests'
  # scraper-src-fake) never enforced liveness in the first place, so 0
  # derived there is a no-op, not a regression.
  if [ "$slot" = "prod" ] && [ "${#live_gate_keys[@]}" -eq 0 ] && [ "${#required_true_keys[@]}" -eq 0 ]; then
    echo "FATAL: rollout-flag liveness assert derived 0 flags from $flags_file (T-297 D9 / #193) — the // LIVE-GATE / // PROD-REQUIRED-TRUE marker grep matched nothing. This is refused rather than silently passed: either the marker wording changed, a field's key and marker no longer share one line, or this grep lacks -P support. Fix the markers or the grep, do not ignore this." >&2
    exit 1
  fi

  local allow_zero
  allow_zero="$(get_value "$scraper_env_file" ALLOW_ZERO_FLAGS)" || allow_zero=""
  allow_zero="$(clean "$allow_zero")"

  # T-467 round 2 (Tier A LOW): staging is exempt from enforcement, but a
  # live-gate flag sitting at 0 there is still worth one INFO line -- it is
  # never a failure, just visibility.
  if [ "$slot" != "prod" ]; then
    local key value
    for key in "${live_gate_keys[@]}"; do
      value="$(get_value "$scraper_env_file" "$key")" || value="0"
      value="$(clean "$value")"
      if printf '%s' "$value" | grep -qE '^[0-9]+$' && [ "$value" -eq 0 ]; then
        echo "INFO: rollout flag $key=0 on slot '$slot' (non-prod; liveness gate is prod-only, T-297 D9 / #193)."
      fi
    done
    return 0
  fi

  local key value allowed FAILS=()

  for key in "${live_gate_keys[@]}"; do
    value="$(get_value "$scraper_env_file" "$key")" || value="0"
    value="$(clean "$value")"
    allowed=0
    if [ -n "$allow_zero" ] && printf '%s\n' "$allow_zero" | tr ',' '\n' | tr -d '[:space:]' | grep -qx "$key"; then
      allowed=1
    fi
    if ! printf '%s' "$value" | grep -qE '^[0-9]+$'; then
      FAILS+=("$key: non-integer value '$value' (must be an integer 0-100)")
    elif [ "$value" -eq 0 ]; then
      if [ "$allowed" -eq 1 ]; then
        echo "WARNING: rollout flag $key=0 on prod — allowed via ALLOW_ZERO_FLAGS (deliberate ramp-down, confirm this is intentional)." >&2
      else
        FAILS+=("$key=0 — feature is silently OFF in prod (T-282 class, #193). Set >=1, or add $key to ALLOW_ZERO_FLAGS in scraper.env for a deliberate ramp-down.")
      fi
    elif [ "$value" -gt 100 ]; then
      FAILS+=("$key=$value — must be in [0,100]")
    else
      echo "OK: rollout flag $key=$value (live, prod slot)"
    fi
  done

  for key in "${required_true_keys[@]}"; do
    value="$(get_value "$scraper_env_file" "$key")" || value="false"
    value="$(clean "$value")"
    if [ "$value" != "true" ]; then
      FAILS+=("$key=$value — required 'true' on prod slot (T-297 D9 / #193)")
    else
      echo "OK: prod-required flag $key=true"
    fi
  done

  if [ "${#FAILS[@]}" -gt 0 ]; then
    echo "FATAL: rollout-flag liveness assert failed on prod slot — deploy refused (T-297 D9, issue #193):" >&2
    for f in "${FAILS[@]}"; do
      echo "  - $f" >&2
    done
    exit 1
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
assert_rollout_flags_live "$SCRAPER_ENV_FILE" "$SCRAPER_SRC_DIR"

echo "OK: all required keys present and non-blank in $WEB_ENV_FILE and $SCRAPER_ENV_FILE"
