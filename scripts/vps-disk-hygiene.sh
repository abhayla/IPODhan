#!/usr/bin/env bash
# W-134 — standing weekly VPS disk-hygiene mechanism.
#
# WHY (2026-09-04 measurement): 11 release folders of ~3 GB each (34 GB), a
# stale 3.1 GB build dir, and 0.7 GB of journal took the 96 GB VPS disk to
# 74%; a manual sweep brought it to 55%. deploy-linux.sh's own prune only
# runs at the end of a deploy, for the slot just deployed — nothing prunes
# the OTHER slot, or npm/pip caches, or /tmp, or stray venv build dirs, on a
# week with no deploy. This script is that missing weekly sweep.
#
# Runs as root from cron (see docs/ops/vps-disk-hygiene.md), idempotent —
# safe to run any time, any number of times.
#
# Usage:
#   scripts/vps-disk-hygiene.sh              # run the full sweep
#   scripts/vps-disk-hygiene.sh --dry-run    # print what would be removed, delete nothing, exit 0
#   scripts/vps-disk-hygiene.sh --report     # print only the final report (no deletions)
#
# Env overrides:
#   HYGIENE_ROOT           deploy root (default /var/www/ipodhan) — releases*/ live under this
#   HYGIENE_KEEP_PROD       release count to keep for the prod slot (default 3)
#   HYGIENE_KEEP_STAGING    release count to keep for the staging slot (default 2)
#   HYGIENE_SKIP_SYSTEM     when set (any value), skip journalctl/npm/pip/apt/Notifier steps —
#                           used by the test suite so it never touches the real machine.
#                           Does NOT skip the /tmp sweep — see HYGIENE_SKIP_TMP.
#   HYGIENE_SKIP_TMP        when set (any value), skip the /tmp sweep step (round 3, MAJOR-1) —
#                           separate flag so a test case can exercise ONLY the /tmp sweep
#                           without also running journalctl/npm/pip/apt/Notifier for real.
#   HYGIENE_SKIP_ORPHANS    when set (any value), skip the orphaned release-server sweep (W-136)
#   HYGIENE_ORPHAN_ROOTS    space-separated glob prefixes a process's cwd must be under to be
#                           considered an orphaned release server (default: $ROOT/releases and
#                           $ROOT/releases-staging) — env-overridable for the test suite.
#   HYGIENE_NOTIFIER_URL    Notifier endpoint (default http://127.0.0.1:3300/notify) — the test
#                           suite points this at an unroutable address as a second independent
#                           guard, in case HYGIENE_SKIP_SYSTEM is ever dropped by a future edit.
#   NOTIFIER_ENV            path to the Notifier .env (default /root/notifier/.env)
#   NOTIFIER_KEY_IPODHAN    Notifier API key — sourced from NOTIFIER_ENV or GLOBAL.env; if unset
#                           the Notifier POST is skipped (logged, non-fatal)

set -euo pipefail

MODE="run"
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --report) MODE="report" ;;
    *) echo "FATAL: unknown argument '$arg' (expected --dry-run or --report)" >&2; exit 2 ;;
  esac
done

ROOT="${HYGIENE_ROOT:-/var/www/ipodhan}"
# MINOR-4 (round 3): strip a trailing slash only. A separate `pwd -P`
# canonicalisation of ROOT used to live here; it was dead weight — the
# safe_rm_release_dir() prefix guard is self-consistent because every
# candidate path is built from this SAME $ROOT variable, and the 'current'
# comparison in prune_slot() is independently canonicalised on BOTH sides
# via `readlink -f` regardless of whether ROOT itself was resolved. Removing
# it left the suite green (including case j, ROOT reached via a symlink),
# confirming readlink -f was already doing the real work.
ROOT="${ROOT%/}"
KEEP_PROD="${HYGIENE_KEEP_PROD:-3}"
KEEP_STAGING="${HYGIENE_KEEP_STAGING:-2}"
NOTIFIER_ENV="${NOTIFIER_ENV:-/root/notifier/.env}"
GLOBAL_ENV="${HYGIENE_GLOBAL_ENV:-/root/Abhay/GLOBAL.env}"

FREED_KB=0
REPORT_LINES=()

log() { [ "$MODE" = "report" ] && return 0; echo "[$(date -Iseconds)] $*"; }
report() { REPORT_LINES+=("$*"); }

# C1: the ONE predicate every destructive step routes through. --report and
# --dry-run must never delete anything and never POST to the Notifier.
may_delete() { [ "$MODE" = "run" ]; }

# MINOR(c): single-flight lock — a second concurrent run (cron overlap, a
# manual invocation) skips cleanly instead of racing the first. mkdir is
# atomic, so this needs no flock(1) dependency. HYGIENE_LOCK_DIR lets the
# test suite point this at a throwaway dir.
LOCK_DIR="${HYGIENE_LOCK_DIR:-/var/lock/ipodhan-disk-hygiene.lock.d}"
LOCK_STALE_MIN="${HYGIENE_LOCK_STALE_MIN:-360}"  # MEDIUM-2: 6 hours

# MEDIUM-2: a run killed by SIGTERM/SIGKILL/OOM must not wedge the mechanism
# forever — every later weekly run would exit 0 silently with no Notifier.
# The lock dir now carries the holder's PID; a contender reclaims the lock
# when that PID is no longer alive, or the lock dir is older than 6 hours
# regardless of PID liveness (covers PID reuse). trap fires on INT/TERM/HUP
# too, not just a clean EXIT.
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid" 2>/dev/null || true
    trap 'rm -f "$LOCK_DIR/pid" 2>/dev/null; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM HUP
    return 0
  fi
  return 1
}

if [ -z "${HYGIENE_SOURCED:-}" ]; then
  if ! acquire_lock; then
    if [ -d "$LOCK_DIR" ]; then
      HELD_PID=""
      [ -f "$LOCK_DIR/pid" ] && HELD_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
      PID_ALIVE=0
      if [ -n "$HELD_PID" ] && kill -0 "$HELD_PID" 2>/dev/null; then
        PID_ALIVE=1
      fi
      LOCK_OLD=0
      if find "$LOCK_DIR" -maxdepth 0 -mmin "+$LOCK_STALE_MIN" 2>/dev/null | grep -q .; then
        LOCK_OLD=1
      fi
      if [ "$PID_ALIVE" -eq 1 ] && [ "$LOCK_OLD" -eq 0 ]; then
        log "another disk-hygiene run holds the lock ($LOCK_DIR, pid=$HELD_PID alive) — exiting"
        exit 0
      fi
      log "WARN: reclaiming stale lock $LOCK_DIR (pid=${HELD_PID:-unknown}, alive=$PID_ALIVE, age>${LOCK_STALE_MIN}min=$LOCK_OLD)"
      rm -rf "$LOCK_DIR" 2>/dev/null || true
      if ! acquire_lock; then
        log "another disk-hygiene run holds the lock ($LOCK_DIR) — exiting"
        exit 0
      fi
    else
      # mkdir failed for any other reason (missing parent, permissions) — the
      # lock path itself is unusable on this host. Fail OPEN: a hygiene sweep
      # that never runs is worse than one run without the concurrency guard.
      log "WARN: could not create lock dir $LOCK_DIR — continuing without a lock (non-fatal)"
    fi
  fi
fi

# MINOR(c): skip the release prune while a deploy is running, so hygiene
# never prunes a release deploy-linux.sh is mid-copy into. HYGIENE_DEPLOY_CHECK_CMD
# is an env-overridable hook (used by the test suite, which has neither
# pgrep nor /proc guaranteed); HYGIENE_DEPLOY_PGREP is the real-machine
# pattern used when pgrep is available.
#
# Round 4 (2026-09-04): the pattern used to be the bare substring
# "scripts/deploy-linux.sh", which matches ANY command line that merely
# MENTIONS the script — including a `bash -n scripts/deploy-linux.sh`
# syntax check, or `less`/`grep` on the file. It matched an ancestor of this
# very test run (a compound shell whose own command line contained a `bash
# -n scripts/deploy-linux.sh ...` check) and caused hygiene to silently skip
# every prune. deploy-linux.yml always invokes as
# `bash scripts/deploy-linux.sh <staging|prod> [ref]` — require that exact
# shape (script path immediately followed by the slot word) so a bare
# mention of the filename never matches.
DEPLOY_PGREP_PATTERN="${HYGIENE_DEPLOY_PGREP:-scripts/deploy-linux\.sh[[:space:]]+(staging|prod)}"

# Round 4: a process-command-line check must never match its own process or
# any of its ancestors (the harness invoking THIS script may itself have
# "scripts/deploy-linux.sh" in its command line, e.g. a preceding `bash -n`
# check) — print self PID + every ancestor PID up to and including init, so
# deploy_in_progress() can exclude them from any pgrep/proc match.
self_and_ancestor_pids() {
  local pid="$$" out=" $$ " ppid guard=0
  while [ "$pid" -gt 1 ] && [ "$guard" -lt 100 ]; do
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')"
    case "$ppid" in
      ''|*[!0-9]*) break ;;
    esac
    [ "$ppid" = "$pid" ] && break
    out="$out$ppid "
    pid="$ppid"
    guard=$((guard + 1))
  done
  printf '%s' "$out"
}

deploy_in_progress() {
  if [ -n "${HYGIENE_DEPLOY_CHECK_CMD:-}" ]; then
    eval "$HYGIENE_DEPLOY_CHECK_CMD"
    return $?
  fi
  local exclude
  exclude="$(self_and_ancestor_pids)"
  if command -v pgrep >/dev/null 2>&1; then
    local pids candidate
    pids="$(pgrep -f "$DEPLOY_PGREP_PATTERN" 2>/dev/null || true)"
    for candidate in $pids; do
      case "$exclude" in
        *" $candidate "*) continue ;;
      esac
      return 0
    done
    return 1
  fi
  if [ -d /proc ]; then
    local cmdline p pid
    for p in /proc/[0-9]*/cmdline; do
      [ -r "$p" ] || continue
      pid="$(basename "$(dirname "$p")")"
      case "$exclude" in
        *" $pid "*) continue ;;
      esac
      cmdline="$(tr '\0' ' ' < "$p" 2>/dev/null || true)"
      if printf '%s' "$cmdline" | grep -qE "$DEPLOY_PGREP_PATTERN" 2>/dev/null; then
        return 0
      fi
    done
  fi
  return 1
}

# --- release-dir name + path safety guards ----------------------------------
# Mirrors deploy-linux.sh's safe_rm_venv_dir(): every deletion goes through a
# guard that (a) refuses '..' outright and (b) refuses anything outside the
# one allowed root, before rm -rf ever runs.
RELEASE_NAME_RE='^[0-9]{8}-[0-9]{6}-[0-9a-f]{7,40}$'

safe_rm_release_dir() {
  local dir="$1" base
  case "$dir" in
    "") echo "FATAL: safe_rm_release_dir: refusing an empty path" >&2; return 1 ;;
    */) echo "FATAL: safe_rm_release_dir: refusing '$dir' — trailing slash not allowed" >&2; return 1 ;;
  esac
  base="$(basename "$dir")"
  case "$dir" in
    *..*) echo "FATAL: safe_rm_release_dir: refusing '$dir' — contains '..'" >&2; return 1 ;;
    "$ROOT"/releases/*|"$ROOT"/releases-*/*) ;;
    *) echo "FATAL: safe_rm_release_dir: refusing '$dir' — not under $ROOT/releases*/" >&2; return 1 ;;
  esac
  if ! [[ "$base" =~ $RELEASE_NAME_RE ]]; then
    echo "FATAL: safe_rm_release_dir: refusing '$dir' — name '$base' does not match $RELEASE_NAME_RE" >&2
    return 1
  fi
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then
    return 0
  fi
  if ! may_delete; then
    [ "$MODE" = "dry-run" ] && log "DRY-RUN: would remove release dir $dir"
    return 0
  fi
  log "removing release dir $dir"
  rm -rf -- "${dir:?}"
}

safe_rm_venv_build_dir() {
  local dir="$1"
  case "$dir" in
    *..*) echo "FATAL: safe_rm_venv_build_dir: refusing '$dir' — contains '..'" >&2; return 1 ;;
    "$ROOT"/shared/venv/*.new|"$ROOT"/shared/venv/*.old) ;;
    *) echo "FATAL: safe_rm_venv_build_dir: refusing '$dir' — not a *.new/*.old under $ROOT/shared/venv/" >&2; return 1 ;;
  esac
  if [ -z "$dir" ] || [ ! -e "$dir" ]; then
    return 0
  fi
  if ! may_delete; then
    [ "$MODE" = "dry-run" ] && log "DRY-RUN: would remove stale venv build dir $dir"
    return 0
  fi
  log "removing stale venv build dir $dir"
  rm -rf -- "${dir:?}"
}

# MINOR(b): a du failure (permission, race) must never leave dir_kb emitting
# an empty string — under set -e, `[ "" -gt N ]` aborts the whole script.
dir_kb() {
  local dir="$1" kb
  [ -e "$dir" ] || { echo 0; return; }
  kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"
  [ -n "$kb" ] || kb=0
  echo "$kb"
}

current_target() {
  local link="$1"
  if [ -L "$link" ]; then
    readlink -f "$link" 2>/dev/null || readlink "$link"
  elif [ -f "$link" ]; then
    cat "$link"
  fi
}

# W-136: a probe/app server started against a release dir that was later
# deleted (an aborted deploy, a manual prune) can be orphaned and keep
# running — connected to prod DB, bound to a port, regenerating ISR pages
# into a directory that officially no longer exists (the 2026-08-21
# incident: a next-server ran for 14 days after its release dir was
# deleted). HYGIENE_ORPHAN_ROOTS is a space-separated list of glob prefixes
# a process's cwd must be under to be considered — env-overridable so the
# test suite can point it at a throwaway dir instead of the real $ROOT.
ORPHAN_ROOTS="${HYGIENE_ORPHAN_ROOTS:-$ROOT/releases $ROOT/releases-staging}"

# Prints "<pid> <cwd>" (one per line) for every process whose cwd resolves
# under one of $ORPHAN_ROOTS AND is either marked "(deleted)" by the kernel
# or no longer exists on disk, AND whose cmdline matches a release-server
# process (next-server / next start / npm run start). Never runs on a host
# with no /proc (e.g. this Windows dev box) — the caller checks that too,
# but the guard is repeated here so the function is safe to call directly.
detect_orphaned_release_servers() {
  [ -d /proc ] || return 0
  local p pid cwd_link cwd_target cwd_clean cmdline root match deleted
  for p in /proc/[0-9]*; do
    pid="$(basename "$p")"
    [ "$pid" = "$$" ] && continue
    cwd_link="$p/cwd"
    [ -L "$cwd_link" ] || continue
    cwd_target="$(readlink "$cwd_link" 2>/dev/null || true)"
    [ -n "$cwd_target" ] || continue
    deleted=0
    case "$cwd_target" in
      *" (deleted)") deleted=1; cwd_clean="${cwd_target% (deleted)}" ;;
      *) cwd_clean="$cwd_target" ;;
    esac
    [ -d "$cwd_clean" ] || deleted=1
    [ "$deleted" -eq 1 ] || continue
    match=0
    for root in $ORPHAN_ROOTS; do
      case "$cwd_clean" in
        "$root"/*|"$root") match=1; break ;;
      esac
    done
    [ "$match" -eq 1 ] || continue
    cmdline="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null || true)"
    if printf '%s' "$cmdline" | grep -qE 'next-server|next[[:space:]]+start|npm run start'; then
      printf '%s %s\n' "$pid" "$cwd_clean"
    fi
  done
}

# --- 1. prune releases beyond retention, both slots -------------------------
prune_slot() {
  local slot="$1" keep="$2" releases_dir current_link cur_raw cur total
  if [ "$slot" = "prod" ]; then
    releases_dir="$ROOT/releases"
    current_link="$ROOT/current"
  else
    releases_dir="$ROOT/releases-$slot"
    current_link="$ROOT/current-$slot"
  fi

  [ -d "$releases_dir" ] || { log "no releases dir for slot '$slot' — skipping"; return 0; }

  # C2: resolve 'current' to its CANONICAL path (readlink -f); old_canon
  # below is resolved the same way, so a trailing slash or a symlink
  # component can never desync the comparison — this canonicalisation is
  # independent of whatever form $ROOT itself was given in (MINOR-4). If
  # 'current' cannot be resolved at all (missing link, dangling target),
  # skip this slot outright rather than risk pruning blind.
  cur_raw="$(current_target "$current_link" 2>/dev/null || true)"
  cur=""
  if [ -n "$cur_raw" ]; then
    cur="$(readlink -f "$cur_raw" 2>/dev/null || true)"
  fi
  if [ -z "$cur" ]; then
    log "WARN: slot '$slot': could not resolve a 'current' target at $current_link — skipping prune to avoid pruning blind"
    return 0
  fi

  # M1: build the candidate list from REAL directories matching the release
  # name pattern ONLY — a stray junk entry (a stray file, an unrelated dir)
  # must never inflate the count and cause a real release to be pruned early.
  local candidates=() d base
  shopt -s nullglob
  for d in "$releases_dir"/*; do
    [ -d "$d" ] || continue
    [ -L "$d" ] && continue
    base="$(basename "$d")"
    [[ "$base" =~ $RELEASE_NAME_RE ]] && candidates+=("$base")
  done
  shopt -u nullglob
  if [ "${#candidates[@]}" -gt 1 ]; then
    IFS=$'\n' candidates=($(printf '%s\n' "${candidates[@]}" | LC_ALL=C sort))
    unset IFS
  fi
  total="${#candidates[@]}"
  if [ "$total" -le "$keep" ]; then
    log "slot '$slot': $total real release(s) <= keep=$keep, nothing to prune"
    return 0
  fi

  local to_remove=$((total - keep)) i old old_path old_canon before after
  for ((i = 0; i < to_remove; i++)); do
    old="${candidates[$i]}"
    old_path="$releases_dir/$old"
    old_canon="$(readlink -f "$old_path" 2>/dev/null || echo "$old_path")"
    if [ "$old_canon" = "$cur" ] || [ "$(basename "$old_canon")" = "$(basename "$cur")" ]; then
      log "slot '$slot': keeping $old (it is 'current')"
      continue
    fi
    # M2: a plain (non-subshell) for-loop, so FREED_KB actually accumulates
    # across iterations — the prior `| while read` piped this into a subshell
    # where every increment was discarded.
    before="$(dir_kb "$old_path")"
    safe_rm_release_dir "$old_path"
    if may_delete; then
      after="$(dir_kb "$old_path")"
      FREED_KB=$((FREED_KB + (before - after)))
    fi
  done
}

# M3: when sourced (HYGIENE_SOURCED=1), every function above is now defined
# and available to call directly (e.g. safe_rm_release_dir) — stop here
# instead of running the sweep, taking the lock, or touching the filesystem.
if [ -n "${HYGIENE_SOURCED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

log "=== W-134 disk hygiene: $(date -Iseconds) mode=$MODE root=$ROOT ==="
if deploy_in_progress; then
  log "deploy in progress (matched '$DEPLOY_PGREP_PATTERN') — release prune skipped this run"
  report "release prune skipped: deploy in progress"
else
  prune_slot prod "$KEEP_PROD"
  prune_slot staging "$KEEP_STAGING"
fi

# --- 2. journal vacuum -------------------------------------------------------
if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ]; then
  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would run journalctl --vacuum-size=200M"
  elif may_delete && command -v journalctl >/dev/null 2>&1; then
    log "vacuuming journal to 200M"
    journalctl --vacuum-size=200M >/dev/null 2>&1 || log "WARN: journalctl vacuum failed (non-fatal)"
  fi
else
  log "HYGIENE_SKIP_SYSTEM set — skipping journalctl"
fi

# --- 3. npm / pip / apt caches -----------------------------------------------
NPM_CACHE_DIR="${HYGIENE_NPM_CACHE:-/root/.npm}"
PIP_CACHE_DIR="${HYGIENE_PIP_CACHE:-$HOME/.cache/pip}"

if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ]; then
  NPM_KB="$(dir_kb "$NPM_CACHE_DIR")"
  if [ "$NPM_KB" -gt $((2 * 1024 * 1024)) ]; then
    if [ "$MODE" = "dry-run" ]; then
      log "DRY-RUN: would run npm cache clean --force (npm cache is ${NPM_KB}KB, over 2GB)"
    elif may_delete && command -v npm >/dev/null 2>&1; then
      log "npm cache is ${NPM_KB}KB (over 2GB) — running npm cache clean --force"
      npm cache clean --force >/dev/null 2>&1 || log "WARN: npm cache clean failed (non-fatal)"
      FREED_KB=$((FREED_KB + NPM_KB - $(dir_kb "$NPM_CACHE_DIR")))
    fi
  else
    log "npm cache is ${NPM_KB}KB — under the 2GB threshold, left alone"
  fi

  PIP_KB="$(dir_kb "$PIP_CACHE_DIR")"
  if [ "$PIP_KB" -gt $((500 * 1024)) ]; then
    if [ "$MODE" = "dry-run" ]; then
      log "DRY-RUN: would run pip cache purge (pip cache is ${PIP_KB}KB, over 500MB)"
    elif may_delete && command -v python3 >/dev/null 2>&1; then
      log "pip cache is ${PIP_KB}KB (over 500MB) — running pip cache purge"
      python3 -m pip cache purge >/dev/null 2>&1 || log "WARN: pip cache purge failed (non-fatal)"
      FREED_KB=$((FREED_KB + PIP_KB - $(dir_kb "$PIP_CACHE_DIR")))
    fi
  else
    log "pip cache is ${PIP_KB}KB — under the 500MB threshold, left alone"
  fi

  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would run apt-get clean"
  elif may_delete && command -v apt-get >/dev/null 2>&1; then
    log "running apt-get clean"
    apt-get clean >/dev/null 2>&1 || log "WARN: apt-get clean failed (non-fatal)"
  fi
else
  log "HYGIENE_SKIP_SYSTEM set — skipping npm/pip/apt cache steps"
fi

# --- 4. stale /tmp files (7+ days), never directories ------------------------
# HYGIENE_TMP_DIR lets the test suite point this at a throwaway dir instead
# of the real /tmp; HYGIENE_SKIP_SYSTEM also skips this step outright so a
# test run never touches the real machine's /tmp.
TMP_SWEEP_DIR="${HYGIENE_TMP_DIR:-/tmp}"
# MINOR(a): never walk into dirs that are themselves live application state —
# a running Puppeteer/Chrome profile, systemd's private tmpfs, a tsx/
# node-compile-cache dir — even when a file inside happens to be 7+ days old.
TMP_PRUNE_EXPR=(
  -type d \( -name 'puppeteer_dev_chrome_profile-*' -o -name '.org.chromium.*' \
             -o -name 'systemd-private-*' -o -name 'tsx-*' -o -name 'node-compile-cache' \) -prune
  -o -type f -mtime +7
)
if [ -n "${HYGIENE_SKIP_TMP:-}" ]; then
  log "HYGIENE_SKIP_TMP set — skipping /tmp sweep"
elif [ "$MODE" = "dry-run" ]; then
  log "DRY-RUN: would delete files older than 7 days under $TMP_SWEEP_DIR (excluding known-safe dirs)"
  find "$TMP_SWEEP_DIR" -xdev "${TMP_PRUNE_EXPR[@]}" -print0 2>/dev/null | while IFS= read -r -d '' f; do log "DRY-RUN: would remove $f"; done || true
elif may_delete; then
  log "deleting files older than 7 days under $TMP_SWEEP_DIR (excluding known-safe dirs)"
  # NOTE: -delete cannot combine with -prune (find refuses — -delete forces
  # -depth, which silently disables -prune) so this deletes via an explicit
  # rm loop over -print0 instead of `find ... -delete`.
  find "$TMP_SWEEP_DIR" -xdev "${TMP_PRUNE_EXPR[@]}" -print0 2>/dev/null | while IFS= read -r -d '' f; do rm -f -- "$f" 2>/dev/null || true; done
fi

# --- 5. stale venv build dirs (*.new / *.old older than 1 day) --------------
VENV_DIR="$ROOT/shared/venv"
if [ -d "$VENV_DIR" ]; then
  for pattern in '*.new' '*.old'; do
    find "$VENV_DIR" -maxdepth 1 -mindepth 1 -name "$pattern" -mtime +1 2>/dev/null | while IFS= read -r d; do
      safe_rm_venv_build_dir "$d"
    done
  done
else
  log "no venv dir at $VENV_DIR — skipping stale venv build-dir sweep"
fi

# --- 6. orphaned release servers (W-136, Linux only) -------------------------
ORPHAN_COUNT=0
if [ -n "${HYGIENE_SKIP_ORPHANS:-}" ]; then
  log "HYGIENE_SKIP_ORPHANS set — skipping orphaned release-server sweep"
elif [ ! -d /proc ]; then
  log "no /proc on this host — skipping orphaned release-server sweep"
elif deploy_in_progress; then
  # MAJOR-2 (round 2): the deploy-in-progress guard previously covered only
  # prune_slot — during `pm2 delete` -> `pm2 start` in a live deploy a
  # transitional server could false-match the orphan sweep. Reuse the same
  # guard the release prune uses so the sweep never runs mid-deploy either.
  log "deploy in progress (matched '$DEPLOY_PGREP_PATTERN') — orphaned release-server sweep skipped this run"
  report "orphan sweep skipped: deploy in progress"
else
  while IFS=' ' read -r opid ocwd; do
    [ -n "$opid" ] || continue
    ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
    OAGE="$(ps -o etime= -p "$opid" 2>/dev/null | tr -d ' ' || true)"
    log "orphaned release server: pid=$opid cwd=$ocwd age=${OAGE:-unknown}"
    if [ "$MODE" = "dry-run" ]; then
      log "DRY-RUN: would evaluate process-group / pm2 ownership for pid=$opid (cwd=$ocwd) before killing"
      report "orphaned release server (would kill): pid=$opid cwd=$ocwd age=${OAGE:-unknown}"
    elif may_delete; then
      # Round 2 hardening: `set -o pipefail` makes a `ps -o ...` failure
      # (unsupported flag on some ps builds, or the process having exited
      # mid-sweep) abort the WHOLE script here without `|| true` — mirrors
      # the OAGE lookup above and dir_kb()'s MINOR(b) guard elsewhere.
      OPGID="$(ps -o pgid= -p "$opid" 2>/dev/null | tr -d ' ' || true)"
      OPPID="$(ps -o ppid= -p "$opid" 2>/dev/null | tr -d ' ' || true)"

      # MINOR(b): never treat an empty/invalid/1 pgid as a signalable
      # group — a negative-1 or empty target can signal far more than
      # intended. Only a TRUE group leader (pgid == pid, the setsid'd
      # probe shape) is safe to group-kill; everything else is a
      # single-pid kill.
      IS_LEADER=0
      case "$OPGID" in
        ''|*[!0-9]*|1) : ;;
        *) if [ "$OPGID" = "$opid" ]; then IS_LEADER=1; fi ;;
      esac

      # MAJOR-1: MEASURED on the VPS — the PM2 God Daemon and every
      # next-server worker it manages (ipodhan-web x2, ipodhan-scraper,
      # notifier, firekaro-api) share ONE process group (the daemon's).
      # Group-killing that pgid would take down pm2 and every app it
      # manages, not just the orphan. Refuse to signal a process group (or
      # a single pid) whose group leader's or direct parent's cmdline
      # names pm2/PM2 — pm2 owns its children; this sweep only reaps true
      # orphans (ppid 1 / systemd-reparented), never a pm2-managed one.
      LEADER_CMD=""
      case "$OPGID" in
        ''|*[!0-9]*|1) : ;;
        *) LEADER_CMD="$(ps -o cmd= -p "$OPGID" 2>/dev/null || true)" ;;
      esac
      PARENT_CMD=""
      case "$OPPID" in
        ''|*[!0-9]*|1) : ;;
        *) PARENT_CMD="$(ps -o cmd= -p "$OPPID" 2>/dev/null || true)" ;;
      esac

      if printf '%s\n%s' "$LEADER_CMD" "$PARENT_CMD" | grep -qiE 'pm2'; then
        log "WARN: pid=$opid cwd=$ocwd is pm2-managed (leader/parent cmdline matches pm2) — left to pm2, NOT killed"
        report "orphaned release server left to pm2 (pm2-managed, not killed): pid=$opid cwd=$ocwd"
      else
        # MAJOR-3: TERM, wait up to 5s (poll kill -0), escalate to KILL,
        # then VERIFY before ever reporting "killed" — never report success
        # before the kill lands or regardless of outcome.
        if [ "$IS_LEADER" -eq 1 ]; then
          kill -TERM -- -"$OPGID" 2>/dev/null || true
        else
          kill -TERM "$opid" 2>/dev/null || true
        fi
        KILLED=0
        WAITED=0
        while [ "$WAITED" -lt 5 ]; do
          kill -0 "$opid" 2>/dev/null || { KILLED=1; break; }
          sleep 1
          WAITED=$((WAITED + 1))
        done
        if [ "$KILLED" -eq 0 ]; then
          if [ "$IS_LEADER" -eq 1 ]; then
            kill -KILL -- -"$OPGID" 2>/dev/null || true
          else
            kill -KILL "$opid" 2>/dev/null || true
          fi
          sleep 1
          kill -0 "$opid" 2>/dev/null || KILLED=1
        fi
        if [ "$KILLED" -eq 1 ]; then
          log "orphaned release server killed: pid=$opid cwd=$ocwd age=${OAGE:-unknown}"
          report "orphaned release server killed: pid=$opid cwd=$ocwd age=${OAGE:-unknown}"
        else
          log "WARN: orphaned release server SURVIVED cleanup: pid=$opid cwd=$ocwd"
          report "orphaned release server SURVIVED pid $opid cwd=$ocwd"
        fi
      fi
    fi
  done < <(detect_orphaned_release_servers)
  if [ "$ORPHAN_COUNT" -eq 0 ]; then
    log "no orphaned release servers found"
  fi
fi

# --- 7. final report ----------------------------------------------------------
DISK_LINE="$(df -k "$ROOT" 2>/dev/null | tail -n1 || true)"
USED_PCT="unknown"
FREE_GB="unknown"
if [ -n "$DISK_LINE" ]; then
  USED_PCT="$(echo "$DISK_LINE" | awk '{print $5}')"
  FREE_KB_DF="$(echo "$DISK_LINE" | awk '{print $4}')"
  if [ -n "${FREE_KB_DF:-}" ]; then
    FREE_GB="$(awk -v kb="$FREE_KB_DF" 'BEGIN{printf "%.1f", kb/1024/1024}')"
  fi
fi

# MEDIUM-3: count only REAL release dirs (matching RELEASE_NAME_RE), the
# same filter prune_slot() uses — a stray junk entry (file, unrelated dir)
# must never inflate the reported "releases kept" count.
count_real_releases() {
  local dir="$1" n=0 d base
  [ -d "$dir" ] || { echo 0; return; }
  shopt -s nullglob
  for d in "$dir"/*; do
    [ -d "$d" ] || continue
    [ -L "$d" ] && continue
    base="$(basename "$d")"
    [[ "$base" =~ $RELEASE_NAME_RE ]] && n=$((n + 1))
  done
  shopt -u nullglob
  echo "$n"
}
PROD_COUNT="$(count_real_releases "$ROOT/releases")"
STAGING_COUNT="$(count_real_releases "$ROOT/releases-staging")"

FREED_MB=$((FREED_KB > 0 ? FREED_KB / 1024 : 0))

LARGEST_ROOT="(skipped)"
LARGEST_WWW="(skipped)"
if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ] && [ "$MODE" != "dry-run" ]; then
  LARGEST_ROOT="$(du -xsh /root/*/ 2>/dev/null | sort -rh | head -n5 || true)"
  LARGEST_WWW="$(du -xsh "$ROOT"/*/ 2>/dev/null | sort -rh | head -n5 || true)"
fi

REPORT_TITLE="disk hygiene: ${USED_PCT} used, ${FREE_GB}GB free, ${FREED_MB}MB freed"
REPORT_BODY="disk used: ${USED_PCT} (free ${FREE_GB}GB)
prod releases kept: ${PROD_COUNT} (keep=${KEEP_PROD})
staging releases kept: ${STAGING_COUNT} (keep=${KEEP_STAGING})
orphaned release servers found: ${ORPHAN_COUNT}
freed this run: ${FREED_MB}MB
largest dirs under /root:
${LARGEST_ROOT}
largest dirs under ${ROOT}:
${LARGEST_WWW}"

# MEDIUM-3: REPORT_LINES (e.g. "release prune skipped: deploy in progress")
# was accumulated but never printed or sent — the reason a run did less than
# usual never reached the report or the Notifier body. Fold it in here so it
# reaches both.
if [ "${#REPORT_LINES[@]}" -gt 0 ]; then
  REPORT_BODY="$REPORT_BODY
notes:
$(printf '%s\n' "${REPORT_LINES[@]}")"
fi

echo "=== W-134 disk hygiene report ==="
echo "$REPORT_BODY"

# --- 8. Notifier (info < 70%, warning 70-80%, critical >= 80%) --------------
# C1: --report must never POST — routed through the same may_delete predicate
# as every other destructive/external-effect step.
if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ] && may_delete; then
  USED_NUM="$(echo "$USED_PCT" | tr -d '%')"
  SEVERITY="info"
  if [[ "$USED_NUM" =~ ^[0-9]+$ ]]; then
    if [ "$USED_NUM" -ge 80 ]; then
      SEVERITY="critical"
    elif [ "$USED_NUM" -ge 70 ]; then
      SEVERITY="warning"
    fi
  fi

  if [ -f "$NOTIFIER_ENV" ]; then
    set -a; source "$NOTIFIER_ENV"; set +a
  elif [ -f "$GLOBAL_ENV" ]; then
    set -a; source "$GLOBAL_ENV"; set +a
  fi

  if [ -n "${NOTIFIER_KEY_IPODHAN:-}" ]; then
    DATE_TAG="$(date +%F)"
    PAYLOAD="$(python3 -c "
import json, sys
print(json.dumps({
  'project': 'ipodhan',
  'severity': sys.argv[1],
  'title': sys.argv[2],
  'body': sys.argv[3][-1200:],
  'type': 'disk-hygiene',
  'dedupeKey': 'disk-hygiene-' + sys.argv[4],
}))
" "$SEVERITY" "$REPORT_TITLE" "$REPORT_BODY" "$DATE_TAG" 2>/dev/null || true)"
    if [ -n "$PAYLOAD" ]; then
      curl -s -m 15 -X POST "${HYGIENE_NOTIFIER_URL:-http://127.0.0.1:3300/notify}" \
        -H "X-Api-Key: $NOTIFIER_KEY_IPODHAN" -H "Content-Type: application/json" \
        -d "$PAYLOAD" >/dev/null 2>&1 || log "WARN: Notifier POST failed (non-fatal)"
    else
      log "WARN: could not build Notifier payload (python3 unavailable?) — skipping (non-fatal)"
    fi
  else
    log "NOTIFY-SKIP: NOTIFIER_KEY_IPODHAN not set"
  fi
else
  log "skipping Notifier POST (HYGIENE_SKIP_SYSTEM set, or MODE != run)"
fi

exit 0
