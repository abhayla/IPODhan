#!/usr/bin/env bash
# Config-only deploy path (stage 3 item 3 slice S5, build card
# docs/design/build-cards/item-03-s5-config-only-deploy.md).
#
# Copies ONLY scraper/config/field-manifest.json from a given sha (that
# must be on origin/main) into $ROOT/shared/config/$SLOT/, verifies the
# copy's sha256 against the committed blob, writes CONFIG_SHA, appends one
# line to deploy-config.log, and refuses on bad lineage, a hash mismatch,
# a prod deploy without the owner's explicit flag, or a 5th staging run in
# one UTC day. No build, no PM2 restart — the release-independent shared
# file is what every release's field-manifest.json symlinks to
# (scripts/deploy-linux.sh's release-link block).
#
# Usage:
#   deploy-config.sh --slot <staging|prod> --sha <sha> --reason "<text>" \
#     [--dry-run] [--root <dir>] [--i-have-the-owners-word]
#
# Exit 0: deployed (or dry-run printed). Exit 1: refused, reason printed
# first (lineage | hash | prod-guard | cap | missing arg).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${DEPLOY_CONFIG_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MANIFEST_REL_PATH="scraper/config/field-manifest.json"

SLOT=""
SHA=""
REASON=""
DRY_RUN=0
ROOT=""
OWNERS_WORD=0

fatal() { echo "FATAL: $1" >&2; exit 1; }
log() { echo "$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --slot) SLOT="${2:-}"; shift 2 ;;
    --slot=*) SLOT="${1#--slot=}"; shift ;;
    --sha) SHA="${2:-}"; shift 2 ;;
    --sha=*) SHA="${1#--sha=}"; shift ;;
    --reason) REASON="${2:-}"; shift 2 ;;
    --reason=*) REASON="${1#--reason=}"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --root) ROOT="${2:-}"; shift 2 ;;
    --root=*) ROOT="${1#--root=}"; shift ;;
    --i-have-the-owners-word) OWNERS_WORD=1; shift ;;
    *) fatal "unknown argument '$1' (missing arg)" ;;
  esac
done

[ -n "$SLOT" ] || fatal "missing arg: --slot <staging|prod> is required (missing arg)"
[ -n "$SHA" ] || fatal "missing arg: --sha <sha> is required (missing arg)"
[ -n "$REASON" ] || fatal "missing arg: --reason \"<text>\" is required (missing arg)"

case "$SLOT" in
  staging|prod) ;;
  *) fatal "missing arg: --slot must be 'staging' or 'prod', got '$SLOT' (missing arg)" ;;
esac

ROOT="${ROOT:-${DEPLOY_ROOT:-/var/www/ipodhan}}"
CONFIG_DIR="$ROOT/shared/config/$SLOT"
MANIFEST_TARGET="$CONFIG_DIR/field-manifest.json"
CONFIG_SHA_FILE="$CONFIG_DIR/CONFIG_SHA"
LOG_FILE="$ROOT/shared/config/deploy-config.log"
STATE_DIR="${DEPLOY_CONFIG_STATE_DIR:-$SCRIPT_DIR/state}"

# ---------------------------------------------------------------- prod-guard
if [ "$SLOT" = "prod" ] && [ "$OWNERS_WORD" -ne 1 ]; then
  fatal "prod-guard: --slot prod requires --i-have-the-owners-word — refusing without it (prod-guard)"
fi

# ------------------------------------------------------------------ lineage
# Same lineage rule as deploy-linux.sh step 0.5: the sha must be reachable
# from origin/main. DEPLOY_CONFIG_LINEAGE_SKIP_FETCH lets a test point this
# check at a local fixture repo without a real 'origin' remote.
if [ "${DEPLOY_CONFIG_LINEAGE_SKIP_FETCH:-0}" != "1" ]; then
  if ! (cd "$REPO_ROOT" && git fetch origin main --quiet) 2>/tmp/deploy-config-fetch-$$.err; then
    msg="$(cat /tmp/deploy-config-fetch-$$.err 2>/dev/null)"; rm -f /tmp/deploy-config-fetch-$$.err
    fatal "lineage: 'git fetch origin main' failed ($msg) — cannot verify $SHA is on origin/main (lineage)"
  fi
  rm -f /tmp/deploy-config-fetch-$$.err
fi

if ! (cd "$REPO_ROOT" && git merge-base --is-ancestor "$SHA" origin/main) 2>/dev/null; then
  fatal "lineage: $SHA is not an ancestor of origin/main — refusing (lineage)"
fi
log "lineage OK: $SHA is on origin/main"

# --------------------------------------------------------------------- cap
# Staging: at most 4 config-deploy runs per UTC calendar day (state file
# idiom borrowed from deploy-staging-now.sh's daily cap). Prod carries no
# cap — the owner's word (--i-have-the-owners-word) is the gate for prod.
if [ "$SLOT" = "staging" ] && [ "$DRY_RUN" -ne 1 ]; then
  DAILY_CAP=4
  mkdir -p "$STATE_DIR"
  TODAY="$(date -u '+%Y-%m-%d')"
  STATE_FILE="$STATE_DIR/deploy-config-staging-$TODAY.json"
  if [ -f "$STATE_FILE" ]; then
    COUNT="$(node -e '
      const fs = require("fs");
      try {
        const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        console.log(Array.isArray(rows) ? rows.length : 0);
      } catch { console.log(0); }
    ' "$STATE_FILE" 2>/dev/null || echo 0)"
  else
    COUNT=0
  fi
  if [ "$COUNT" -ge "$DAILY_CAP" ]; then
    fatal "cap: $COUNT staging config-deploy runs already recorded today ($TODAY, cap $DAILY_CAP) — refusing (cap)"
  fi
fi

# ------------------------------------------------------------- hash + copy
TMP_MANIFEST="$(mktemp)"
trap 'rm -f "$TMP_MANIFEST"' EXIT

if ! (cd "$REPO_ROOT" && git show "$SHA:$MANIFEST_REL_PATH") >"$TMP_MANIFEST" 2>/tmp/deploy-config-show-$$.err; then
  msg="$(cat /tmp/deploy-config-show-$$.err 2>/dev/null)"; rm -f /tmp/deploy-config-show-$$.err
  fatal "hash: could not read $MANIFEST_REL_PATH at $SHA ($msg) (hash)"
fi
rm -f /tmp/deploy-config-show-$$.err

SHA256="$(sha256sum "$TMP_MANIFEST" | awk '{print $1}')"

if (( DRY_RUN )); then
  log "[dry-run] would copy $MANIFEST_REL_PATH @ $SHA (sha256 $SHA256) into $MANIFEST_TARGET"
  log "[dry-run] would write $CONFIG_SHA_FILE = $SHA"
  log "[dry-run] would append to $LOG_FILE"
  exit 0
fi

mkdir -p "$CONFIG_DIR"

# Atomic replace: write .tmp then mv, so a reader never sees a half-written
# manifest.
TMP_TARGET="$MANIFEST_TARGET.tmp"
cp "$TMP_MANIFEST" "$TMP_TARGET"
mv "$TMP_TARGET" "$MANIFEST_TARGET"

# Verify what actually landed on disk hashes the same as the committed
# blob — this is the hash guard's real assertion (not just "git show
# succeeded").
WRITTEN_SHA256="$(sha256sum "$MANIFEST_TARGET" | awk '{print $1}')"
if [ "$WRITTEN_SHA256" != "$SHA256" ]; then
  fatal "hash: written file sha256 ($WRITTEN_SHA256) does not match committed blob sha256 ($SHA256) (hash)"
fi

printf '%s' "$SHA" > "$CONFIG_SHA_FILE"

USER="${USER:-${USERNAME:-unknown}}"
TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '%s %s %s %s %s %s\n' "$TS" "$SLOT" "$SHA" "$SHA256" "$USER" "$REASON" >> "$LOG_FILE"

if [ "$SLOT" = "staging" ]; then
  mkdir -p "$STATE_DIR"
  TODAY="$(date -u '+%Y-%m-%d')"
  STATE_FILE="$STATE_DIR/deploy-config-staging-$TODAY.json"
  node -e '
    const fs = require("fs");
    const [file, ts, sha, reason] = process.argv.slice(1);
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(file, "utf8")); if (!Array.isArray(rows)) rows = []; } catch {}
    rows.push({ ts, sha, reason });
    fs.writeFileSync(file, JSON.stringify(rows));
  ' "$STATE_FILE" "$TS" "$SHA" "$REASON"
fi

log "deployed: $SLOT $SHA (sha256 $SHA256) -> $MANIFEST_TARGET"
exit 0
