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
#                           used by the test suite so it never touches the real machine
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
KEEP_PROD="${HYGIENE_KEEP_PROD:-3}"
KEEP_STAGING="${HYGIENE_KEEP_STAGING:-2}"
NOTIFIER_ENV="${NOTIFIER_ENV:-/root/notifier/.env}"
GLOBAL_ENV="${HYGIENE_GLOBAL_ENV:-/root/Abhay/GLOBAL.env}"

FREED_KB=0
REPORT_LINES=()

log() { [ "$MODE" = "report" ] && return 0; echo "[$(date -Iseconds)] $*"; }
report() { REPORT_LINES+=("$*"); }

# --- release-dir name + path safety guards ----------------------------------
# Mirrors deploy-linux.sh's safe_rm_venv_dir(): every deletion goes through a
# guard that (a) refuses '..' outright and (b) refuses anything outside the
# one allowed root, before rm -rf ever runs.
RELEASE_NAME_RE='^[0-9]{8}-[0-9]{6}-[0-9a-f]{7,40}$'

safe_rm_release_dir() {
  local dir="$1" base
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
  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would remove release dir $dir"
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
  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would remove stale venv build dir $dir"
    return 0
  fi
  log "removing stale venv build dir $dir"
  rm -rf -- "${dir:?}"
}

dir_kb() {
  local dir="$1"
  [ -e "$dir" ] || { echo 0; return; }
  du -sk "$dir" 2>/dev/null | awk '{print $1}' || echo 0
}

current_target() {
  local link="$1"
  if [ -L "$link" ]; then
    readlink -f "$link" 2>/dev/null || readlink "$link"
  elif [ -f "$link" ]; then
    cat "$link"
  fi
}

# --- 1. prune releases beyond retention, both slots -------------------------
prune_slot() {
  local slot="$1" keep="$2" releases_dir current_link cur total
  if [ "$slot" = "prod" ]; then
    releases_dir="$ROOT/releases"
    current_link="$ROOT/current"
  else
    releases_dir="$ROOT/releases-$slot"
    current_link="$ROOT/current-$slot"
  fi

  [ -d "$releases_dir" ] || { log "no releases dir for slot '$slot' — skipping"; return 0; }

  cur="$(current_target "$current_link" || true)"
  # shellcheck disable=SC2012
  total="$(cd "$releases_dir" && ls -1 | LC_ALL=C sort | wc -l | tr -d ' ')"
  if [ "$total" -le "$keep" ]; then
    log "slot '$slot': $total release(s) <= keep=$keep, nothing to prune"
    return 0
  fi

  local removed=0
  # shellcheck disable=SC2012
  ls -1 "$releases_dir" | LC_ALL=C sort | head -n "$((total - keep))" | while IFS= read -r old; do
    local old_path="$releases_dir/$old"
    if [ "$old_path" = "$cur" ]; then
      log "slot '$slot': keeping $old (it is 'current')"
      continue
    fi
    if ! [[ "$old" =~ $RELEASE_NAME_RE ]]; then
      log "slot '$slot': skipping $old — name does not match the release-dir pattern"
      continue
    fi
    local before after
    before="$(dir_kb "$old_path")"
    safe_rm_release_dir "$old_path"
    if [ "$MODE" != "dry-run" ]; then
      after="$(dir_kb "$old_path")"
      FREED_KB=$((FREED_KB + (before - after)))
    fi
  done
}

log "=== W-134 disk hygiene: $(date -Iseconds) mode=$MODE root=$ROOT ==="
prune_slot prod "$KEEP_PROD"
prune_slot staging "$KEEP_STAGING"

# --- 2. journal vacuum -------------------------------------------------------
if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ]; then
  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would run journalctl --vacuum-size=200M"
  elif command -v journalctl >/dev/null 2>&1; then
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
    elif command -v npm >/dev/null 2>&1; then
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
    elif command -v python3 >/dev/null 2>&1; then
      log "pip cache is ${PIP_KB}KB (over 500MB) — running pip cache purge"
      python3 -m pip cache purge >/dev/null 2>&1 || log "WARN: pip cache purge failed (non-fatal)"
      FREED_KB=$((FREED_KB + PIP_KB - $(dir_kb "$PIP_CACHE_DIR")))
    fi
  else
    log "pip cache is ${PIP_KB}KB — under the 500MB threshold, left alone"
  fi

  if [ "$MODE" = "dry-run" ]; then
    log "DRY-RUN: would run apt-get clean"
  elif command -v apt-get >/dev/null 2>&1; then
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
if [ -n "${HYGIENE_SKIP_SYSTEM:-}" ]; then
  log "HYGIENE_SKIP_SYSTEM set — skipping /tmp sweep"
elif [ "$MODE" = "dry-run" ]; then
  log "DRY-RUN: would delete files older than 7 days under $TMP_SWEEP_DIR"
  find "$TMP_SWEEP_DIR" -xdev -type f -mtime +7 2>/dev/null | while IFS= read -r f; do log "DRY-RUN: would remove $f"; done || true
else
  log "deleting files older than 7 days under $TMP_SWEEP_DIR"
  find "$TMP_SWEEP_DIR" -xdev -type f -mtime +7 -delete 2>/dev/null || true
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

# --- 6. final report ----------------------------------------------------------
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

PROD_COUNT=0
STAGING_COUNT=0
[ -d "$ROOT/releases" ] && PROD_COUNT="$(ls -1 "$ROOT/releases" 2>/dev/null | wc -l | tr -d ' ')"
[ -d "$ROOT/releases-staging" ] && STAGING_COUNT="$(ls -1 "$ROOT/releases-staging" 2>/dev/null | wc -l | tr -d ' ')"

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
freed this run: ${FREED_MB}MB
largest dirs under /root:
${LARGEST_ROOT}
largest dirs under ${ROOT}:
${LARGEST_WWW}"

echo "=== W-134 disk hygiene report ==="
echo "$REPORT_BODY"

# --- 7. Notifier (info < 70%, warning 70-80%, critical >= 80%) --------------
if [ -z "${HYGIENE_SKIP_SYSTEM:-}" ] && [ "$MODE" != "dry-run" ]; then
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
      curl -s -m 15 -X POST "http://127.0.0.1:3300/notify" \
        -H "X-Api-Key: $NOTIFIER_KEY_IPODHAN" -H "Content-Type: application/json" \
        -d "$PAYLOAD" >/dev/null 2>&1 || log "WARN: Notifier POST failed (non-fatal)"
    else
      log "WARN: could not build Notifier payload (python3 unavailable?) — skipping (non-fatal)"
    fi
  else
    log "NOTIFY-SKIP: NOTIFIER_KEY_IPODHAN not set"
  fi
else
  log "skipping Notifier POST (HYGIENE_SKIP_SYSTEM set or dry-run)"
fi

exit 0
