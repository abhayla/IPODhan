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
#   shared/env/<SLOT>/*.env is HAND-PROVISIONED ONCE (T-241 M1) and
#   RELEASE-INDEPENDENT — this script and deploy-linux.yml only READ it
#   (via assert-env-keys.sh below), NEITHER EVER WRITES OR REGENERATES IT.
#   This is a deliberate difference from the old Windows deploy.yml, which
#   had an inline "Create ecosystem.config.js" here-string that rewrote the
#   whole env block on every deploy (self-hosted-windows-vps-deploy.md) — on
#   Linux there is no such regeneration step, so a key can only go missing
#   by direct hand-edit of the shared file, never by a deploy. T-251 (F9)
#   is the counter-example that motivated writing this down: four scraper
#   feature flags that lived only in the Windows ecosystem.config.js env{}
#   block were never migrated into shared/env/*/scraper.env at the T-249
#   cutover, and nothing caught it because assert-env-keys.sh's required-key
#   list didn't cover them either. Since there is no regeneration step to
#   "carry the flags forward" on every deploy, THE GUARD IS THE FIX: every
#   key that must exist in shared/env belongs in assert-env-keys.sh's
#   REQUIRED_KEYS list (presence-checked on every deploy), and scraper/
#   .env.example is the source-of-truth reference for what value each key
#   should hold in prod.
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
#   7. Apply database migrations (`npx drizzle-kit migrate`) against this
#      slot's DB, then assert the target DB is actually current
#      (scripts/assert-migrations-applied.sh) — BEFORE the flip. T-267: the
#      Linux pipeline never ran migrations at all until this step existed;
#      drizzle.__drizzle_migrations sat at 0 rows in prod for the app's
#      whole life and a NOT NULL schema drift silently failed 243/243
#      listing-performance upserts every cycle for seven weeks before
#      anyone noticed. See web/drizzle/migrations/_repair/ for the
#      one-time baseline this step depends on.
#   8. Atomically flip `current`/`current-<SLOT>`, write DEPLOYED_SHA.
#   9. `pm2 delete`+`start` BOTH the web app and the scraper app from the
#      release's realpath (cron_restart re-arms the scraper). T-262: NOT
#      `pm2 reload` for the web app — reload reuses the already-running
#      process's original script/cwd instead of repointing it, so it can
#      leave the live process pinned to a stale release even after the
#      flip (2026-08-22 staging 502 chain). See restart_pm2()'s comment.
#  10. Probe the public-facing health URL AND cross-check /api/version's
#      baked-in sha against the release just flipped to — a process still
#      pinned to a stale release fails this even if /api/health returns
#      200. On failure, AUTO-ROLLBACK to the previous release and restart
#      PM2 (delete+start, same as above) against it.
#  11. Resume the scraper against whichever release ended up live (new on
#      success, old on rollback) — it is never left stopped.
#  12. Prune to the last N releases (default 5). T-262: SLOT-AWARE — never
#      deletes a release still referenced by ANY slot's `current`/
#      `current-<slot>` link OR by a live `ipodhan-*` pm2 process's actual
#      cwd (see collect_live_release_dirs()), not just this slot's own
#      `current`.
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
# to force the "build" step to fail so the abort/no-flip path is exercised),
# DEPLOY_FAIL_PREFLIGHT (dry-run test hook — set to force the T-406 runtime
# preflight to fail even in --dry-run, so the abort/no-flip/no-pm2-stop path
# is exercised without a real box), DEPLOY_DRYRUN_PM2_RELEASE_DIRS (dry-run
# test hook — colon-separated release dirs to simulate as "still referenced
# by a live pm2 process" during pruning), DEPLOY_DRYRUN_VERSION_MISMATCH
# (dry-run test hook — set to force the post-flip /api/version sha check to
# simulate a mismatch).

set -Eeuo pipefail

# T-321: name-the-failure safety net. Before this trap existed, ANY command
# that failed under `set -euo pipefail` (a `grep`/pipeline with no match
# assigned to a variable, an unguarded arithmetic expansion, etc.) exited the
# whole deploy with NO error message at all — the log just stopped and the
# EXIT trap (resume_scraper) ran, so a real failure looked identical to a
# clean run that happened to end early. This is a backstop, not a substitute
# for fixing the specific gate (see report_wired_jobs() below for the actual
# T-321 root cause) — every future silent-exit-class bug now prints WHERE and
# WHAT failed before the script exits, instead of failing invisibly.
#
# T-321F (checker HARD finding): `set -euo pipefail` alone does NOT make bash
# inherit the ERR trap into shell functions, command substitutions, or
# subshells (bash's `set -e`/ERR-trap documentation calls this out — POSIX
# mode + missing `errtrace` is the historical default). The real T-321 bug
# lived inside report_wired_jobs(), a FUNCTION, so without `-E` (errtrace)
# this backstop would silently fail to fire for the very failure it was
# written to catch — proven on bash 5.2.37: an unguarded failing pipeline
# inside a function exits non-zero with NO "FATAL:" line under
# `set -euo pipefail`, and DOES print it under `set -Eeuo pipefail`. `-E` is
# what makes the trap apply inside functions/subshells/`$(...)` — see
# scripts/tests/deploy-linux.test.sh case 14 for the RED/GREEN proof.
on_deploy_error() {
  local ec=$?
  echo "FATAL: deploy-linux.sh:${BASH_LINENO[0]:-?} failed running: ${BASH_COMMAND} (exit ${ec})" >&2
  exit "$ec"
}
trap on_deploy_error ERR

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
  bash "$SCRIPT_DIR/assert-env-keys.sh" "$WEB_ENV_FILE" "$SCRAPER_ENV_FILE" "$REPO_ROOT/scraper/src"
fi

# ------------------------------------------- 1.5 runtime preflight (T-406)
# Stage 9 of the test ladder: the box PM2 is about to be restarted on needs
# more than green migrations — python3+pdfplumber (DRHP PDF extraction),
# tesseract (WARN-only until E4), an ambient TZ sane per the T-327 decision,
# a writable prospectus store with headroom, node >= 20, and
# ADMIN_API_TOKEN for the scraper's --source=all cycle. Runs BEFORE `pm2
# stop`/the atomic flip (T-406 round-2 F1 fix) — a FAIL here leaves
# `current` untouched, PM2 untouched, and the scraper running exactly as it
# was; there is nothing to roll back. Running this AFTER the flip (the
# round-1 shape) was the bug: a FAIL there still exited through the
# `resume_scraper` EXIT trap with SCRAPER_RESUME_TARGET="new", which started
# the scraper on the NEW release directory — the box this preflight had just
# declared unfit — and cron would restart it every 30 min. No `|| true`
# here: a FAIL must abort the deploy loudly, same as assert-env-keys.sh /
# the migrations step above.
run_runtime_preflight() {
  if (( DRY_RUN )); then
    if [ "${DEPLOY_FAIL_PREFLIGHT:-0}" = "1" ]; then
      echo "[dry-run] simulated runtime preflight FAILURE (DEPLOY_FAIL_PREFLIGHT=1)" >&2
      return 1
    fi
    log "[dry-run] skipping runtime preflight (no real box/env to check)"
    return 0
  fi
  if [ ! -r "$SCRAPER_ENV_FILE" ]; then
    fatal "scraper env file missing/unreadable: $SCRAPER_ENV_FILE (cannot run runtime preflight)"
  fi
  log "Running VPS runtime preflight (T-406)"
  # T-406 round-2 F2 fix: source scraper.env and run the preflight check in
  # a SUBSHELL. This is defense-in-depth, not the only guard against the web
  # env's values leaking downstream: the web env (WEB_ENV_FILE) is sourced
  # fresh, in the main shell, later in build_release() and restart_pm2()
  # (deploy-linux.sh:446,483) — those re-sources are what actually make
  # `pm2 start ipodhan-web` see the correct web env regardless of what this
  # preflight sourced. The subshell here additionally means scraper.env's
  # DATABASE_URL/REDIS_*/NODE_ENV/ADMIN_API_TOKEN never touch the main
  # shell's exported env at all, so this check can't perturb anything that
  # runs between here and the later re-sources (e.g. the mutex/status calls).
  ( set -a
    # shellcheck disable=SC1090  # per-slot generated env file, path known at runtime
    . "$SCRAPER_ENV_FILE" || exit 1
    set +a
    bash "$SCRIPT_DIR/preflight-runtime.sh"
  )
}

if ! run_runtime_preflight; then
  fatal "runtime preflight failed for $RELEASE_NAME (T-406) — 'current' was NOT touched, still serving the previous release; PM2 was not stopped. Fix the box and redeploy."
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
  # T-327 P2-7: TZ=UTC is explicit at every pm2 start — pm2 captures the
  # invoking shell's env at start time and pins it for restarts/reload, so
  # this is the one place that actually reaches the running process (the
  # retired ecosystem.config.js TZ:'UTC' is never read on this Linux path).
  ( cd "$target_dir/scraper" && TZ=UTC pm2 start "$(resolve_bin "$target_dir" tsx/dist/cli.mjs)" --name "$PM2_SCRAPER_APP" \
      --no-autorestart --cron-restart="*/30 * * * *" -- src/index.ts --source=all ) \
    || warn "resume_scraper: pm2 start failed for $PM2_SCRAPER_APP — investigate manually, do not assume it is running."
}
trap resume_scraper EXIT

# T-262: factored out of read_current_link() so collect_live_release_dirs()
# can resolve ANY slot's current-link, not just this invocation's own.
resolve_link_target() {
  local link="$1"
  if [ -L "$link" ]; then
    readlink "$link"
  elif [ -f "$link" ]; then
    cat "$link"
  fi
}

read_current_link() {
  resolve_link_target "$CURRENT_LINK"
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

# ------------------------------- 7. apply + assert DB migrations BEFORE the flip
apply_migrations() {
  if (( DRY_RUN )); then
    log "[dry-run] skipping real 'drizzle-kit migrate' + migrations-applied assert"
    return 0
  fi
  set -a
  # shellcheck disable=SC1090  # per-slot generated env file, path known at runtime
  . "$WEB_ENV_FILE"
  set +a
  local database_url="$DATABASE_URL"
  local journal_path="$RELEASE_DIR/web/drizzle/migrations/meta/_journal.json"

  log "Applying database migrations (npx drizzle-kit migrate) for slot '$SLOT'"
  if ! ( cd "$RELEASE_DIR/web" && npx drizzle-kit migrate ); then
    echo "FATAL: 'drizzle-kit migrate' failed for $RELEASE_NAME." >&2
    return 1
  fi

  log "Asserting the target DB is current with the journaled migration chain"
  if ! bash "$SCRIPT_DIR/assert-migrations-applied.sh" "$database_url" "$journal_path"; then
    echo "FATAL: migrations-applied assert failed for $RELEASE_NAME (T-267)." >&2
    return 1
  fi

  log "Asserting the target DB's live columns/matviews match packages/shared/src/db/schema.ts (T-330)"
  if ! ( cd "$RELEASE_DIR" && npx tsx scripts/assert-schema-drift.ts "$database_url" ); then
    echo "FATAL: schema-drift assert failed for $RELEASE_NAME (T-330) — the journal says migrations applied," >&2
    echo "       but a live column/matview disagrees with schema.ts. See the named drift above." >&2
    return 1
  fi
}

if ! apply_migrations; then
  fatal "migration step failed for $RELEASE_NAME — 'current' was NOT touched; $CURRENT_LINK still serves the old release."
fi

# ---------------------------------------------- 8. health-probe BEFORE the flip
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

# ------------------------------------------------------- 9. atomic pointer flip
PREVIOUS_RELEASE="$(read_current_link || true)"
log "Previous release: ${PREVIOUS_RELEASE:-<none - first release-dir deploy>}"

log "Flipping $CURRENT_LINK -> $RELEASE_DIR (atomic)"
atomic_flip_current "$RELEASE_DIR"
printf '%s\n' "$SHORT_SHA" > "$ROOT/DEPLOYED_SHA-$SLOT"
SCRAPER_RESUME_TARGET="new"

# -------------------------------------------------------- 10. restart + verify
restart_pm2() {
  local instances="${DEPLOY_WEB_INSTANCES:-2}"
  if (( DRY_RUN )); then
    # T-262F: emit the EXACT command sequence this function would run against
    # a real box, so scripts/tests/deploy-linux.test.sh can assert on it —
    # the checker that failed T-262 (#149) found that the old one-line
    # "[dry-run] would: ..." summary gave the regression suite nothing to
    # grep for, so reverting delete+start back to `pm2 reload` still passed
    # all 16 assertions. These lines are the actual command shape, not a
    # paraphrase: `pm2 delete <app>` followed by `pm2 start ... <realpath>`,
    # and they MUST NOT contain `pm2 reload` for the web app (see the
    # comment on the real branch below for why reload is wrong here).
    local release_realpath
    release_realpath="$(cd "$RELEASE_DIR" && pwd)"
    log "[dry-run] pm2 delete $PM2_WEB_APP"
    log "[dry-run] TZ=UTC pm2 start next/dist/bin/next --name $PM2_WEB_APP -i $instances -- start (cwd=$release_realpath/web, release=$release_realpath)"
    log "[dry-run] pm2 delete $PM2_SCRAPER_APP"
    log "[dry-run] TZ=UTC pm2 start tsx/dist/cli.mjs --name $PM2_SCRAPER_APP --no-autorestart --cron-restart=*/30_*_*_*_* -- src/index.ts --source=all (cwd=$release_realpath/scraper, release=$release_realpath)"
    return 0
  fi
  # T-262: delete+start, NOT `pm2 reload`, for the web app. `pm2 reload`
  # reuses the ALREADY-RUNNING process's original launch script/cwd — it
  # does not repoint a pinned script path to the NEW release directory.
  # That is exactly what produced the 2026-08-22 staging 502 chain:
  # `current-staging` flipped forward, `pm2 reload` reported success, but
  # the live process kept serving out of the OLD release directory — which
  # the next prune then deleted out from under it (the pruning-side half of
  # this fix is collect_live_release_dirs() below). Delete+start guarantees
  # the running process's script/cwd point at the release we just flipped
  # `current` to, mirroring the scraper's existing delete+start semantics.
  # T-327 P2-7: TZ=UTC explicit on every pm2 start — this is the live path;
  # ecosystem.config.js's TZ:'UTC' is dead config here (deploy-linux.sh never
  # reads it) and is retired/documented as historical, not wired.
  pm2 delete "$PM2_WEB_APP" >/dev/null 2>&1 || true
  ( cd "$RELEASE_DIR/web" && TZ=UTC pm2 start "$(resolve_bin "$RELEASE_DIR" next/dist/bin/next)" --name "$PM2_WEB_APP" \
      -i "$instances" -- start )
  # Scraper is delete+start (not reload) on every deploy — it is a one-shot
  # fork process, not a long-lived server (pm2-scheduled-one-shot-scraper.md).
  # Exact script/args mirror the existing ecosystem.config.js entry so the
  # Linux PM2 process list looks like the Windows one it is replacing.
  pm2 delete "$PM2_SCRAPER_APP" >/dev/null 2>&1 || true
  ( cd "$RELEASE_DIR/scraper" && TZ=UTC pm2 start "$(resolve_bin "$RELEASE_DIR" tsx/dist/cli.mjs)" --name "$PM2_SCRAPER_APP" \
      --no-autorestart --cron-restart="*/30 * * * *" -- src/index.ts --source=all )
  SCRAPER_RESUME_TARGET="new" # scraper is already up against the new release; resume_scraper's EXIT trap becomes a no-op re-affirmation
}

# T-327F: extracted out of the inline AUTO-ROLLBACK block below so
# scripts/tests/deploy-linux.test.sh can exercise the REAL (non-dry-run)
# rollback pm2-start command in isolation, the same way restart_pm2 and
# resume_scraper already are (case 8b/11 pattern) — a dry-run-only test
# only ever proves the "[dry-run] ..." echo string, which is a separate
# literal from the real invocation and can silently drift from it.
rollback_start_web() {
  if (( DRY_RUN )); then
    # T-262F: same reasoning as restart_pm2's dry-run branch — emit the
    # exact rollback command sequence (delete+start, never reload) so the
    # regression suite can assert on it. Without this, the rollback path
    # had ZERO command-shape coverage in --dry-run: it was previously
    # gated entirely behind `if (( ! DRY_RUN ))`, so a revert of THIS
    # branch to `pm2 reload` was invisible to every dry-run test.
    local prev_realpath
    prev_realpath="$(cd "$PREVIOUS_RELEASE" && pwd)"
    log "[dry-run] pm2 delete $PM2_WEB_APP"
    log "[dry-run] TZ=UTC pm2 start next/dist/bin/next --name $PM2_WEB_APP -i ${DEPLOY_WEB_INSTANCES:-2} -- start (cwd=$prev_realpath/web, release=$prev_realpath)"
    return 0
  fi
  # T-262: delete+start here too — same reasoning as restart_pm2's
  # primary flip path. A rollback that used `pm2 reload` would leave
  # the live process wherever it already was instead of actually
  # repointing it at PREVIOUS_RELEASE, defeating the rollback.
  # T-327 P2-7: TZ=UTC explicit here too, so a rollback never leaves the
  # web app running without an explicit process TZ.
  pm2 delete "$PM2_WEB_APP" >/dev/null 2>&1 || true
  ( cd "$PREVIOUS_RELEASE/web" && TZ=UTC pm2 start "$(resolve_bin "$PREVIOUS_RELEASE" next/dist/bin/next)" --name "$PM2_WEB_APP" \
      -i "${DEPLOY_WEB_INSTANCES:-2}" -- start ) \
    || warn "rollback: pm2 start failed for $PM2_WEB_APP against $PREVIOUS_RELEASE — investigate manually, do not assume it is running."
  pm2 save >/dev/null 2>&1 || warn "rollback: pm2 save failed — a reboot may not restore the rolled-back release."
}

verify_public_health() {
  if (( DRY_RUN )); then
    if [ "${DEPLOY_DRYRUN_VERSION_MISMATCH:-0}" = "1" ]; then
      echo "ERROR: [dry-run] simulated post-flip /api/version SHA mismatch (DEPLOY_DRYRUN_VERSION_MISMATCH=1)" >&2
      return 1
    fi
    log "[dry-run] skipping post-flip public health/version probe"
    return 0
  fi
  # T-321F (checker sibling finding): `|| true` guards this the same way
  # line ~641's flag lookup does — under `set -euo pipefail`, `grep` finding
  # no `PORT=` line (its normal state when the deploy env omits an explicit
  # port) makes the whole pipeline non-zero, which used to abort the deploy
  # here even though the next line's `${port:-3000}` proves absence was
  # always meant to fall through to the 3000 default, not crash.
  local port; port="$(grep -E '^PORT=' "$WEB_ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  local waited=0 code=000
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port:-3000}/api/health" || true)"
    [ "$code" = "200" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  if [ "$code" != "200" ]; then
    echo "ERROR: post-flip health probe failed (HTTP $code) after ${HEALTH_TIMEOUT}s." >&2
    return 1
  fi
  log "Post-flip health probe: HTTP $code"

  # T-262: HONEST PROBE. A 200 from /api/health only proves *some* process
  # is listening on the port — it does NOT prove that process is running
  # THIS release. `pm2 reload`'s stale-pin bug (see restart_pm2's comment)
  # used to let a probe like the one above pass every time even while the
  # slot silently served a stale or dead build. Cross-check /api/version's
  # build-time-baked sha (route.ts: NEXT_PUBLIC_BUILD_SHA, inlined at
  # `next build` — see web/app/api/version/route.ts) against the release we
  # just flipped to, so a stale-pin can never pass this gate again.
  local version_json served_sha
  version_json="$(curl -s "http://127.0.0.1:${port:-3000}/api/version" || true)"
  served_sha="$(node -e '
    try {
      const j = JSON.parse(process.argv[1] || "{}");
      process.stdout.write((j && j.data && j.data.sha) || "");
    } catch {
      process.stdout.write("");
    }
  ' "$version_json" 2>/dev/null || true)"
  if [ "$served_sha" != "$SHORT_SHA" ]; then
    echo "ERROR: post-flip /api/version SHA mismatch — served='$served_sha' expected='$SHORT_SHA' (stale pin, see restart_pm2's comment)." >&2
    return 1
  fi
  log "Post-flip /api/version confirmed: served sha=$served_sha matches $SHORT_SHA"
  return 0
}

assert_pm2_logrotate_installed() {
  # T-311 (#8 P3 / the 2026-06-13 disk-full-incident class): pm2-logrotate is
  # ABSENT on the Linux box today — ipodhan-scraper-out.log alone grows
  # ~1.47MB per 30-min cycle (~70MB/day; ~140MB/day across prod+staging),
  # the same unbounded-log-growth shape that took the prod DB, SSH, and the
  # runner down on 2026-06-13. This is a LOUD, NON-BLOCKING check (WARN, not
  # a deploy failure): the module must be installed once, by hand, on the
  # box (see scripts/ops/install-pm2-logrotate.sh) — T-311 does not install
  # it, and a deploy MUST NOT start hard-failing before the owner has had a
  # chance to run that one-time command. Once installed, a future task can
  # promote this to a hard gate (mirroring assert-env-keys.sh's severity).
  #
  # T-311F (checker HARD finding): `pm2 conf <module>` exits 0 REGARDLESS of
  # whether the module is installed — verified read-only on the real box
  # with the module genuinely absent: `pm2 conf pm2-logrotate >/dev/null
  # 2>&1; echo $?` printed `0` with no output, so the warn branch below could
  # never fire and the deploy log lied ("installed and configured" on a box
  # where it was not). `pm2 jlist` is pm2's own process/module inventory (the
  # same introspection `pm2_app_status()` above already uses) — an installed
  # module registers itself there by name, so grepping it actually
  # distinguishes installed vs absent.
  if (( DRY_RUN )); then
    log "[dry-run] skipping pm2-logrotate presence assert"
    return 0
  fi
  if pm2 jlist 2>/dev/null | grep -Eq '"name"[[:space:]]*:[[:space:]]*"pm2-logrotate"'; then
    log "pm2-logrotate: installed (see scripts/ops/install-pm2-logrotate.sh for the config values it applies)"
  else
    warn "pm2-logrotate module NOT installed — scraper/web logs will grow unbounded (2026-06-13 disk-full-incident class). One-time fix on the box: bash scripts/ops/install-pm2-logrotate.sh"
  fi
}

# T-311F MEDIUM: a deploy-time report line per job T-311 wired into the
# one-shot `--source=all` cycle (duplicateSweep, stageReconciler,
# primarySourceDiscovery), so the deploy log shows what is actually wired
# instead of that being a claim only checkable by reading source. Reads the
# committed tree via `git show $SHA:...` (works in both --dry-run and a real
# deploy — unlike $RELEASE_DIR, which is only a stub marker in --dry-run; see
# step 4 above) rather than a hardcoded static claim, so a future revert of
# the wiring in scraper/src/index.ts is caught here too.
report_wired_jobs() {
  local idx_content
  idx_content="$(cd "$REPO_ROOT" && git show "$SHA:scraper/src/index.ts" 2>/dev/null || true)"
  if [ -z "$idx_content" ]; then
    warn "report_wired_jobs: could not read scraper/src/index.ts at $SHORT_SHA — cannot verify job wiring"
    return 0
  fi
  # T-340 moved wiring from bare `await triggerX()` calls to
  # `runStep(cycleId, 'stepName', triggerX)` (the step-ledger wrapper) —
  # #259: this grep still looked for the old bare-call form only, so every
  # T-340-wired job reported "NOT wired" here even though it demonstrably
  # ran. Match EITHER form so the next wiring refactor doesn't silently make
  # this report lie again, and require a real call (not a comment) so a job
  # name merely mentioned in a comment/string never counts as wired.
  #
  # #264 round 2: a `runStep(...)` sitting inside a `/* */` block comment or
  # after a trailing `// ...` was still reported WIRED, because the old
  # filter only dropped lines that were ENTIRELY a `//` comment. Strip block
  # comments (delete the `/* ... */` line range) and trailing `//` comments
  # before matching. A naive `s://.*$::` would also truncate a real call
  # whose argument contains `https://` — protect any `<alnum>://` sequence
  # (http://, https://, ws://, ...) behind a placeholder first, strip the
  # real `//` comment marker, then restore the placeholder.
  #
  # #264 round 2 (LOW): T-340-wired calls are sometimes wrapped across
  # lines (`runStep(cycleId,'x',\n triggerX)`) or via an inline arrow
  # (`runStep(cycleId,'x', async () => triggerX())` — real form used by the
  # `heartbeat` step at index.ts:434). Collapse newlines to spaces so a
  # wrapped call reads as one statement, and match the call name anywhere
  # up to the statement's closing `;` (`[^;]*?`, non-greedy) instead of
  # requiring it immediately after the job name — this also tolerates the
  # nested `()` an arrow wrapper introduces.
  local non_comment_content
  non_comment_content="$(printf '%s\n' "$idx_content" \
    | sed -E '/\/\*/,/\*\//d' \
    | sed -E '/^[[:space:]]*\/\//d' \
    | sed -E 's#([[:alnum:]_])://#\1@@CS@@#g; s#//.*$##; s#@@CS@@#://#g' \
    | tr '\n' ' ')"
  local entry job rest call flag flag_val
  for entry in "duplicateSweep:triggerDuplicateSweep:" "stageReconciler:triggerStageReconciler:ENABLE_STAGE_RECONCILER" "primarySourceDiscovery:triggerPrimarySourceDiscovery:ENABLE_PRIMARY_SOURCE_DISCOVERY"; do
    job="${entry%%:*}"
    rest="${entry#*:}"
    call="${rest%%:*}"
    flag="${rest#*:}"
    if printf '%s' "$non_comment_content" | grep -Pq "runStep\\([^;]*?,[[:space:]]*'${job}'[[:space:]]*,[^;]*?${call}[^;]*?\\)[^;]*?;|await[[:space:]]+${call}\\(\\)"; then
      if [ -n "$flag" ]; then
        flag_val="unset"
        if (( ! DRY_RUN )); then
          # T-321: a §GATE'd flag (e.g. ENABLE_STAGE_RECONCILER) is routinely
          # ABSENT from both env files entirely — that is its normal "off"
          # state (owner-gated-feature-flags.md), not an error. Under
          # `set -euo pipefail`, `grep` finding zero matches exits 1, and
          # pipefail propagates that through `tail`/`cut` to the whole
          # pipeline; assigning a failing command substitution to a variable
          # is checked by `set -e`, so the ENTIRE DEPLOY exited immediately
          # here with NO error message the moment a flag was legitimately
          # unset — the exact silent-exit-1 this informational report line
          # must never cause. `|| true` makes "flag not found" the expected,
          # non-fatal outcome this report already handles via the blank-value
          # fallback on the next line.
          flag_val="$(grep "^${flag}=" "$SCRAPER_ENV_FILE" "$WEB_ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
          [ -n "$flag_val" ] || flag_val="unset"
        fi
        log "job wired: $job (${call}(), flag ${flag}=${flag_val})"
      else
        log "job wired: $job (${call}(), always-on/cadence-gated)"
      fi
    else
      warn "job NOT wired: $job — expected \"runStep(cycleId, '${job}', ${call})\" or 'await ${call}()' in scraper/src/index.ts at $SHORT_SHA"
    fi
  done
}

log "Restarting PM2 apps"
restart_pm2
assert_pm2_logrotate_installed
report_wired_jobs

if ! verify_public_health; then
  echo "ERROR: post-flip verification failed for $RELEASE_NAME." >&2
  if [ -n "$PREVIOUS_RELEASE" ]; then
    log "AUTO-ROLLBACK to $PREVIOUS_RELEASE"
    atomic_flip_current "$PREVIOUS_RELEASE"
    basename "$PREVIOUS_RELEASE" | sed 's/^[0-9]*-[0-9]*-//' > "$ROOT/DEPLOYED_SHA-$SLOT"
    SCRAPER_RESUME_TARGET="prev"
    rollback_start_web
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

# ------------------------------------------------------------------- 12. prune
# T-243: persist the process list so a reboot resurrects THIS release. Without
# it, `pm2 resurrect` restores whatever list was last saved - on a fresh box
# that meant the IPODhan apps were absent entirely, and after any deploy it
# would mean pm2 restarting an older, possibly pruned, release directory.
if (( DRY_RUN )); then
  log "[dry-run] would run pm2 save"
else
  pm2 save >/dev/null 2>&1 || warn "pm2 save failed - a reboot may not restore this release."
  log "pm2 process list saved (boot-restore points at $RELEASE_NAME)"
fi

# T-262: pruning must never delete a release that is still LIVE somewhere —
# not just "this slot's `current`". A release stays live if (a) ANY slot's
# `current`/`current-<slot>` link still points at it, or (b) a running
# `ipodhan-*` pm2 process's actual cwd is still inside it. (b) is what the
# 2026-08-22 staging 502 chain hit: `current-staging` had already flipped
# forward, but the live process — left pinned to the old release by
# `pm2 reload`'s stale-pin bug (see restart_pm2's comment) — was still
# serving out of a directory that no longer matched `current`, and prune
# deleted it out from under the live process because it only ever checked
# `current`. restart_pm2 is now delete+start (fixing (b) going forward),
# but this check stays as defense in depth against ANY other way a live
# process's cwd could drift from the current-link.
collect_live_release_dirs() {
  local link target
  for link in "$ROOT"/current "$ROOT"/current-*; do
    [ -L "$link" ] || [ -f "$link" ] || continue
    target="$(resolve_link_target "$link")"
    [ -n "$target" ] && printf '%s\n' "$target"
  done

  if (( DRY_RUN )); then
    if [ -n "${DEPLOY_DRYRUN_PM2_RELEASE_DIRS:-}" ]; then
      local d
      local IFS=':'
      for d in $DEPLOY_DRYRUN_PM2_RELEASE_DIRS; do
        printf '%s\n' "$d"
      done
    fi
    return 0
  fi

  pm2 jlist 2>/dev/null | node -e '
    const apps = JSON.parse(require("fs").readFileSync(0, "utf8"));
    for (const a of apps) {
      const name = a && a.name;
      const cwd = a && a.pm2_env && a.pm2_env.pm_cwd;
      if (name && cwd && name.indexOf("ipodhan-") === 0) {
        process.stdout.write(cwd + "\n");
      }
    }
  ' 2>/dev/null | while IFS= read -r cwd; do
    if [ -n "$cwd" ]; then
      dirname "$cwd"
    fi
  done || true
}

log "Pruning old releases (keeping the newest $KEEP_RELEASES)"
CUR="$(read_current_link || true)"
mapfile -t LIVE_REFS < <(collect_live_release_dirs)
if [ -d "$RELEASES_DIR" ]; then
  # shellcheck disable=SC2012  # release dir names are timestamp_sha, plain alphanumeric — ls is safe
  TOTAL="$(cd "$RELEASES_DIR" && ls -1 | LC_ALL=C sort | wc -l)"
  if [ "$TOTAL" -gt "$KEEP_RELEASES" ]; then
    cd "$RELEASES_DIR"
    # shellcheck disable=SC2012  # release dir names are timestamp_sha, plain alphanumeric — ls is safe
    ls -1 | LC_ALL=C sort | head -n "$((TOTAL - KEEP_RELEASES))" | while IFS= read -r old; do
      old_path="$RELEASES_DIR/$old"
      if [ "$old_path" = "$CUR" ]; then
        log "keeping $old (it is 'current')"
        continue
      fi
      referenced=0
      for ref in "${LIVE_REFS[@]}"; do
        [ -n "$ref" ] || continue
        if [ "$ref" = "$old_path" ]; then
          referenced=1
          break
        fi
      done
      if [ "$referenced" -eq 1 ]; then
        log "keeping $old (still referenced by a live current-link or pm2 process — T-262 slot-safe prune)"
        continue
      fi
      log "removing $old"
      rm -rf "${RELEASES_DIR:?}/${old:?}"
    done
    cd "$REPO_ROOT"
  fi
fi

log "Deploy complete: $SHORT_SHA is live via $CURRENT_LINK -> $RELEASE_DIR"
