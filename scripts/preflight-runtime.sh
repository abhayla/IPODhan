#!/bin/sh
# T-406 — VPS runtime preflight (stage 9 of the test ladder, see
# docs/reviews/T-406-plan.md). Checks that the BOX a deploy is about to
# restart PM2 on actually has the runtime the app needs — DRHP PDF
# extraction (python3 + pdfplumber), OCR (tesseract, WARN-only until E4
# lands), a sane ambient TZ per the T-327 decision, a writable prospectus
# store with headroom (T-403 default), a modern node, and ADMIN_API_TOKEN
# for the scraper's --source=all cycle. Run by scripts/deploy-linux.sh
# immediately before the pm2 restart step; a FAIL there aborts the deploy
# before anything already-running is touched.
#
# Usage:
#   scripts/preflight-runtime.sh            # exits 1 on any FAIL, 0 if only OK/WARN
#   scripts/preflight-runtime.sh --report   # same checks/output, always exits 0
#
# POSIX sh — no bash-only syntax ([[ ]], arrays, local) so it runs the same
# under `sh` or `bash` (and dash, the default /bin/sh on Debian/Ubuntu).
#
# Output: one line per check, in order, ALL checks run even after an
# earlier FAIL (report everything, never fail-fast):
#   OK|WARN|FAIL <check name> — <detail>

set -u

REPORT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --report) REPORT_ONLY=1 ;;
  esac
done

FAIL_COUNT=0
PY_OK=0

# emit LEVEL "check name — detail"; tracks FAIL_COUNT for the exit code.
emit() {
  level="$1"
  shift
  printf '%s %s\n' "$level" "$*"
  if [ "$level" = "FAIL" ]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ---------------------------------------------------------- 1. python3 on PATH
check_python3() {
  if command -v python3 >/dev/null 2>&1; then
    emit OK "python3 on PATH — $(command -v python3)"
    PY_OK=1
  else
    emit FAIL "python3 on PATH — not found on PATH (needed for DRHP PDF extraction)"
    PY_OK=0
  fi
}

# --------------------------------------------------- 2. python3 -c import pdfplumber
check_pdfplumber() {
  if [ "$PY_OK" != "1" ]; then
    emit FAIL "python3 pdfplumber import — skipped, python3 not on PATH"
    return
  fi
  if python3 -c 'import pdfplumber' >/dev/null 2>&1; then
    emit OK "python3 pdfplumber import — 'import pdfplumber' succeeds"
  else
    emit FAIL "python3 pdfplumber import — 'python3 -c import pdfplumber' failed (module not installed?)"
  fi
}

# ------------------------------------------------------ 3. tesseract on PATH
# WARN only until E4 (OCR fallback) lands — contract-specified, not a hard
# dependency of the current pipeline yet.
check_tesseract() {
  if command -v tesseract >/dev/null 2>&1; then
    emit OK "tesseract on PATH — $(command -v tesseract)"
  else
    emit WARN "tesseract on PATH — not found (OCR fallback unavailable; WARN-only until E4 lands)"
  fi
}

# --------------------------------------------------------------- 4. TZ (T-327)
# T-327 P2-7: scripts/deploy-linux.sh's restart_pm2() ALWAYS prefixes every
# `pm2 start` with `TZ=UTC` explicitly — that is the real fix (belt-and-
# braces; the date-parse fix in scraper/src/utils/date-string-parsing.ts no
# longer even depends on it). ecosystem.config.js's own TZ:'UTC' is
# documented DEAD config on the Linux path. So this check is a
# defense-in-depth signal on the box's AMBIENT TZ, not the pm2 process TZ
# (which the deploy already forces). Accepted ambient values: Asia/Kolkata
# (this VPS's real host TZ, India-hosted) or UTC — anything else, or an
# undeterminable TZ, is a FAIL.
check_tz() {
  tz_value=""
  tz_source=""
  if [ -n "${TZ:-}" ]; then
    tz_value="$TZ"
    tz_source='$TZ env'
  elif [ -r /etc/timezone ]; then
    tz_value="$(cat /etc/timezone 2>/dev/null | tr -d '[:space:]')"
    tz_source="/etc/timezone"
  elif command -v timedatectl >/dev/null 2>&1; then
    tz_value="$(timedatectl show -p Timezone --value 2>/dev/null | tr -d '[:space:]')"
    tz_source="timedatectl"
  fi

  case "$tz_value" in
    Asia/Kolkata|UTC)
      emit OK "process TZ (T-327) — $tz_source=$tz_value"
      ;;
    "")
      emit FAIL "process TZ (T-327) — could not determine ambient TZ (no \$TZ, /etc/timezone, or timedatectl)"
      ;;
    *)
      emit FAIL "process TZ (T-327) — $tz_source=$tz_value, expected Asia/Kolkata or UTC"
      ;;
  esac
}

# --------------------------------------------------- 5. PROSPECTUS_STORE_DIR
# document-store.ts (which will define the real default) lives on the T-403
# branch, not merged here — confirmed absent from this worktree. The
# contract names the default shape as "<shared>/prospectus". This deploy's
# own "shared" dir is $DEPLOY_ROOT/shared (see scripts/deploy-linux.sh's
# LAYOUT ON THE BOX header, ENV_DIR="$ROOT/shared/env/$SLOT"), DEPLOY_ROOT
# defaulting to /var/www/ipodhan. If PROSPECTUS_STORE_DIR is set, that exact
# directory must exist and be writable. If unset (current state, since
# T-403 hasn't landed), the default dir doesn't exist yet by design — so we
# fall back to asserting the PARENT ("shared") is writable, i.e. the
# directory T-403's default will be created under. NOTE: the default
# directory itself (<shared>/prospectus) is owned by T-403 — this check
# only guarantees its parent is ready.
DISK_CHECK_PATH=""
check_store_dir() {
  if [ -n "${PROSPECTUS_STORE_DIR:-}" ]; then
    target="$PROSPECTUS_STORE_DIR"
    DISK_CHECK_PATH="$target"
    if [ -d "$target" ] && [ -w "$target" ]; then
      emit OK "prospectus store dir — $target exists and is writable"
    else
      emit FAIL "prospectus store dir — PROSPECTUS_STORE_DIR=$target missing or not writable"
    fi
  else
    deploy_root="${DEPLOY_ROOT:-/var/www/ipodhan}"
    parent="$deploy_root/shared"
    DISK_CHECK_PATH="$parent"
    if [ -d "$parent" ] && [ -w "$parent" ]; then
      emit OK "prospectus store dir — PROSPECTUS_STORE_DIR unset; fallback parent $parent is writable (default <shared>/prospectus owned by T-403)"
    else
      emit FAIL "prospectus store dir — PROSPECTUS_STORE_DIR unset and fallback parent $parent missing or not writable"
    fi
  fi
}

# ------------------------------------------------------ 6. free disk >= 2GB
# Walks up to the nearest existing ancestor of the resolved store path
# before calling df, since PROSPECTUS_STORE_DIR (or its T-403 default) may
# not exist yet on a box that hasn't been provisioned for it.
nearest_existing_dir() {
  d="$1"
  while [ ! -d "$d" ] && [ "$d" != "/" ] && [ -n "$d" ]; do
    d="$(dirname "$d")"
  done
  if [ -d "$d" ]; then
    printf '%s' "$d"
  else
    printf '%s' "/"
  fi
}

check_disk_free() {
  probe_dir="$(nearest_existing_dir "${DISK_CHECK_PATH:-/}")"
  avail_kb="$(df -Pk "$probe_dir" 2>/dev/null | awk 'NR==2 {print $4}')"
  case "$avail_kb" in
    ''|*[!0-9]*)
      emit FAIL "free disk >= 2GB — could not determine free space at $probe_dir"
      return
      ;;
  esac
  avail_gb=$((avail_kb / 1024 / 1024))
  if [ "$avail_kb" -ge 2097152 ]; then
    emit OK "free disk >= 2GB — ${avail_gb}GB free at $probe_dir"
  else
    emit FAIL "free disk >= 2GB — only ${avail_gb}GB free at $probe_dir"
  fi
}

# --------------------------------------------------------------- 7. node >= 20
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    emit FAIL "node >= 20 — node not found on PATH"
    return
  fi
  node_version="$(node --version 2>/dev/null)"
  ver_no_v="${node_version#v}"
  major="${ver_no_v%%.*}"
  case "$major" in
    ''|*[!0-9]*)
      emit FAIL "node >= 20 — could not parse version from '$node_version'"
      ;;
    *)
      if [ "$major" -ge 20 ]; then
        emit OK "node >= 20 — found $node_version"
      else
        emit FAIL "node >= 20 — found $node_version"
      fi
      ;;
  esac
}

# --------------------------------------------------- 8. ADMIN_API_TOKEN set
# Mirrors scraper/src/index.ts's assertRequiredEnvForCycle (T-340): a
# missing ADMIN_API_TOKEN previously caused a silent per-step skip instead
# of a startup failure for --source=all.
check_admin_token() {
  if [ -n "${ADMIN_API_TOKEN:-}" ]; then
    emit OK "ADMIN_API_TOKEN set — present for the --source=all cycle"
  else
    emit FAIL "ADMIN_API_TOKEN set — unset or blank (required for --source=all)"
  fi
}

check_python3
check_pdfplumber
check_tesseract
check_tz
check_store_dir
check_disk_free
check_node
check_admin_token

if [ "$REPORT_ONLY" = "1" ]; then
  exit 0
fi

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi

exit 0
