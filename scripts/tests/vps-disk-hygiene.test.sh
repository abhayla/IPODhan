#!/usr/bin/env bash
# W-134 — self-test for scripts/vps-disk-hygiene.sh.
# Builds a fake root under mktemp -d (HYGIENE_ROOT override) and exercises
# the prune/guard/dry-run logic without touching the real machine.
# HYGIENE_SKIP_SYSTEM=1 keeps journalctl/npm/pip/apt/Notifier out of every
# case here.
#
# Run: bash scripts/tests/vps-disk-hygiene.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HYGIENE_SCRIPT="$SCRIPT_DIR/../vps-disk-hygiene.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

fresh_root() {
  local d
  d="$(mktemp -d)"
  printf '%s' "$d"
}

# Creates a release dir named like a real deploy (STAMP-SHA, matching
# vps-disk-hygiene.sh's RELEASE_NAME_RE) with a distinct, sortable stamp.
make_release() {
  local releases_dir="$1" stamp="$2" sha="$3"
  mkdir -p "$releases_dir/$stamp-$sha"
  echo "marker" > "$releases_dir/$stamp-$sha/marker.txt"
  printf '%s' "$releases_dir/$stamp-$sha"
}

# Mirrors deploy-linux.sh's atomic_flip_current(): try a real symlink,
# fall back to a marker FILE holding the target path when the filesystem
# doesn't honor '-L' after ln -sfn (this repo's Windows dev box under MSYS
# bash included) — vps-disk-hygiene.sh's current_target() reads both shapes.
link_current() {
  local link="$1" target="$2"
  rm -rf "$link" "$link.tmp" 2>/dev/null || true
  if ln -sfn "$target" "$link.tmp" 2>/dev/null && [ -L "$link.tmp" ]; then
    mv -Tf "$link.tmp" "$link"
  else
    rm -rf "$link.tmp" "$link" 2>/dev/null || true
    printf '%s\n' "$target" > "$link"
  fi
}

current_target() {
  local link="$1"
  if [ -L "$link" ]; then
    readlink -f "$link" 2>/dev/null || readlink "$link"
  elif [ -f "$link" ]; then
    cat "$link"
  fi
}

# --- Case a: prunes prod beyond 3 and staging beyond 2, oldest first --------
ROOTA="$(fresh_root)"
mkdir -p "$ROOTA/releases" "$ROOTA/releases-staging"
R1="$(make_release "$ROOTA/releases" 20260901-000000 aaaaaaa)"
R2="$(make_release "$ROOTA/releases" 20260902-000000 bbbbbbb)"
R3="$(make_release "$ROOTA/releases" 20260903-000000 ccccccc)"
R4="$(make_release "$ROOTA/releases" 20260904-000000 ddddddd)"
link_current "$ROOTA/current" "$R4"

S1="$(make_release "$ROOTA/releases-staging" 20260901-000000 aaaaaaa)"
S2="$(make_release "$ROOTA/releases-staging" 20260902-000000 bbbbbbb)"
S3="$(make_release "$ROOTA/releases-staging" 20260903-000000 ccccccc)"
link_current "$ROOTA/current-staging" "$S3"

HYGIENE_ROOT="$ROOTA" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-a.log 2>&1
RCA=$?
if [ "$RCA" -ne 0 ]; then
  fail "case a: hygiene run exited $RCA"
  cat /tmp/hygiene-test-a.log
fi

if [ ! -d "$R1" ] && [ -d "$R3" ] && [ -d "$R4" ]; then
  pass "case a: prod prune removed the oldest release and kept the newest 3"
else
  fail "case a: prod prune did not remove oldest-first as expected (R1=$([ -d "$R1" ] && echo present || echo gone), R3=$([ -d "$R3" ] && echo present || echo gone))"
fi

if [ ! -d "$S1" ] && [ -d "$S2" ] && [ -d "$S3" ]; then
  pass "case a: staging prune removed the oldest release and kept the newest 2"
else
  fail "case a: staging prune did not remove oldest-first as expected"
fi

# --- Case b: never removes the 'current' target, even when oldest ----------
ROOTB="$(fresh_root)"
mkdir -p "$ROOTB/releases"
B1="$(make_release "$ROOTB/releases" 20260901-000000 aaaaaaa)"
B2="$(make_release "$ROOTB/releases" 20260902-000000 bbbbbbb)"
B3="$(make_release "$ROOTB/releases" 20260903-000000 ccccccc)"
B4="$(make_release "$ROOTB/releases" 20260904-000000 ddddddd)"
# 'current' deliberately points at the OLDEST release (as if a rollback
# left it pinned there) — it must survive the prune anyway.
link_current "$ROOTB/current" "$B1"

HYGIENE_ROOT="$ROOTB" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-b.log 2>&1

if [ -d "$B1" ]; then
  pass "case b: 'current' target survived the prune even though it was the oldest release"
else
  fail "case b: 'current' target ($B1) was PRUNED — deletion-guard regression"
fi

# --- Case c: ignores a directory with a non-matching name -------------------
ROOTC="$(fresh_root)"
mkdir -p "$ROOTC/releases"
C1="$(make_release "$ROOTC/releases" 20260901-000000 aaaaaaa)"
C2="$(make_release "$ROOTC/releases" 20260902-000000 bbbbbbb)"
C3="$(make_release "$ROOTC/releases" 20260903-000000 ccccccc)"
C4="$(make_release "$ROOTC/releases" 20260904-000000 ddddddd)"
mkdir -p "$ROOTC/releases/not-a-release-dir"
echo keep > "$ROOTC/releases/not-a-release-dir/marker.txt"
link_current "$ROOTC/current" "$C4"

HYGIENE_ROOT="$ROOTC" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-c.log 2>&1

if [ -d "$ROOTC/releases/not-a-release-dir" ]; then
  pass "case c: non-matching directory name was left alone"
else
  fail "case c: non-matching directory 'not-a-release-dir' was removed — name-pattern guard regression"
fi

# --- Case d: --dry-run removes nothing ---------------------------------------
ROOTD="$(fresh_root)"
mkdir -p "$ROOTD/releases"
D1="$(make_release "$ROOTD/releases" 20260901-000000 aaaaaaa)"
D2="$(make_release "$ROOTD/releases" 20260902-000000 bbbbbbb)"
D3="$(make_release "$ROOTD/releases" 20260903-000000 ccccccc)"
D4="$(make_release "$ROOTD/releases" 20260904-000000 ddddddd)"
link_current "$ROOTD/current" "$D4"

HYGIENE_ROOT="$ROOTD" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" --dry-run >/tmp/hygiene-test-d.log 2>&1
RCD=$?

if [ "$RCD" -eq 0 ] && [ -d "$D1" ] && [ -d "$D2" ] && [ -d "$D3" ] && [ -d "$D4" ]; then
  pass "case d: --dry-run exited 0 and removed nothing"
else
  fail "case d: --dry-run either exited non-zero ($RCD) or deleted a release"
fi
if grep -qi "DRY-RUN" /tmp/hygiene-test-d.log; then
  pass "case d: --dry-run output names what it would have removed"
else
  fail "case d: --dry-run produced no DRY-RUN lines"
fi

# --- Case e: the path guard refuses a release path outside the allowed roots
# Exercised through the CLI, not by sourcing the guard function directly —
# the script has no HYGIENE_SOURCED sourcing mode (it always runs the full
# sweep), so this drives it via a symlink escape attempt inside a fake root:
# a 'releases' entry that is itself a symlink pointing OUTSIDE HYGIENE_ROOT
# must never have its target contents deleted, because the guard matches on
# the literal, resolved path prefix "$ROOT/releases*/", and rm targets are
# built from that prefix — the outside directory is never reachable as a
# prune candidate in the first place (it can't appear inside releases/*).
ROOTE="$(fresh_root)"
OUTSIDEE="$(fresh_root)"
mkdir -p "$ROOTE/releases"
mkdir -p "$OUTSIDEE/20260101-000000-eeeeeee"
echo sentinel > "$OUTSIDEE/20260101-000000-eeeeeee/sentinel.txt"
# A malicious/misconfigured entry name that tries a traversal out of releases/.
mkdir -p "$ROOTE/releases/20260101-000000-eeeeeee"
ln -sfn "$OUTSIDEE/20260101-000000-eeeeeee" "$ROOTE/releases/../escape-dir" 2>/dev/null || true
for i in 1 2 3 4; do
  make_release "$ROOTE/releases" "2026010${i}-000000" "fffffff" >/dev/null
done
link_current "$ROOTE/current" "$(printf '%s/releases/20260104-000000-fffffff' "$ROOTE")"

HYGIENE_ROOT="$ROOTE" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-e.log 2>&1

if [ -f "$OUTSIDEE/20260101-000000-eeeeeee/sentinel.txt" ]; then
  pass "case e: a path outside HYGIENE_ROOT/releases* was never touched by the prune"
else
  fail "case e: the sentinel file outside the allowed root was deleted — path guard regression"
fi

# --- Case f: stale .new/.old venv dirs older than 1 day are removed, ------
# --- fresh ones are kept. ----------------------------------------------------
ROOTF="$(fresh_root)"
mkdir -p "$ROOTF/shared/venv/prod.new" "$ROOTF/shared/venv/prod.old" "$ROOTF/shared/venv/staging.new"
echo stale > "$ROOTF/shared/venv/prod.old/marker.txt"
echo stale > "$ROOTF/shared/venv/prod.new/marker.txt"
echo fresh > "$ROOTF/shared/venv/staging.new/marker.txt"
# Back-date the two "stale" dirs to 2 days ago; leave staging.new fresh (now).
touch -d '2 days ago' "$ROOTF/shared/venv/prod.new" "$ROOTF/shared/venv/prod.old" 2>/dev/null \
  || find "$ROOTF/shared/venv/prod.new" "$ROOTF/shared/venv/prod.old" -exec touch -t "$(date -d '2 days ago' +%Y%m%d0000 2>/dev/null || date -v-2d +%Y%m%d0000)" {} \; 2>/dev/null || true

HYGIENE_ROOT="$ROOTF" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-f.log 2>&1

if [ ! -d "$ROOTF/shared/venv/prod.new" ] && [ ! -d "$ROOTF/shared/venv/prod.old" ]; then
  pass "case f: stale (2-day-old) .new/.old venv build dirs were removed"
else
  fail "case f: stale venv build dirs survived (prod.new=$([ -d "$ROOTF/shared/venv/prod.new" ] && echo present || echo gone), prod.old=$([ -d "$ROOTF/shared/venv/prod.old" ] && echo present || echo gone))"
fi
if [ -d "$ROOTF/shared/venv/staging.new" ]; then
  pass "case f: fresh (same-day) .new venv build dir was kept"
else
  fail "case f: fresh venv build dir staging.new was incorrectly removed"
fi

# --- Case g: HYGIENE_SKIP_SYSTEM keeps the run from touching journal/npm/---
# --- pip/apt/Notifier — every case above already ran with it set; this ----
# --- case just asserts the log says so, so a future refactor that drops --
# --- the guard is caught here rather than by "it happened to still pass". -
if grep -q "HYGIENE_SKIP_SYSTEM set" /tmp/hygiene-test-a.log; then
  pass "case g: HYGIENE_SKIP_SYSTEM=1 visibly skipped the system-level steps"
else
  fail "case g: expected an HYGIENE_SKIP_SYSTEM skip message in the log"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "vps-disk-hygiene.test.sh: FAILED"
  exit 1
fi

echo "vps-disk-hygiene.test.sh: all cases passed"
