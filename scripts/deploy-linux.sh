#!/usr/bin/env bash
# IPODhan Linux deploy — SHA release directories + atomic `current` symlink
# cutover, PM2-managed (T-242 M3, migration plan v4). Runs ON the self-hosted
# Linux runner/box itself (no SSH — unlike gorefer's deploy.sh, which pushes
# from a dev machine to a remote box over SSH; here the GH Actions job
# already IS the target box).
#
# WHY THIS SHAPE (reuses the gorefer release-dir pattern, T-162 lineage):
#   Untarring a new tree on top of a live directory serves a mix of two
#   commits for however long the copy takes, and a bad build leaves no way
#   back except redeploying the old SHA over it. Release directories make
#   the new tree invisible until it is complete and health-probed, then one
#   atomic symlink swap makes it live.
#
# LAYOUT ON THE BOX ($ROOT = /var/www/ipodhan by default):
#   prod slot:
#     $ROOT/releases/<UTCstamp>-<shortsha>/   one immutable checkout per deploy
#     $ROOT/current -> releases/<...>         served by nginx/PM2
#   staging (or any other) slot <SLOT>:
#     $ROOT/releases-<SLOT>/<UTCstamp>-<shortsha>/
#     $ROOT/current-<SLOT> -> releases-<SLOT>/<...>
#   shared, every slot:
#     $ROOT/shared/env/<SLOT>/web.env.local   linked into each release as
#     $ROOT/shared/env/<SLOT>/scraper.env     web/.env.local / scraper/.env
#     $ROOT/shared/certs/pg-server.crt        Windows PG's TLS cert (T-241)
#   Each release links web/.env.local and scraper/.env back to the shared
#   per-slot env files, so a release directory is a complete, runnable app
#   root and `npm run build` bakes that slot's NEXT_PUBLIC_* values.
#
# PM2 apps (prod keeps the EXISTING Windows app names so monitoring/Notifier
# config that already refers to them by name keeps working after cutover):
#   prod:    ipodhan-web            ipodhan-scraper
#   <SLOT>:  ipodhan-web-<SLOT>     ipodhan-scraper-<SLOT>
#
# ORDER OF OPERATIONS:
#   1. Resolve the commit; refuse a dirty tree unless --force.
#   2. Required-keys assert (scripts/assert-env-keys.sh) against the slot's
#      env files — BEFORE any build work.
#   3. Build/scrape mutual exclusion: wait for the scraper to be idle
#      (not mid-cycle), then stop it for the build+flip window.
#   4. Create a NEW release dir; stream the exact committed tree into it.
#   5. Link the slot's env files in; `npm ci` + build with those env vars
#      SOURCED so NEXT_PUBLIC_* bake into the build.
#   6. Health-probe the new release on a throwaway localhost port (`/` and
#      `/api/health`) BEFORE the flip.
#   7. Atomically flip `current`/`current-<SLOT>`, write DEPLOYED_SHA.
#   8. `pm2 reload` the web app; `pm2 delete`+`start` the scraper app from
#      the release's realpath (cron_restart re-arms it).
#   9. Probe the public-facing health URL; on failure, AUTO-ROLLBACK to the
#      previous release and restart PM2 against it.
#  10. Resume the scraper against whichever release ended up live (new on
#      success, old on rollback) — it is never left stopped.
#  11. Prune to the last N releases (default 5), never deleting `current`.
#
# Usage:
#   scripts/deploy-linux.sh <staging|prod>              # deploy local HEAD
#   scripts/deploy-linux.sh <staging|prod> <commit-ish>  # deploy a specific commit
#   scripts/deploy-linux.sh <staging|prod> --force       # allow a dirty tree
#   scripts/deploy-linux.sh <staging|prod> --dry-run     # exercise the
#     release-dir/flip/prune/rollback bookkeeping locally against a temp
#     dir with FAKE build/pm2/probe steps — no real npm/next/pm2 calls, no
#     box needed. This is what scripts/tests/deploy-linux.test.sh drives.
#
# Env overrides: DEPLOY_ROOT, DEPLOY_KEEP_RELEASES, DEPLOY_PROBE_PORT,
# DEPLOY_MUTEX_MAX_WAIT_SECONDS, DEPLOY_MUTEX_POLL_SECONDS,
# DEPLOY_HEALTH_TIMEOUT_SECONDS, DEPLOY_FAIL_BUILD (dry-run test hook — set
# to force the "build" step to fail so the abort/no-flip path is exercised).

set -euo pipefail

DRY_RUN=0
FORCE=0
SLOT=""
COMMITISH="HEAD"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    staging|prod) SLOT="$arg" ;;
    *) COMMITISH="$arg" ;;
  esac
done

if [ -z "$SLOT" ]; then
  echo "ERROR: deploy slot required — usage: $0 <staging|prod> [commit-ish] [--force] [--dry-run]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if (( DRY_RUN )); then
  ROOT="${DEPLOY_ROOT:-${TMPDIR:-/tmp}/ipodhan-deploy-dryrun}"
else
  ROOT="${DEPLOY_ROOT:-/var/www/ipodhan}"
fi

if [ "$SLOT" = "prod" ]; then
  RELEASES_DIR="$ROOT/releases"
  CURRENT_LINK="$ROOT/current"
  PM2_WEB_APP="ipodhan-web"
  PM2_SCRAPER_APP="ipodhan-scraper"
else
  RELEASES_DIR="$ROOT/releases-$SLOT"
  CURRENT_LINK="$ROOT/current-$SLOT"
  PM2_WEB_APP="ipodhan-web-$SLOT"
  PM2_SCRAPER_APP="ipodhan-scraper-$SLOT"
fi

ENV_DIR="$ROOT/shared/env/$SLOT"
WEB_ENV_FILE="$ENV_DIR/web.env.local"
SCRAPER_ENV_FILE="$ENV_DIR/scraper.env"
CERT_FILE="$ROOT/shared/certs/pg-server.crt"

KEEP_RELEASES="${DEPLOY_KEEP_RELEASES:-5}"
PROBE_PORT="${DEPLOY_PROBE_PORT:-3999}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-30}"
MUTEX_MAX_WAIT="${DEPLOY_MUTEX_MAX_WAIT_SECONDS:-600}"
MUTEX_POLL="${DEPLOY_MUTEX_POLL_SECONDS:-15}"

# T-243: npm workspaces HOISTS dependencies to the RELEASE ROOT, so the
# per-workspace paths this script used ("<rel>/web/node_modules/next/...",
# "<rel>/scraper/node_modules/tsx/...") do not exist on a real install.
# Resolve each binary wherever npm actually placed it, and die loudly if
# it is genuinely absent rather than pm2-starting a non-existent file.
resolve_bin() {
  local rel="$1" relpath="$2" base
  for base in "$rel/web/node_modules" "$rel/scraper/node_modules" "$rel/node_modules"; do
    if [ -f "$base/$relpath" ]; then printf '%s' "$base/$relpath"; return 0; fi
  done
  echo "FATAL: $relpath not found under $rel (web/, scraper/ or root node_modules)" >&2
  exit 1
}

log() { echo "==> $*"; }
warn() { echo "WARN: $*" >&2; }
fatal() { echo "FATAL: $*" >&2; exit 1; }

# ---------------------------------------------------------------- resolve commit
if [[ "$COMMITISH" == "HEAD" && "$FORCE" -ne 1 ]]; then
  if [[ -n "$(cd "$REPO_ROOT" && git status --porcelain)" ]]; then
    fatal "working tree is dirty. Commit/stash first, or pass --force to deploy HEAD as-is."
  fi
fi

SHA="$(cd "$REPO_ROOT" && git rev-parse "$COMMITISH")"
SHORT_SHA="$(cd "$REPO_ROOT" && git rev-parse --short "$COMMITISH")"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
RELEASE_NAME="$STAMP-$SHORT_SHA"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

log "Deploying $SHORT_SHA to slot '$SLOT' as release $RELEASE_NAME under $ROOT (dry_run=$DRY_RUN)"

# ------------------------------------------------------- 1. required-keys assert
# H5/T-230: refuse to even START building on a bad env — never build-then-discover.
if (( DRY_RUN )); then
  log "[dry-run] skipping required-keys assert (no real env files under $ENV_DIR)"
else
  log "Required-keys assert against $WEB_ENV_FILE / $SCRAPER_ENV_FILE"
  bash "$SCRIPT_DIR/assert-env-keys.sh" "$WEB_ENV_FILE" "$SCRAPER_ENV_FILE"
fi

# --------------------------------------------- 2. build/scrape mutual exclusion
# Refuse to build while a scraper cycle is in flight (PM2 fork + autorestart:false
# + cron_restart means "online" == actively mid-cycle; "stopped" == idle between
# cycles, the expected steady state). Stop it for the whole build+flip window so
# cron_restart cannot fire a new cycle against a half-built release; resumed in
# step 6 against whichever release ends up live.
wait_for_scraper_idle() {
  local waited=0 status
  while true; do
    status="$(pm2_app_status "$PM2_SCRAPER_APP")"
    if [ "$status" != "online" ]; then
      log "Scraper ($PM2_SCRAPER_APP) status='$status' — not mid-cycle, safe to build."
      return 0
    fi
    if [ "$waited" -ge "$MUTEX_MAX_WAIT" ]; then
      fatal "scraper ($PM2_SCRAPER_APP) still 'online' (mid-cycle) after ${MUTEX_MAX_WAIT}s — refusing to build."
    fi
    log "Scraper cycle in flight (status=online) — waiting ${MUTEX_POLL}s (${waited}/${MUTEX_MAX_WAIT}s elapsed)..."
    sleep "$MUTEX_POLL"
    waited=$((waited + MUTEX_POLL))
  done
}

pm2_app_status() {
  local app="$1"
  if (( DRY_RUN )); then
    printf '%s' "${DEPLOY_DRYRUN_SCRAPER_STATUS:-stopped}"
    return 0
  fi
  pm2 jlist 2>/dev/null | node -e '
    const apps = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const app = apps.find((a) => a.name === process.argv[1]);
    process.stdout.write(app ? app.pm2_env.status : "absent");
  ' "$app" 2>/dev/null || printf 'absent'
}

# wait_for_scraper_idle runs in both real and dry-run modes — pm2_app_status
# branches on DRY_RUN internally (returning $DEPLOY_DRYRUN_SCRAPER_STATUS, so
# scripts/tests/deploy-linux.test.sh can exercise the "cycle in flight ->
# wait -> timeout -> refuse to build" path without a real box). Only the
# actual `pm2 stop` call is skipped in dry-run.
wait_for_scraper_idle
if (( DRY_RUN )); then
  log "[dry-run] skipping real 'pm2 stop $PM2_SCRAPER_APP'"
else
  log "Stopping scraper ($PM2_SCRAPER_APP) for the build+flip window"
  pm2 stop "$PM2_SCRAPER_APP" >/dev/null 2>&1 || warn "pm2 stop $PM2_SCRAPER_APP: not running / not found (ok on first deploy)"
fi

# A single trap resumes the scraper on ANY exit path (success, rollback, or a
# hard failure before the flip) — it is never left stopped by this script.
SCRAPER_RESUME_TARGET="prev" # 'new' set once the flip to the new release lands
resume_scraper() {
  if (( DRY_RUN )); then
    log "[dry-run] would resume scraper ($PM2_SCRAPER_APP) against '$SCRAPER_RESUME_TARGET' release"
    return 0
  fi
  local target_dir
  if [ "$SCRAPER_RESUME_TARGET" = "new" ]; then
    target_dir="$RELEASE_DIR"
  else
    target_dir="$(read_current_link || true)"
  fi
  if [ -z "$target_dir" ] || [ ! -d "$target_dir" ]; then
    warn "resume_scraper: no valid release dir to resume against ($target_dir) — scraper stays stopped, investigate."
    return 0
  fi
  log "Resuming scraper ($PM2_SCRAPER_APP) from $target_dir"
  pm2 delete "$PM2_SCRAPER_APP" >/dev/null 2>&1 || true
  ( cd "$target_dir/scraper" && pm2 start "$(resolve_bin "$target_dir" tsx/dist/cli.mjs)" --name "$PM2_SCRAPER_APP" \
      --no-autorestart --cron-restart="*/30 * * * *" -- src/index.ts --source=all ) \
    || warn "resume_scraper: pm2 start failed for $PM2_SCRAPER_APP — investigate manually, do not assume it is running."
}
trap resume_scraper EXIT

read_current_link() {
  if [ -L "$CURRENT_LINK" ]; then
    readlink "$CURRENT_LINK"
  elif [ -f "$CURRENT_LINK" ]; then
    cat "$CURRENT_LINK"
  fi
}

# Atomically point $CURRENT_LINK at $1. `mv` over an existing symlink is a
# single rename(2), so no request ever sees a missing/half-written
# 'current'. Falls back to a plain marker file when the filesystem cannot
# create a symlink (only relevant to --dry-run testing on a non-symlink-
# capable filesystem, e.g. this repo's Windows dev box under MSYS bash —
# the real Linux target always supports native symlinks).
atomic_flip_current() {
  local target="$1"
  if ln -sfn "$target" "$CURRENT_LINK.tmp" 2>/dev/null && [ -L "$CURRENT_LINK.tmp" ]; then
    mv -Tf "$CURRENT_LINK.tmp" "$CURRENT_LINK"
  else
    rm -rf "$CURRENT_LINK.tmp"
    printf '%s\n' "$target" > "$CURRENT_LINK.tmp"
    rm -rf "$CURRENT_LINK"
    mv -f "$CURRENT_LINK.tmp" "$CURRENT_LINK"
    log "[emulated] current -> $target (no native symlink support here)"
  fi
}

# ------------------------------------------------- 3. prepare layout + release dir
log "Preparing layout and release directory $RELEASE_NAME"
mkdir -p "$RELEASES_DIR" "$ENV_DIR" "$RELEASE_DIR"

# ------------------------------------------------------- 4. stream committed tree
if (( DRY_RUN )); then
  # Real `git archive | tar -x` of the whole repo is exercised by the actual
  # runner deploy — skipped here so the dry-run bookkeeping self-test
  # (scripts/tests/deploy-linux.test.sh) stays fast and box-independent.
  log "[dry-run] skipping real 'git archive | tar -x' — writing a stub marker instead"
  printf '%s\n' "$SHA" > "$RELEASE_DIR/.dry-run-tree-marker"
else
  log "Streaming committed tree ($SHA) into $RELEASE_DIR"
  ( cd "$REPO_ROOT" && git -c core.autocrlf=false archive "$SHA" ) | ( cd "$RELEASE_DIR" && tar -x )
fi

# ------------------------------------------------------- 5. link shared env + certs
log "Linking shared env files into the release"
mkdir -p "$RELEASE_DIR/web" "$RELEASE_DIR/scraper"
if (( DRY_RUN )); then
  log "[dry-run] would symlink $WEB_ENV_FILE -> $RELEASE_DIR/web/.env.local"
  log "[dry-run] would symlink $SCRAPER_ENV_FILE -> $RELEASE_DIR/scraper/.env"
else
  ln -sfn "$WEB_ENV_FILE" "$RELEASE_DIR/web/.env.local"
  ln -sfn "$SCRAPER_ENV_FILE" "$RELEASE_DIR/scraper/.env"
  if [ -f "$CERT_FILE" ]; then
    mkdir -p "$RELEASE_DIR/certs"
    ln -sfn "$CERT_FILE" "$RELEASE_DIR/certs/pg-server.crt"
  fi
fi

# --------------------------------- 6. build (env sourced BEFORE build, per-release)
build_release() {
  if (( DRY_RUN )); then
    if [ "${DEPLOY_FAIL_BUILD:-0}" = "1" ]; then
      echo "[dry-run] simulated build FAILURE (DEPLOY_FAIL_BUILD=1)" >&2
      return 1
    fi
    log "[dry-run] skipping real npm ci / next build"
    : > "$RELEASE_DIR/.dry-run-build-marker"
    return 0
  fi

  set -a
  # shellcheck disable=SC1090  # per-slot generated env file, path known at runtime
  . "$WEB_ENV_FILE"
  set +a
  # NEXT_PUBLIC_BUILD_SHA / NEXT_PUBLIC_BUILT_AT: baked at build time so
  # /api/version reflects THIS release regardless of runtime env (T-242,
  # supersedes T-229).
  export NEXT_PUBLIC_BUILD_SHA="$SHORT_SHA"
  local built_at
  built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  export NEXT_PUBLIC_BUILT_AT="$built_at"

  # T-243: the slot env file above sets NODE_ENV=production, and `set -a` has
  # already exported it — so a bare `npm ci` OMITS devDependencies and the build
  # then dies on missing husky / vitest / @next/bundle-analyzer. Install with
  # dev deps explicitly; the BUILD still runs under NODE_ENV=production.
  # HUSKY=0: release dirs are `git archive` exports, not git repos.
  ( cd "$RELEASE_DIR" && NODE_ENV=development HUSKY=0 npm ci --include=dev --no-audit --no-fund )
  ( cd "$RELEASE_DIR/packages/shared" && npx tsc )
  ( cd "$RELEASE_DIR/web" && npm run build )
  # T-243: NO second `npm ci` inside scraper/. npm ci run from a workspace
  # MEMBER installs only that member's deps and PRUNES everything else - it
  # deleted next/ and husky/ from the tree the web build had just produced.
  # The root workspace install above already covers every workspace.
}

log "Building release (npm ci + next build, env sourced from $WEB_ENV_FILE)"
if ! build_release; then
  fatal "build failed for $RELEASE_NAME — 'current' was NOT touched; $CURRENT_LINK still serves the old release."
fi

# ---------------------------------------------- 7. health-probe BEFORE the flip
probe_release() {
  if (( DRY_RUN )); then
    log "[dry-run] skipping pre-flip probe on 127.0.0.1:$PROBE_PORT"
    return 0
  fi
  log "Health-probing the NEW release on 127.0.0.1:$PROBE_PORT (before the flip)"
  local pidfile="/tmp/ipodhan-preflip-probe-$SLOT.pid"
  rm -f "$pidfile"
  ( cd "$RELEASE_DIR/web" && PORT="$PROBE_PORT" nohup npm run start >/tmp/ipodhan-preflip-probe-"$SLOT".log 2>&1 & echo $! > "$pidfile" )
  local pid; pid="$(cat "$pidfile")"
  cleanup_probe() { kill "$pid" 2>/dev/null || true; }
  trap cleanup_probe RETURN

  local waited=0 root_code=000 health_code=000
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    root_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROBE_PORT/" || true)"
    health_code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PROBE_PORT/api/health" || true)"
    if [ "$root_code" = "200" ] && [ "$health_code" = "200" ]; then
      log "Pre-flip probe: / = $root_code, /api/health = $health_code"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "ERROR: pre-flip probe failed (/ = $root_code, /api/health = $health_code) after ${HEALTH_TIMEOUT}s." >&2
  tail -40 /tmp/ipodhan-preflip-probe-"$SLOT".log >&2 || true
  return 1
}

if ! probe_release; then
  fatal "pre-flip health probe failed for $RELEASE_NAME — 'current' was NOT touched; $CURRENT_LINK still serves the old release."
fi

# ------------------------------------------------------- 8. atomic pointer flip
PREVIOUS_RELEASE="$(read_current_link || true)"
log "Previous release: ${PREVIOUS_RELEASE:-<none - first release-dir deploy>}"

log "Flipping $CURRENT_LINK -> $RELEASE_DIR (atomic)"
atomic_flip_current "$RELEASE_DIR"
printf '%s\n' "$SHORT_SHA" > "$ROOT/DEPLOYED_SHA-$SLOT"
SCRAPER_RESUME_TARGET="new"

# --------------------------------------------------------- 9. restart + verify
restart_pm2() {
  if (( DRY_RUN )); then
    log "[dry-run] would: pm2 reload $PM2_WEB_APP; pm2 delete/start $PM2_SCRAPER_APP from $RELEASE_DIR"
    return 0
  fi
  local instances="${DEPLOY_WEB_INSTANCES:-2}"
  ( cd "$RELEASE_DIR/web" && pm2 reload "$PM2_WEB_APP" --update-env ) \
    || ( cd "$RELEASE_DIR/web" && pm2 start "$(resolve_bin "$RELEASE_DIR" next/dist/bin/next)" --name "$PM2_WEB_APP" \
           -i "$instances" -- start )
  # Scraper is delete+start (not reload) on every deploy — it is a one-shot
  # fork process, not a long-lived server (pm2-scheduled-one-shot-scraper.md).
  # Exact script/args mirror the existing ecosystem.config.js entry so the
  # Linux PM2 process list looks like the Windows one it is replacing.
  pm2 delete "$PM2_SCRAPER_APP" >/dev/null 2>&1 || true
  ( cd "$RELEASE_DIR/scraper" && pm2 start "$(resolve_bin "$RELEASE_DIR" tsx/dist/cli.mjs)" --name "$PM2_SCRAPER_APP" \
      --no-autorestart --cron-restart="*/30 * * * *" -- src/index.ts --source=all )
  SCRAPER_RESUME_TARGET="new" # scraper is already up against the new release; resume_scraper's EXIT trap becomes a no-op re-affirmation
}

verify_public_health() {
  if (( DRY_RUN )); then
    log "[dry-run] skipping post-flip public health probe"
    return 0
  fi
  local port; port="$(grep -E '^PORT=' "$WEB_ENV_FILE" | tail -n1 | cut -d= -f2-)"
  local waited=0 code=000
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port:-3000}/api/health" || true)"
    [ "$code" = "200" ] && { log "Post-flip health probe: HTTP $code"; return 0; }
    sleep 1
    waited=$((waited + 1))
  done
  echo "ERROR: post-flip health probe failed (HTTP $code) after ${HEALTH_TIMEOUT}s." >&2
  return 1
}

log "Restarting PM2 apps"
restart_pm2

if ! verify_public_health; then
  echo "ERROR: post-flip verification failed for $RELEASE_NAME." >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    log "AUTO-ROLLBACK to $PREVIOUS_RELEASE"
    atomic_flip_current "$PREVIOUS_RELEASE"
    basename "$PREVIOUS_RELEASE" | sed 's/^[0-9]*-[0-9]*-//' > "$ROOT/DEPLOYED_SHA-$SLOT"
    SCRAPER_RESUME_TARGET="prev"
    if (( ! DRY_RUN )); then
      ( cd "$PREVIOUS_RELEASE/web" && pm2 reload "$PM2_WEB_APP" --update-env ) || true
    fi
    echo "Rolled back to the previous release. Investigate before re-deploying." >&2
    exit 1
  else
    echo "No previous release to roll back to — fix forward." >&2
    exit 1
  fi
fi

# restart_pm2 already delete+started the scraper against the NEW release on
# the success path — disarm the EXIT trap so it does not redundantly
# delete+start it a second time. (The rollback branch above intentionally
# leaves the trap armed so it performs the scraper's actual restart.)
trap - EXIT

# ------------------------------------------------------------------- 10. prune
log "Pruning old releases (keeping the newest $KEEP_RELEASES)"
CUR="$(read_current_link || true)"
if [ -d "$RELEASES_DIR" ]; then
  # shellcheck disable=SC2012  # release dir names are timestamp_sha, plain alphanumeric — ls is safe
  TOTAL="$(cd "$RELEASES_DIR" && ls -1 | LC_ALL=C sort | wc -l)"
  if [ "$TOTAL" -gt "$KEEP_RELEASES" ]; then
    cd "$RELEASES_DIR"
    # shellcheck disable=SC2012  # release dir names are timestamp_sha, plain alphanumeric — ls is safe
    ls -1 | LC_ALL=C sort | head -n "$((TOTAL - KEEP_RELEASES))" | while IFS= read -r old; do
      if [ "$RELEASES_DIR/$old" = "$CUR" ]; then
        log "keeping $old (it is 'current')"
        continue
      fi
      log "removing $old"
      rm -rf "${RELEASES_DIR:?}/${old:?}"
    done
    cd "$REPO_ROOT"
  fi
fi

log "Deploy complete: $SHORT_SHA is live via $CURRENT_LINK -> $RELEASE_DIR"
