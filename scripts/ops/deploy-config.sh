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
# first (lineage | hash | prod-guard | cap | missing arg | repo-root).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_REL_PATH="scraper/config/field-manifest.json"

# ------------------------------------------------------------------ F5 (#752)
# A leaked GIT_DIR/GIT_WORK_TREE (from a parent process, a git alias/wrapper,
# or a hook-invoked shell) makes git skip repository discovery entirely, so
# 'git rev-parse --is-inside-work-tree' prints "true" for ANY cwd and the
# repo-root guard below is never actually exercised — every later git call
# then silently reads whichever repo GIT_DIR names, not $REPO_ROOT.
# Unsetting both here (rather than refusing when they are set) is the
# simpler, always-safe fix: this script never wants to operate on the
# invoker's ambient git context, only on the explicit $REPO_ROOT it resolves
# below, so there is no legitimate case where a caller NEEDS GIT_DIR/
# GIT_WORK_TREE honored — refusing would only add an extra failure mode for
# an environment leak the caller may not even know about.
unset GIT_DIR GIT_WORK_TREE

# ------------------------------------------------------------------ F6 (#752)
# The repo-root fallback chain below only asks "is this a git work tree",
# never "is this IPODhan" — a release tree that happens to sit under some
# OTHER git work tree (a sibling checkout, a version-controlled home
# directory) would pass silently and the manifest would be read from the
# wrong repo. EXPECTED_REPO_REMOTE_RE matches the real IPODhan remote in
# every form 'git remote get-url origin' can print it: https or ssh, with or
# without the trailing '.git'. Checked against $REPO_ROOT's own 'origin'
# once REPO_ROOT is chosen (see the "repo-root: identity" block below).
EXPECTED_REPO_REMOTE_RE='^(https://github\.com/|git@github\.com:)abhayla/IPODhan(\.git)?$'

# The on-box checkout that a deployed release (a git-free 'git archive |
# tar -x' export, #748) falls back to when nothing overrides it. A
# constant, not buried inline, so it is easy to find/override; tests point
# it at a fixture via DEPLOY_CONFIG_SERVER_REPO_DEFAULT.
SERVER_REPO_DEFAULT="${DEPLOY_CONFIG_SERVER_REPO_DEFAULT:-/var/www/ipodhan/repo}"

SLOT=""
SHA=""
REASON=""
DRY_RUN=0
ROOT=""
OWNERS_WORD=0

fatal() { echo "FATAL: $1" >&2; exit 1; }
log() { echo "$1"; }

# ---------------------------------------------------------------- ist-day
# #1057: the staging cap below is a per-DAY counter the runbook and the
# owner read as an IST day (.claude/rules/ist-timezone.md — every schedule
# and cadence is stated and reasoned about in IST). Keying it on `date -u`
# resets the cap at 05:30 IST instead of midnight IST. IST = UTC+5:30, no
# DST; computed here by fixed-offset arithmetic on the epoch second (never
# `TZ=Asia/Kolkata date`, which needs tzdata the box may not have) —
# mirrors scripts/lib/ist-day.mjs and scripts/vps-data-audit-cron.sh's
# DATE_TAG. DEPLOY_CONFIG_NOW (epoch seconds) lets a test inject the clock
# instead of reading the real one.
#
# NOT sourced from scripts/ops/lib/ist-day.sh (#1064 added that shared copy
# for deploy-staging-now.sh): this function stays self-contained because
# this script is copied ALONE into a deployed release / test fixture
# (scripts/tests/deploy-config.test.sh cases 15/16 cp only this file, no
# sibling lib/ dir — mirrors the real #748 git-archive export), so adding a
# `source "$SCRIPT_DIR/lib/..."` dependency would break every one of those.
ist_today() {
  local epoch="${DEPLOY_CONFIG_NOW:-$(date +%s)}"
  date -u -d "@$(( epoch + 19800 ))" +%F
}

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
# #751: NOT $SCRIPT_DIR/state. On a deployed release $SCRIPT_DIR is
# <release-dir>/scripts/ops — inside that release's OWN directory tree, and
# deploy-linux.sh creates a fresh release dir on every deploy. Defaulting the
# 4/day staging cap counter there meant it reset every time a new release was
# cut in between staging config-only deploys. $ROOT/shared/config/state is a
# sibling of the $ROOT/shared/config/<slot>/ dirs this script already writes
# into release-independently, so it persists across releases the same way
# they do. DEPLOY_CONFIG_STATE_DIR remains the test/override escape hatch.
STATE_DIR="${DEPLOY_CONFIG_STATE_DIR:-$ROOT/shared/config/state}"

# ---------------------------------------------------------------- prod-guard
if [ "$SLOT" = "prod" ] && [ "$OWNERS_WORD" -ne 1 ]; then
  fatal "prod-guard: --slot prod requires --i-have-the-owners-word — refusing without it (prod-guard)"
fi

# F7 (#752): DEPLOY_CONFIG_LINEAGE_SKIP_FETCH exists ONLY so a test can point
# the lineage check at a local fixture repo with no real 'origin' remote
# (see the lineage section below). Skipping the fetch means the lineage
# check walks a possibly-stale origin/main and can accept a sha that was
# reverted upstream — /var/www/ipodhan/repo is not kept current by any
# other deploy step, so this script's own fetch is the ONLY thing making
# origin/main fresh on the box. That risk is never acceptable for a prod
# deploy, so it is refused outright (before anything else runs), with the
# reason printed first per the signal-ownership rule that every refusal
# names its cause.
if [ "$SLOT" = "prod" ] && [ "${DEPLOY_CONFIG_LINEAGE_SKIP_FETCH:-0}" = "1" ]; then
  fatal "prod-guard: DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 is refused for --slot prod — it skips the fetch that keeps origin/main fresh, so a stale or reverted sha could pass lineage; this variable is test-only (prod-guard)"
fi

# ------------------------------------------------------------------- repo-root
# On a deployed release this script's own dir has no .git anywhere above it
# (scripts/deploy-linux.sh step 4 ships releases as a 'git archive | tar -x'
# export, #748) — the default REPO_ROOT computation ($SCRIPT_DIR/../..) then
# points at a plain, git-free directory and every git call below would fail
# with a raw, unhelpful git error.
#
# is_real_work_tree tests the PRINTED VALUE of 'git rev-parse
# --is-inside-work-tree', never just its exit code: in a bare repo or
# inside a .git directory that command prints "false" but still exits 0
# (MAJOR-3), so an exit-code-only guard lets both cases fall through into
# raw git errors below instead of being refused here.
is_real_work_tree() {
  local dir="$1" out
  out="$(cd "$dir" 2>/dev/null && git rev-parse --is-inside-work-tree 2>/dev/null)" || return 1
  [ "$out" = "true" ]
}

# Fallback chain for REPO_ROOT, in priority order:
#   1. DEPLOY_CONFIG_REPO, if set — explicit override always wins, even if
#      it turns out not to be a real work tree (the guard below will still
#      refuse it, with git's own error attached).
#   2. $SCRIPT_DIR/../.. (the laptop/CI case: running from inside the repo
#      checkout) — used only when it IS a real work tree.
#   3. SERVER_REPO_DEFAULT (the deployed-release case: the on-box sibling
#      checkout at /var/www/ipodhan/repo, overridable for tests) — used
#      only when it IS a real work tree.
# The chosen source label is folded into the single "repo-root: using ..."
# log line below, once the identity check (F6) has also run — so an
# operator sees WHICH candidate won AND which repo it actually points at,
# in one line, without reading the source.
if [ -n "${DEPLOY_CONFIG_REPO:-}" ]; then
  REPO_ROOT="$DEPLOY_CONFIG_REPO"
  REPO_ROOT_SOURCE="DEPLOY_CONFIG_REPO override"
elif is_real_work_tree "$SCRIPT_DIR/../.."; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  REPO_ROOT_SOURCE="script's own checkout"
elif is_real_work_tree "$SERVER_REPO_DEFAULT"; then
  REPO_ROOT="$(cd "$SERVER_REPO_DEFAULT" && pwd)"
  REPO_ROOT_SOURCE="server default"
else
  REPO_ROOT="$SCRIPT_DIR/../.."
  REPO_ROOT_SOURCE="no candidate"
fi

# Re-verify the chosen REPO_ROOT (needed for the DEPLOY_CONFIG_REPO branch,
# which is not pre-checked above, and as a final guard for the no-candidate
# case). Capture stderr so the operator sees git's OWN words — e.g.
# 'dubious ownership' when /var/www/ipodhan/repo is root-owned and this
# runs as a non-root user (MAJOR-4) — instead of only generic advice that
# does not match a cause the operator has already worked around.
if ! REPO_ROOT_CHECK_OUT="$(cd "$REPO_ROOT" 2>&1 && git rev-parse --is-inside-work-tree 2>&1)" || [ "$REPO_ROOT_CHECK_OUT" != "true" ]; then
  fatal "repo-root: '$REPO_ROOT' is not a usable git working tree ($REPO_ROOT_CHECK_OUT) — set DEPLOY_CONFIG_REPO to a checkout that can reach origin/main, e.g. DEPLOY_CONFIG_REPO=/var/www/ipodhan/repo (repo-root)"
fi

# ------------------------------------------------------------ F6 (#752)
# "Is a real git work tree" is not "is IPODhan" — assert the resolved
# repo's origin actually IS the IPODhan remote before trusting anything it
# reads (see EXPECTED_REPO_REMOTE_RE above). Checked here, after the
# work-tree re-verify, so a bare repo / .git dir / dubious-ownership case
# is still refused by its own (earlier, more specific) message rather than
# a confusing "no origin remote" one.
if ! REPO_ROOT_ORIGIN="$(cd "$REPO_ROOT" && git remote get-url origin 2>&1)"; then
  fatal "repo-root: '$REPO_ROOT' ($REPO_ROOT_SOURCE) has no readable 'origin' remote ($REPO_ROOT_ORIGIN) — refusing to trust an unidentified repo (repo-root)"
fi
if ! printf '%s' "$REPO_ROOT_ORIGIN" | grep -Eq "$EXPECTED_REPO_REMOTE_RE"; then
  fatal "repo-root: '$REPO_ROOT' ($REPO_ROOT_SOURCE) has origin '$REPO_ROOT_ORIGIN', which is not the IPODhan remote — refusing to read a manifest from an unrelated repo (repo-root)"
fi

log "repo-root: using $REPO_ROOT ($REPO_ROOT_SOURCE, origin $REPO_ROOT_ORIGIN)"

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

# Resolve whatever text --sha received (HEAD, a branch name, a short sha,
# origin/main, ...) to the full 40-hex commit it names, so CONFIG_SHA and
# the log line always record a stable commit identity, never a symbolic
# ref that can move or be ambiguous later.
RESOLVED_SHA="$(cd "$REPO_ROOT" && git rev-parse --verify "$SHA^{commit}" 2>/tmp/deploy-config-resolve-$$.err)" || {
  msg="$(cat /tmp/deploy-config-resolve-$$.err 2>/dev/null)"; rm -f /tmp/deploy-config-resolve-$$.err
  fatal "lineage: could not resolve '$SHA' to a commit ($msg) (lineage)"
}
rm -f /tmp/deploy-config-resolve-$$.err
SHA="$RESOLVED_SHA"

log "lineage OK: $SHA is on origin/main"

# --------------------------------------------------------------------- cap
# Staging: at most 4 config-deploy runs per IST calendar day (#1057; state
# file idiom borrowed from deploy-staging-now.sh's daily cap). Prod carries
# no cap — the owner's word (--i-have-the-owners-word) is the gate for prod.
if [ "$SLOT" = "staging" ] && [ "$DRY_RUN" -ne 1 ]; then
  DAILY_CAP=4
  mkdir -p "$STATE_DIR"
  TODAY="$(ist_today)"
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
  TODAY="$(ist_today)"
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
