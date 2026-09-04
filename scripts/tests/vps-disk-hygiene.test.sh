#!/usr/bin/env bash
# W-134 — self-test for scripts/vps-disk-hygiene.sh.
# Builds a fake root under mktemp -d (HYGIENE_ROOT override) and exercises
# the prune/guard/dry-run logic without touching the real machine.
# HYGIENE_SKIP_SYSTEM=1 and HYGIENE_SKIP_TMP=1 are exported for the WHOLE
# file (below) so no case here ever reaches journalctl/npm/pip/apt/Notifier
# or the real /tmp — only case n clears HYGIENE_SKIP_TMP, for its own
# HYGIENE_TMP_DIR-scoped invocation, to exercise the /tmp sweep itself.
#
# Run: bash scripts/tests/vps-disk-hygiene.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HYGIENE_SCRIPT="$SCRIPT_DIR/../vps-disk-hygiene.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

# W-136 review MINOR-5: every helper process spawned by a case (setsid
# leaders and plain background helpers alike) is recorded here so a single
# EXIT trap can reap them all if the harness aborts early (a fail() with an
# unexpected downstream `exit`, Ctrl-C, a timeout) — without this, an early
# abort mid-file leaves e.g. case x's `trap '' TERM` helper running forever,
# since its own cleanup_case_x() never gets a chance to run.
declare -a HELPER_PIDS=()
cleanup_all() {
  local pid
  for pid in "${HELPER_PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    # Try a process-group kill first (correct for a setsid leader, where
    # pgid == pid); harmless no-op if the pid was never a group leader.
    # Fall back to a plain pid kill either way, in case group-kill failed.
    kill -KILL -- -"$pid" >/dev/null 2>&1 || true
    kill -KILL "$pid" >/dev/null 2>&1 || true
  done
}
trap 'cleanup_all' EXIT

# MAJOR-1 (round 3): the /tmp sweep and the journal/npm/pip/apt/Notifier
# steps are now gated by TWO SEPARATE flags. Export sane defaults for the
# WHOLE file so every case skips BOTH unless it deliberately re-enables one
# — case n needs the /tmp step to run, so it clears HYGIENE_SKIP_TMP for its
# own invocation only. HYGIENE_NOTIFIER_URL is also pointed at an
# unroutable address as a second, independent guard: even if a future edit
# drops HYGIENE_SKIP_SYSTEM from a case, the POST still cannot reach a real
# endpoint and dedupe a real day's alert.
export HYGIENE_SKIP_SYSTEM=1
export HYGIENE_SKIP_TMP=1
# W-136: the real orphaned-release-server sweep walks the WHOLE host's
# /proc — never appropriate for a case that isn't deliberately testing it.
# Only the new case s (below) clears this, scoped to its own throwaway
# HYGIENE_ORPHAN_ROOTS so it never matches a real host process.
export HYGIENE_SKIP_ORPHANS=1
export HYGIENE_NOTIFIER_URL="http://127.0.0.1:1/unroutable-test-guard"
# Round 4 (W-134): the REAL deploy_in_progress() (pgrep/proc scan of the
# whole host) must never run for a case that isn't deliberately testing it —
# it was matching an ANCESTOR shell's own command line (e.g. a `bash -n
# scripts/deploy-linux.sh` invocation made by the harness itself) and made
# 7 cases fail from a compound shell where a clean shell passed 29/29. Force
# the stub file-wide; only case p (explicit) and the new case r (sourced,
# exercises the real check) set their own value.
export HYGIENE_DEPLOY_CHECK_CMD="false"

# Harness-level guard: refuse to run the hygiene script against the real
# production deploy root — a case that forgot to build its own fresh_root
# must hard-stop instead of silently falling through to the live host path.
assert_safe_root() {
  local root="$1"
  if [ -z "$root" ] || [ "$root" = "/var/www/ipodhan" ]; then
    echo "FATAL: test case attempted to run hygiene against HYGIENE_ROOT='$root' — refusing" >&2
    exit 99
  fi
}

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

assert_safe_root "$ROOTA"
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

assert_safe_root "$ROOTB"
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

assert_safe_root "$ROOTC"
HYGIENE_ROOT="$ROOTC" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-c.log 2>&1

if [ -d "$ROOTC/releases/not-a-release-dir" ]; then
  pass "case c: non-matching directory name was left alone"
else
  fail "case c: non-matching directory 'not-a-release-dir' was removed — name-pattern guard regression"
fi

# M1: the junk dir must NOT count toward retention — with keep=3 and 4 REAL
# releases + 1 junk dir, exactly 1 real release (the oldest, C1) is pruned;
# a junk-inflated count would wrongly prune 2 real releases.
if [ ! -d "$C1" ] && [ -d "$C2" ] && [ -d "$C3" ] && [ -d "$C4" ]; then
  pass "case c: junk dir did not inflate the retention count — exactly the oldest real release (C1) was pruned"
else
  fail "case c: under-retention — expected only C1 pruned, C2/C3/C4 kept (C1=$([ -d "$C1" ] && echo present || echo gone), C2=$([ -d "$C2" ] && echo present || echo gone), C3=$([ -d "$C3" ] && echo present || echo gone), C4=$([ -d "$C4" ] && echo present || echo gone))"
fi
# MEDIUM-3: the reported "prod releases kept" count must also exclude the
# junk dir — 3 real releases survive (C2/C3/C4), not 4.
if grep -q "prod releases kept: 3 " /tmp/hygiene-test-c.log; then
  pass "case c: reported 'prod releases kept' count excludes the junk dir (3, not 4)"
else
  fail "case c: reported release count includes the junk dir — MEDIUM-3 regression ($(grep 'prod releases kept' /tmp/hygiene-test-c.log))"
fi

# --- Case d: --dry-run removes nothing ---------------------------------------
ROOTD="$(fresh_root)"
mkdir -p "$ROOTD/releases"
D1="$(make_release "$ROOTD/releases" 20260901-000000 aaaaaaa)"
D2="$(make_release "$ROOTD/releases" 20260902-000000 bbbbbbb)"
D3="$(make_release "$ROOTD/releases" 20260903-000000 ccccccc)"
D4="$(make_release "$ROOTD/releases" 20260904-000000 ddddddd)"
link_current "$ROOTD/current" "$D4"

assert_safe_root "$ROOTD"
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

assert_safe_root "$ROOTE"
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

assert_safe_root "$ROOTF"
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

# W-136 review MINOR-2: when the orphan sweep is skipped (HYGIENE_SKIP_ORPHANS=1,
# exported file-wide, is in effect for case a's run reused here), the final
# report must say so explicitly ("skipped (...)") instead of the misleading
# "found: 0" — a reader must not conclude the sweep ran and found nothing
# clean when it never ran at all.
if grep -q "HYGIENE_SKIP_ORPHANS set" /tmp/hygiene-test-a.log; then
  pass "case g: HYGIENE_SKIP_ORPHANS=1 logged its own skip reason"
else
  fail "case g: expected an HYGIENE_SKIP_ORPHANS skip message in the log"
fi
if grep -q "orphaned release servers: skipped (HYGIENE_SKIP_ORPHANS set)" /tmp/hygiene-test-a.log; then
  pass "case g: final report says orphan sweep was SKIPPED, not 'found: 0'"
else
  fail "case g: expected the final report to say 'orphaned release servers: skipped (...)', not 'found: 0'"
  cat /tmp/hygiene-test-a.log
fi

# --- Case h: C1 — --report performs NO deletions and no Notifier POST -------
ROOTH="$(fresh_root)"
mkdir -p "$ROOTH/releases"
H1="$(make_release "$ROOTH/releases" 20260901-000000 aaaaaaa)"
H2="$(make_release "$ROOTH/releases" 20260902-000000 bbbbbbb)"
H3="$(make_release "$ROOTH/releases" 20260903-000000 ccccccc)"
H4="$(make_release "$ROOTH/releases" 20260904-000000 ddddddd)"
link_current "$ROOTH/current" "$H4"

assert_safe_root "$ROOTH"
HYGIENE_ROOT="$ROOTH" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" --report >/tmp/hygiene-test-h.log 2>&1
RCH=$?

if [ "$RCH" -eq 0 ] && [ -d "$H1" ] && [ -d "$H2" ] && [ -d "$H3" ] && [ -d "$H4" ]; then
  pass "case h: --report exited 0 and deleted nothing (4 prod releases all survived)"
else
  fail "case h: --report either exited non-zero ($RCH) or deleted a release — C1 regression"
fi
if grep -q "W-134 disk hygiene report" /tmp/hygiene-test-h.log; then
  pass "case h: --report printed the final report"
else
  fail "case h: --report produced no report output"
fi

# --- Case i: C2 — trailing slash on HYGIENE_ROOT never loses 'current' ------
ROOTI="$(fresh_root)"
mkdir -p "$ROOTI/releases"
I1="$(make_release "$ROOTI/releases" 20260901-000000 aaaaaaa)"
I2="$(make_release "$ROOTI/releases" 20260902-000000 bbbbbbb)"
I3="$(make_release "$ROOTI/releases" 20260903-000000 ccccccc)"
I4="$(make_release "$ROOTI/releases" 20260904-000000 ddddddd)"
link_current "$ROOTI/current" "$I1"

assert_safe_root "$ROOTI"
HYGIENE_ROOT="$ROOTI/" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-i.log 2>&1

if [ -d "$I1" ]; then
  pass "case i: trailing slash on HYGIENE_ROOT — 'current' target (oldest release) survived"
else
  fail "case i: trailing slash on HYGIENE_ROOT — 'current' target was PRUNED — canonicalisation regression"
fi

# --- Case j: C2 — HYGIENE_ROOT reached through a symlink never loses ---------
# --- 'current' ---------------------------------------------------------------
ROOTJ_REAL="$(fresh_root)"
mkdir -p "$ROOTJ_REAL/releases"
J1="$(make_release "$ROOTJ_REAL/releases" 20260901-000000 aaaaaaa)"
J2="$(make_release "$ROOTJ_REAL/releases" 20260902-000000 bbbbbbb)"
J3="$(make_release "$ROOTJ_REAL/releases" 20260903-000000 ccccccc)"
J4="$(make_release "$ROOTJ_REAL/releases" 20260904-000000 ddddddd)"
link_current "$ROOTJ_REAL/current" "$J1"
ROOTJ_LINK="$(mktemp -u)"
if ln -sfn "$ROOTJ_REAL" "$ROOTJ_LINK" 2>/dev/null && [ -L "$ROOTJ_LINK" ]; then
  assert_safe_root "$ROOTJ_LINK"
  HYGIENE_ROOT="$ROOTJ_LINK" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-j.log 2>&1
  if [ -d "$J1" ]; then
    pass "case j: HYGIENE_ROOT reached via a symlink — 'current' target survived"
  else
    fail "case j: HYGIENE_ROOT reached via a symlink — 'current' target was PRUNED — canonicalisation regression"
  fi
else
  echo "SKIP: case j — this filesystem does not support symlinks (ln -sfn failed)"
fi

# --- Case k: C2 — a slot with no 'current' link is skipped, never pruned ----
ROOTK="$(fresh_root)"
mkdir -p "$ROOTK/releases"
K1="$(make_release "$ROOTK/releases" 20260901-000000 aaaaaaa)"
K2="$(make_release "$ROOTK/releases" 20260902-000000 bbbbbbb)"
K3="$(make_release "$ROOTK/releases" 20260903-000000 ccccccc)"
K4="$(make_release "$ROOTK/releases" 20260904-000000 ddddddd)"
# deliberately no 'current' link created for this slot

assert_safe_root "$ROOTK"
HYGIENE_ROOT="$ROOTK" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-k.log 2>&1

if [ -d "$K1" ] && [ -d "$K2" ] && [ -d "$K3" ] && [ -d "$K4" ]; then
  pass "case k: no 'current' link — slot skipped entirely, nothing pruned blind"
else
  fail "case k: no 'current' link — the slot was pruned anyway (blind-prune regression)"
fi
if grep -qi "skipping prune" /tmp/hygiene-test-k.log; then
  pass "case k: an explicit WARN/skip line was logged for the missing 'current' link"
else
  fail "case k: no skip/WARN line logged for the missing 'current' link"
fi

# --- Case l: M2 — MB-freed is actually counted (not always 0) ---------------
ROOTL="$(fresh_root)"
mkdir -p "$ROOTL/releases"
L1="$(make_release "$ROOTL/releases" 20260901-000000 aaaaaaa)"
# Give L1 real bulk so freed-KB is unambiguously > 0 once pruned.
head -c 2097152 /dev/urandom > "$ROOTL/releases/20260901-000000-aaaaaaa/bulk.bin" 2>/dev/null \
  || dd if=/dev/zero of="$ROOTL/releases/20260901-000000-aaaaaaa/bulk.bin" bs=1024 count=2048 >/dev/null 2>&1
L2="$(make_release "$ROOTL/releases" 20260902-000000 bbbbbbb)"
L3="$(make_release "$ROOTL/releases" 20260903-000000 ccccccc)"
L4="$(make_release "$ROOTL/releases" 20260904-000000 ddddddd)"
link_current "$ROOTL/current" "$L4"

assert_safe_root "$ROOTL"
HYGIENE_ROOT="$ROOTL" HYGIENE_SKIP_SYSTEM=1 bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-l.log 2>&1

FREED_LINE="$(grep -o 'freed this run: [0-9]*MB' /tmp/hygiene-test-l.log || true)"
FREED_NUM="$(echo "$FREED_LINE" | grep -o '[0-9]*' || echo 0)"
if [ -n "$FREED_NUM" ] && [ "$FREED_NUM" -gt 0 ]; then
  pass "case l: freed-MB counter is non-zero after pruning a release with real bulk ($FREED_LINE)"
else
  fail "case l: freed-MB counter stayed 0 despite pruning a ~2MB release — subshell-pipe regression"
fi

# --- Case m: M3 — safe_rm_release_dir() refuses every hostile path, --------
# --- exercised by SOURCING the script (HYGIENE_SOURCED=1 early-return) -----
# --- and calling the guard directly. ----------------------------------------
ROOTM="$(fresh_root)"
mkdir -p "$ROOTM/releases"
GUARD_FAILED=0
(
  assert_safe_root "$ROOTM"
  HYGIENE_ROOT="$ROOTM"
  HYGIENE_SOURCED=1
  # shellcheck source=/dev/null
  source "$HYGIENE_SCRIPT"

  check_refused() {
    local desc="$1" path="$2"
    if safe_rm_release_dir "$path" 2>/tmp/hygiene-test-m-guard.log; then
      echo "FAIL-INNER: $desc — safe_rm_release_dir accepted '$path'"
      return 1
    fi
    return 0
  }

  ok=1
  check_refused "empty string" "" || ok=0
  check_refused "/etc" "/etc" || ok=0
  check_refused "traversal via .." "$ROOTM/releases/../shared" || ok=0
  check_refused "trailing slash" "$ROOTM/releases/20260101-000000-aaaaaaa/" || ok=0
  mkdir -p "$ROOTM/outside-target"
  ln -sfn "$ROOTM/outside-target" "$ROOTM/releases/20260101-000000-bbbbbbb-link" 2>/dev/null || true
  check_refused "symlink inside releases pointing outside" "$ROOTM/releases/20260101-000000-bbbbbbb-link" || ok=0
  check_refused "name with a space" "$ROOTM/releases/2026 0101-000000-ccccccc" || ok=0
  [ "$ok" -eq 1 ]
) >/tmp/hygiene-test-m.log 2>&1
GUARD_RC=$?
if [ "$GUARD_RC" -eq 0 ]; then
  pass "case m: safe_rm_release_dir() refused every hostile path (empty, /etc, .., trailing slash, escaping symlink, space)"
else
  fail "case m: safe_rm_release_dir() accepted at least one hostile path — see /tmp/hygiene-test-m.log"
  cat /tmp/hygiene-test-m.log
fi

# --- Case n: MINOR(a) — /tmp sweep excludes known-safe dirs, still removes --
# --- plain old files ----------------------------------------------------------
ROOTN_TMP="$(fresh_root)"
mkdir -p "$ROOTN_TMP/puppeteer_dev_chrome_profile-XYZ" "$ROOTN_TMP/tsx-1234" "$ROOTN_TMP/node-compile-cache"
echo old > "$ROOTN_TMP/puppeteer_dev_chrome_profile-XYZ/lock.json"
echo old > "$ROOTN_TMP/tsx-1234/cache.bin"
echo old > "$ROOTN_TMP/node-compile-cache/v8.blob"
echo old > "$ROOTN_TMP/plain-old-file.log"
OLD_TS="2 days ago"
find "$ROOTN_TMP" -type f -exec touch -d '10 days ago' {} \; 2>/dev/null \
  || find "$ROOTN_TMP" -type f -exec touch -t "$(date -d '10 days ago' +%Y%m%d0000 2>/dev/null || date -v-10d +%Y%m%d0000)" {} \; 2>/dev/null || true

ROOTN="$(fresh_root)"
mkdir -p "$ROOTN/releases"
link_current "$ROOTN/current" "$(make_release "$ROOTN/releases" 20260901-000000 aaaaaaa)"
assert_safe_root "$ROOTN"
# MAJOR-1: this is the ONLY case that needs the /tmp step itself, so it
# clears HYGIENE_SKIP_TMP for this one invocation while keeping
# HYGIENE_SKIP_SYSTEM=1 — journalctl/npm/pip/apt/Notifier still never run.
HYGIENE_ROOT="$ROOTN" HYGIENE_SKIP_SYSTEM=1 HYGIENE_SKIP_TMP= HYGIENE_TMP_DIR="$ROOTN_TMP" bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-n.log 2>&1

if [ -f "$ROOTN_TMP/puppeteer_dev_chrome_profile-XYZ/lock.json" ] && [ -f "$ROOTN_TMP/tsx-1234/cache.bin" ] && [ -f "$ROOTN_TMP/node-compile-cache/v8.blob" ]; then
  pass "case n: excluded /tmp dirs (puppeteer/tsx/node-compile-cache) were left alone"
else
  fail "case n: an excluded /tmp dir's contents were deleted — MINOR(a) regression"
fi
if [ ! -f "$ROOTN_TMP/plain-old-file.log" ]; then
  pass "case n: a plain old file outside the excluded dirs was still removed"
else
  fail "case n: plain-old-file.log (10 days old, not excluded) was NOT removed"
fi

# --- Case o: MINOR(c) — concurrency lock: a second run skips while the ------
# --- lock is held --------------------------------------------------------------
ROOTO="$(fresh_root)"
mkdir -p "$ROOTO/releases"
O1="$(make_release "$ROOTO/releases" 20260901-000000 aaaaaaa)"
O2="$(make_release "$ROOTO/releases" 20260902-000000 bbbbbbb)"
O3="$(make_release "$ROOTO/releases" 20260903-000000 ccccccc)"
O4="$(make_release "$ROOTO/releases" 20260904-000000 ddddddd)"
link_current "$ROOTO/current" "$O4"
LOCKO="$(mktemp -u)"
mkdir -p "$LOCKO"
# MEDIUM-2: a lock held by a LIVE pid must be respected. Use $$ (this test
# script's own pid) as the holder — it is guaranteed alive for the duration
# of this run, so `kill -0` on it succeeds and the lock is never reclaimed.
echo "$$" > "$LOCKO/pid"

assert_safe_root "$ROOTO"
HYGIENE_ROOT="$ROOTO" HYGIENE_SKIP_SYSTEM=1 HYGIENE_LOCK_DIR="$LOCKO" bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-o.log 2>&1
RCO=$?
rm -rf "$LOCKO" 2>/dev/null || true

if [ "$RCO" -eq 0 ] && [ -d "$O1" ] && [ -d "$O4" ]; then
  pass "case o: a held lock (live pid) made the run skip cleanly (exit 0, nothing pruned)"
else
  fail "case o: a held lock did not stop the run as expected (rc=$RCO)"
fi
if grep -qi "lock" /tmp/hygiene-test-o.log; then
  pass "case o: the lock skip was logged"
else
  fail "case o: no lock-related log line found"
fi

# --- Case q: MEDIUM-2 — a lock left behind by a dead/killed run (stale PID) -
# --- is reclaimed, and the run proceeds normally instead of wedging forever -
ROOTQ="$(fresh_root)"
mkdir -p "$ROOTQ/releases"
Q1="$(make_release "$ROOTQ/releases" 20260901-000000 aaaaaaa)"
Q2="$(make_release "$ROOTQ/releases" 20260902-000000 bbbbbbb)"
Q3="$(make_release "$ROOTQ/releases" 20260903-000000 ccccccc)"
Q4="$(make_release "$ROOTQ/releases" 20260904-000000 ddddddd)"
link_current "$ROOTQ/current" "$Q4"
LOCKQ="$(mktemp -u)"
mkdir -p "$LOCKQ"
# A PID number picked to be implausible as a live process on the test box.
echo "999999" > "$LOCKQ/pid"

assert_safe_root "$ROOTQ"
HYGIENE_ROOT="$ROOTQ" HYGIENE_SKIP_SYSTEM=1 HYGIENE_LOCK_DIR="$LOCKQ" bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-q.log 2>&1
RCQ=$?
rm -rf "$LOCKQ" 2>/dev/null || true

if [ "$RCQ" -eq 0 ] && [ ! -d "$Q1" ] && [ -d "$Q4" ]; then
  pass "case q: a stale lock (dead pid) was reclaimed and the prune ran normally"
else
  fail "case q: stale-lock reclaim did not happen as expected (rc=$RCQ, Q1=$([ -d "$Q1" ] && echo present || echo gone))"
fi
if grep -qi "reclaiming stale lock" /tmp/hygiene-test-q.log; then
  pass "case q: the reclaim was logged"
else
  fail "case q: no reclaim log line found"
fi

# --- Case p: MINOR(c) — release prune is skipped while a deploy is ----------
# --- detected as in-progress (env-overridable check, no real pgrep needed) --
ROOTP="$(fresh_root)"
mkdir -p "$ROOTP/releases"
P1="$(make_release "$ROOTP/releases" 20260901-000000 aaaaaaa)"
P2="$(make_release "$ROOTP/releases" 20260902-000000 bbbbbbb)"
P3="$(make_release "$ROOTP/releases" 20260903-000000 ccccccc)"
P4="$(make_release "$ROOTP/releases" 20260904-000000 ddddddd)"
link_current "$ROOTP/current" "$P4"

assert_safe_root "$ROOTP"
HYGIENE_ROOT="$ROOTP" HYGIENE_SKIP_SYSTEM=1 HYGIENE_DEPLOY_CHECK_CMD="true" bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-p.log 2>&1
RCP=$?

if [ "$RCP" -eq 0 ] && [ -d "$P1" ] && [ -d "$P2" ] && [ -d "$P3" ] && [ -d "$P4" ]; then
  pass "case p: prune skipped while a deploy is detected in progress"
else
  fail "case p: prune ran even though a deploy was detected in progress (rc=$RCP)"
fi
if grep -qi "deploy in progress" /tmp/hygiene-test-p.log; then
  pass "case p: the deploy-in-progress skip was logged"
else
  fail "case p: no 'deploy in progress' log line found"
fi
# MEDIUM-3: REPORT_LINES must actually reach the printed report (and, via
# REPORT_BODY, the Notifier payload) — not just the running log.
if grep -q "notes:" /tmp/hygiene-test-p.log && grep -q "release prune skipped: deploy in progress" /tmp/hygiene-test-p.log; then
  pass "case p: the final report carries the 'prune skipped: deploy in progress' reason"
else
  fail "case p: the final report is missing the prune-skipped reason — MEDIUM-3 regression"
fi

# Sanity: with the deploy-check forced FALSE, pruning still happens normally.
ROOTP2="$(fresh_root)"
mkdir -p "$ROOTP2/releases"
P2_1="$(make_release "$ROOTP2/releases" 20260901-000000 aaaaaaa)"
make_release "$ROOTP2/releases" 20260902-000000 bbbbbbb >/dev/null
make_release "$ROOTP2/releases" 20260903-000000 ccccccc >/dev/null
P2_4="$(make_release "$ROOTP2/releases" 20260904-000000 ddddddd)"
link_current "$ROOTP2/current" "$P2_4"
assert_safe_root "$ROOTP2"
HYGIENE_ROOT="$ROOTP2" HYGIENE_SKIP_SYSTEM=1 HYGIENE_DEPLOY_CHECK_CMD="false" bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-p2.log 2>&1
if [ ! -d "$P2_1" ]; then
  pass "case p: with no deploy in progress, pruning still runs normally"
else
  fail "case p: pruning did not run when the deploy-check was forced false"
fi

# --- Case r: round 4 — the REAL deploy_in_progress() (pgrep/proc, no -----
# --- HYGIENE_DEPLOY_CHECK_CMD stub) must ignore its own process tree and ---
# --- any command line that merely MENTIONS the deploy script as a plain ----
# --- argument to a non-deploy command (bash -n, less, grep, ...). Only ------
# --- meaningful on a host with pgrep or /proc/*/cmdline (both branches of --
# --- deploy_in_progress() need one of them to see another process's ---
# --- command line at all) — this test host has neither, so the guard below
# --- reports a skip instead of a false pass/fail.
if command -v pgrep >/dev/null 2>&1 || [ -r /proc/1/cmdline ]; then
  ROOTR="$(fresh_root)"
  assert_safe_root "$ROOTR"
  HELPER_PID=""
  cleanup_case_r() {
    [ -n "$HELPER_PID" ] && kill "$HELPER_PID" >/dev/null 2>&1 || true
    wait "$HELPER_PID" 2>/dev/null || true
  }

  # r1: a background process whose command line contains the deploy script
  # path only as an ARGUMENT OF A DIFFERENT COMMAND (the exact 2026-09-04
  # incident shape: `bash -n scripts/deploy-linux.sh`) must NOT be treated
  # as a deploy in progress.
  bash -c 'exec -a "bash -n scripts/deploy-linux.sh --check" sleep 30' 2>/dev/null &
  HELPER_PID=$!
  sleep 0.3
  if ! kill -0 "$HELPER_PID" 2>/dev/null; then
    fail "case r1: helper did not start (exec -a unsupported on this /bin/sh?) — cannot exercise the real check"
  else
  (
    HYGIENE_ROOT="$ROOTR"
    HYGIENE_SOURCED=1
    unset HYGIENE_DEPLOY_CHECK_CMD
    # shellcheck source=/dev/null
    source "$HYGIENE_SCRIPT"
    if deploy_in_progress; then
      echo "FAIL-INNER: r1 — deploy_in_progress() matched a non-deploy command line that merely mentions the script"
      exit 1
    fi
    exit 0
  ) >/tmp/hygiene-test-r1.log 2>&1
  RCR1=$?
  if [ "$RCR1" -eq 0 ]; then
    pass "case r1: deploy_in_progress() ignores a non-deploy command line mentioning the script (round-4 regression guard)"
  else
    fail "case r1: deploy_in_progress() false-positived on a non-deploy command line — see /tmp/hygiene-test-r1.log"
  fi
  fi
  cleanup_case_r

  # r2: a background process shaped like the REAL invocation
  # (`bash scripts/deploy-linux.sh staging <ref>`, per deploy-linux.yml) IS
  # detected.
  bash -c 'exec -a "bash scripts/deploy-linux.sh staging deadbeef" sleep 30' 2>/dev/null &
  HELPER_PID=$!
  sleep 0.3
  if ! kill -0 "$HELPER_PID" 2>/dev/null; then
    fail "case r2: helper did not start (exec -a unsupported on this /bin/sh?) — cannot exercise the real check"
  else
  (
    HYGIENE_ROOT="$ROOTR"
    HYGIENE_SOURCED=1
    unset HYGIENE_DEPLOY_CHECK_CMD
    # shellcheck source=/dev/null
    source "$HYGIENE_SCRIPT"
    deploy_in_progress
  ) >/tmp/hygiene-test-r2.log 2>&1
  RCR2=$?
  if [ "$RCR2" -eq 0 ]; then
    pass "case r2: deploy_in_progress() detects the real deploy-linux.yml invocation shape"
  else
    fail "case r2: deploy_in_progress() missed a genuine deploy in progress — see /tmp/hygiene-test-r2.log"
  fi
  fi
  cleanup_case_r
else
  pass "case r: skipped — no pgrep and no /proc/*/cmdline on this host, so deploy_in_progress() can only be exercised via HYGIENE_DEPLOY_CHECK_CMD (case p)"
fi

# --- Case s: W-136 — detect_orphaned_release_servers() lists a next-server- --
# --- shaped process whose cwd resolves to a DELETED release dir, and does ---
# --- NOT list an otherwise-identical process whose cwd still exists. Only --
# --- meaningful on a host with /proc (this test host — a Windows dev box --
# --- under MSYS bash — has none, so it reports a skip instead of a false --
# --- pass/fail, mirroring case r above).
if [ -d /proc ]; then
  ROOTS_S="$(fresh_root)"
  assert_safe_root "$ROOTS_S"
  mkdir -p "$ROOTS_S/releases"
  DELETED_DIR_S="$(make_release "$ROOTS_S/releases" 20260821-000000 ffffffe)"
  NORMAL_DIR_S="$(make_release "$ROOTS_S/releases" 20260822-000000 ffffffd)"
  HELPER_PID_S=""
  NORMAL_PID_S=""
  cleanup_case_s() {
    [ -n "$HELPER_PID_S" ] && kill "$HELPER_PID_S" >/dev/null 2>&1 || true
    [ -n "$NORMAL_PID_S" ] && kill "$NORMAL_PID_S" >/dev/null 2>&1 || true
    wait "$HELPER_PID_S" "$NORMAL_PID_S" 2>/dev/null || true
    rm -rf -- "$NORMAL_DIR_S" 2>/dev/null || true
  }

  ( cd "$DELETED_DIR_S" && exec -a "next-server (v18.2.0)" sleep 30 ) 2>/dev/null &
  HELPER_PID_S=$!
  HELPER_PIDS+=("$HELPER_PID_S")
  ( cd "$NORMAL_DIR_S" && exec -a "next-server (normal, cwd survives)" sleep 30 ) 2>/dev/null &
  NORMAL_PID_S=$!
  HELPER_PIDS+=("$NORMAL_PID_S")
  sleep 0.3

  if ! kill -0 "$HELPER_PID_S" 2>/dev/null || ! kill -0 "$NORMAL_PID_S" 2>/dev/null; then
    fail "case s: a helper did not start (exec -a unsupported on this /bin/sh?) — cannot exercise the orphan sweep"
    cleanup_case_s
  else
    # Delete ONLY the first helper's cwd — its process keeps running with a
    # now-nonexistent cwd (the exact 2026-08-21 shape: an aborted deploy's
    # release dir deleted out from under a still-running next-server).
    rm -rf -- "$DELETED_DIR_S"

    DETECT_OUT_S="$(
      HYGIENE_ROOT="$ROOTS_S"
      HYGIENE_SOURCED=1
      HYGIENE_ORPHAN_ROOTS="$ROOTS_S/releases"
      # shellcheck source=/dev/null
      source "$HYGIENE_SCRIPT"
      detect_orphaned_release_servers
    )"

    if printf '%s\n' "$DETECT_OUT_S" | grep -q "^$HELPER_PID_S "; then
      pass "case s: detect_orphaned_release_servers() lists the orphaned (deleted-cwd) next-server pid"
    else
      fail "case s: detect_orphaned_release_servers() did NOT list the orphaned pid $HELPER_PID_S — output: $DETECT_OUT_S"
    fi

    if printf '%s\n' "$DETECT_OUT_S" | grep -q "^$NORMAL_PID_S "; then
      fail "case s: detect_orphaned_release_servers() wrongly listed a normal process $NORMAL_PID_S whose cwd still exists"
    else
      pass "case s: detect_orphaned_release_servers() did NOT list a normal process whose cwd still exists"
    fi
    cleanup_case_s
  fi
else
  pass "case s: skipped — no /proc on this host, so detect_orphaned_release_servers() is a no-op by design (Windows dev box)"
fi

# --- Case t: W-136 round 2 (MAJOR-3) — a TRUE group leader (setsid'd, ------
# --- pgid == pid — the real pre-flip-probe shape) orphan is killed via ----
# --- TERM escalating to KILL, and reported "killed" only once verified. --
# --- Only meaningful with /proc + setsid (Linux) — Windows/MSYS reports --
# --- a skip, mirroring case r/s.
if [ -d /proc ] && command -v setsid >/dev/null 2>&1; then
  ROOTT="$(fresh_root)"
  assert_safe_root "$ROOTT"
  mkdir -p "$ROOTT/releases"
  DELETED_DIR_T="$(make_release "$ROOTT/releases" 20260823-000000 ffffffc)"
  HELPER_PID_T=""
  cleanup_case_t() {
    [ -n "$HELPER_PID_T" ] && kill -KILL "$HELPER_PID_T" >/dev/null 2>&1 || true
    wait "$HELPER_PID_T" 2>/dev/null || true
  }
  DELETED_DIR_T="$DELETED_DIR_T" setsid bash -c 'cd "$DELETED_DIR_T" && exec -a "next-server (v18.2.0)" sleep 60' &
  HELPER_PID_T=$!
  HELPER_PIDS+=("$HELPER_PID_T")
  sleep 0.3
  if ! kill -0 "$HELPER_PID_T" 2>/dev/null; then
    fail "case t: helper did not start (setsid unsupported on this host?) — cannot exercise the group-kill path"
  else
    rm -rf -- "$DELETED_DIR_T"
    HYGIENE_ROOT="$ROOTT" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTT/releases" HYGIENE_DEPLOY_CHECK_CMD="false" \
      bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-t.log 2>&1
    sleep 0.5
    if kill -0 "$HELPER_PID_T" 2>/dev/null; then
      fail "case t: group-leader orphan (pgid==pid) survived the sweep — expected a group TERM/KILL"
      cat /tmp/hygiene-test-t.log
    else
      pass "case t: group-leader orphan (pgid==pid, the setsid'd-probe shape) was killed via the whole group"
    fi
    if grep -q "orphaned release server killed" /tmp/hygiene-test-t.log; then
      pass "case t: the report/log recorded 'killed' (post-verification)"
    else
      fail "case t: expected the report/log to record the kill"
    fi
  fi
  cleanup_case_t
else
  echo "SKIP: case t — no /proc or no setsid on this host (Windows dev box)"
fi

# --- Case u: W-136 round 2 (MAJOR-1/MINOR-b) — a helper spawned WITHOUT ---
# --- setsid shares THIS shell's process group with a decoy sibling. -------
# --- Only the orphan (matched by pid) may be killed; the decoy sharing ----
# --- the group must survive — proves the sweep never issues a group-kill --
# --- for a non-leader (which would take the group, not just the orphan). -
if [ -d /proc ]; then
  ROOTU="$(fresh_root)"
  assert_safe_root "$ROOTU"
  mkdir -p "$ROOTU/releases"
  DELETED_DIR_U="$(make_release "$ROOTU/releases" 20260824-000000 ffffffb)"
  NORMAL_DIR_U="$(mktemp -d)"
  HELPER_PID_U=""
  DECOY_PID_U=""
  cleanup_case_u() {
    [ -n "$HELPER_PID_U" ] && kill -KILL "$HELPER_PID_U" >/dev/null 2>&1 || true
    [ -n "$DECOY_PID_U" ] && kill -KILL "$DECOY_PID_U" >/dev/null 2>&1 || true
    wait "$HELPER_PID_U" "$DECOY_PID_U" 2>/dev/null || true
    rm -rf -- "$NORMAL_DIR_U" 2>/dev/null || true
  }
  ( cd "$NORMAL_DIR_U" && exec -a "decoy-sibling-process" sleep 30 ) &
  DECOY_PID_U=$!
  HELPER_PIDS+=("$DECOY_PID_U")
  ( cd "$DELETED_DIR_U" && exec -a "next-server (v18.2.0)" sleep 30 ) &
  HELPER_PID_U=$!
  HELPER_PIDS+=("$HELPER_PID_U")
  sleep 0.3
  if ! kill -0 "$HELPER_PID_U" 2>/dev/null || ! kill -0 "$DECOY_PID_U" 2>/dev/null; then
    fail "case u: a helper did not start — cannot exercise the pid-only-kill path"
  else
    HPGID_U="$(ps -o pgid= -p "$HELPER_PID_U" 2>/dev/null | tr -d ' ')"
    if [ "$HPGID_U" = "$HELPER_PID_U" ]; then
      fail "case u: setup error — helper unexpectedly became its own group leader; this case needs it to share the shell's group"
      cleanup_case_u
    else
      rm -rf -- "$DELETED_DIR_U"
      HYGIENE_ROOT="$ROOTU" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTU/releases" HYGIENE_DEPLOY_CHECK_CMD="false" \
        bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-u.log 2>&1
      sleep 0.5
      if kill -0 "$HELPER_PID_U" 2>/dev/null; then
        fail "case u: non-leader orphan survived the sweep — expected a pid-only TERM/KILL"
      else
        pass "case u: non-leader orphan (pgid!=pid) was killed by PID only"
      fi
      if kill -0 "$DECOY_PID_U" 2>/dev/null; then
        pass "case u: sibling process sharing the group was NOT touched — no wrongful group-kill"
      else
        fail "case u: sibling process sharing the group was killed — a group-kill was wrongly issued for a non-leader"
      fi
      cleanup_case_u
    fi
  fi
else
  echo "SKIP: case u — no /proc on this host (Windows dev box)"
fi

# --- Case v: W-136 round 2 (MAJOR-1) — a candidate whose process-GROUP ----
# --- LEADER's cmdline matches pm2 (simulated: setsid'd process renamed ----
# --- "PM2 v7: God Daemon" that forks an orphan-shaped "next-server" -------
# --- child sharing its group) must be LEFT ALONE, never signalled — pm2 ---
# --- owns its children; the sweep only reaps true orphans.
if [ -d /proc ] && command -v setsid >/dev/null 2>&1; then
  ROOTV="$(fresh_root)"
  assert_safe_root "$ROOTV"
  mkdir -p "$ROOTV/releases"
  DELETED_DIR_V="$(make_release "$ROOTV/releases" 20260825-000000 ffffffa)"
  CHILDPIDFILE_V="$(mktemp)"
  LEADER_PID_V=""
  CHILD_PID_V=""
  cleanup_case_v() {
    [ -n "$CHILD_PID_V" ] && kill -KILL "$CHILD_PID_V" >/dev/null 2>&1 || true
    [ -n "$LEADER_PID_V" ] && kill -KILL -- -"$LEADER_PID_V" >/dev/null 2>&1 || true
    [ -n "$LEADER_PID_V" ] && kill -KILL "$LEADER_PID_V" >/dev/null 2>&1 || true
    wait "$LEADER_PID_V" 2>/dev/null || true
    rm -f "$CHILDPIDFILE_V"
  }
  # `exec -a NAME "$0" ...` on a SCRIPT does NOT rename what `ps -o cmd=`
  # reports — the kernel/bash re-execs the #!interpreter, so the visible
  # cmdline stays "bash /path/to/script ..." and the string "PM2" never
  # appears (diagnosed on the VPS: case v failed both assertions with the
  # old script-based fixture). `exec -a` only sticks when the renamed
  # target is a real BINARY — so exec -a straight onto the `bash` binary
  # itself, which then runs a -c string that forks the (real) orphan child.
  setsid bash -c 'exec -a "PM2 v7: God Daemon" bash -c "( cd \"\$0\" && exec -a \"next-server (v18.2.0)\" sleep 60 ) & echo \$! > \"\$1\"; wait" "$0" "$1"' "$DELETED_DIR_V" "$CHILDPIDFILE_V" &
  LEADER_PID_V=$!
  HELPER_PIDS+=("$LEADER_PID_V")
  sleep 0.5
  CHILD_PID_V="$(cat "$CHILDPIDFILE_V" 2>/dev/null || true)"
  if [ -z "$CHILD_PID_V" ] || ! kill -0 "$CHILD_PID_V" 2>/dev/null; then
    fail "case v: pm2-leader/child setup did not start — cannot exercise the pm2-guard path"
  else
    # Fixture self-check: a fixture that cannot actually represent pm2 must
    # never be allowed to pass (that was the round-2 bug — the assertions
    # below looked meaningful but were exercising a fixture that could never
    # match). Verify BEFORE running the sweep that the leader's cmdline
    # really shows PM2 and the child's ppid really is the leader.
    LEADER_CMD_CHECK_V="$(ps -o cmd= -p "$LEADER_PID_V" 2>/dev/null || true)"
    CHILD_PPID_CHECK_V="$(ps -o ppid= -p "$CHILD_PID_V" 2>/dev/null | tr -d ' ' || true)"
    if ! printf '%s' "$LEADER_CMD_CHECK_V" | grep -q PM2; then
      fail "case v fixture: leader cmdline does not show PM2 — cmdline was: $LEADER_CMD_CHECK_V"
    elif [ "$CHILD_PPID_CHECK_V" != "$LEADER_PID_V" ]; then
      fail "case v fixture: child's ppid ($CHILD_PPID_CHECK_V) is not the leader ($LEADER_PID_V)"
    else
      rm -rf -- "$DELETED_DIR_V"
      HYGIENE_ROOT="$ROOTV" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTV/releases" HYGIENE_DEPLOY_CHECK_CMD="false" \
        bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-v.log 2>&1
      sleep 0.5
      if kill -0 "$CHILD_PID_V" 2>/dev/null; then
        pass "case v: pm2-managed orphan-shaped process was LEFT ALONE (not killed)"
      else
        fail "case v: pm2-managed process was killed — the sweep must never signal a pm2-owned group"
      fi
      if grep -qi "left to pm2" /tmp/hygiene-test-v.log; then
        pass "case v: a loud WARN naming pm2 was logged for the skipped candidate"
      else
        fail "case v: expected a WARN log line naming pm2 for the skipped candidate"
        cat /tmp/hygiene-test-v.log
      fi
    fi
  fi
  cleanup_case_v
else
  echo "SKIP: case v — no /proc or no setsid on this host (Windows dev box)"
fi

# --- Case w: W-136 round 2 (MAJOR-2) — the orphan sweep is skipped ---------
# --- entirely while a deploy is in progress (HYGIENE_DEPLOY_CHECK_CMD), ---
# --- same guard as the release prune — nothing is killed and the skip is --
# --- logged/reported.
if [ -d /proc ] && command -v setsid >/dev/null 2>&1; then
  ROOTW="$(fresh_root)"
  assert_safe_root "$ROOTW"
  mkdir -p "$ROOTW/releases"
  DELETED_DIR_W="$(make_release "$ROOTW/releases" 20260826-000000 fffffe9)"
  HELPER_PID_W=""
  cleanup_case_w() {
    [ -n "$HELPER_PID_W" ] && kill -KILL "$HELPER_PID_W" >/dev/null 2>&1 || true
    wait "$HELPER_PID_W" 2>/dev/null || true
  }
  DELETED_DIR_W="$DELETED_DIR_W" setsid bash -c 'cd "$DELETED_DIR_W" && exec -a "next-server (v18.2.0)" sleep 30' &
  HELPER_PID_W=$!
  HELPER_PIDS+=("$HELPER_PID_W")
  sleep 0.3
  if ! kill -0 "$HELPER_PID_W" 2>/dev/null; then
    fail "case w: helper did not start — cannot exercise the deploy-in-progress skip"
  else
    rm -rf -- "$DELETED_DIR_W"
    HYGIENE_ROOT="$ROOTW" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTW/releases" HYGIENE_DEPLOY_CHECK_CMD="true" \
      bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-w.log 2>&1
    sleep 0.5
    if kill -0 "$HELPER_PID_W" 2>/dev/null; then
      pass "case w: orphan sweep skipped — nothing killed while a deploy is in progress"
    else
      fail "case w: orphan was killed even though HYGIENE_DEPLOY_CHECK_CMD reported a deploy in progress"
    fi
    if grep -qi "orphan sweep skipped" /tmp/hygiene-test-w.log; then
      pass "case w: the skip was logged/reported with the deploy-in-progress reason"
    else
      fail "case w: expected a logged/reported reason for skipping the orphan sweep"
      cat /tmp/hygiene-test-w.log
    fi
  fi
  cleanup_case_w
else
  echo "SKIP: case w — no /proc or no setsid on this host (Windows dev box)"
fi

# --- Case x: W-136 round 2 (MAJOR-3) — a helper that IGNORES SIGTERM ------
# --- (trap '' TERM) must still end up dead via escalation to SIGKILL, and -
# --- only be reported "killed" once that succeeded (never before/regardless
# --- of outcome).
if [ -d /proc ] && command -v setsid >/dev/null 2>&1; then
  ROOTX="$(fresh_root)"
  assert_safe_root "$ROOTX"
  mkdir -p "$ROOTX/releases"
  DELETED_DIR_X="$(make_release "$ROOTX/releases" 20260827-000000 fffffe8)"
  TRAP_SCRIPT_X="$(mktemp)"
  cat > "$TRAP_SCRIPT_X" <<'EOS'
#!/usr/bin/env bash
trap '' TERM
exec -a "next-server (v18.2.0)" bash -c 'trap "" TERM; while true; do sleep 1; done'
EOS
  chmod +x "$TRAP_SCRIPT_X"
  HELPER_PID_X=""
  cleanup_case_x() {
    [ -n "$HELPER_PID_X" ] && kill -KILL "$HELPER_PID_X" >/dev/null 2>&1 || true
    wait "$HELPER_PID_X" 2>/dev/null || true
    rm -f "$TRAP_SCRIPT_X"
  }
  DELETED_DIR_X="$DELETED_DIR_X" TRAP_SCRIPT_X="$TRAP_SCRIPT_X" setsid bash -c 'cd "$DELETED_DIR_X" && exec "$TRAP_SCRIPT_X"' &
  HELPER_PID_X=$!
  HELPER_PIDS+=("$HELPER_PID_X")
  sleep 0.3
  if ! kill -0 "$HELPER_PID_X" 2>/dev/null; then
    fail "case x: TERM-trapping helper did not start — cannot exercise the KILL-escalation path"
  else
    rm -rf -- "$DELETED_DIR_X"
    HYGIENE_ROOT="$ROOTX" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTX/releases" HYGIENE_DEPLOY_CHECK_CMD="false" \
      bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-x.log 2>&1
    sleep 0.5
    if kill -0 "$HELPER_PID_X" 2>/dev/null; then
      fail "case x: TERM-trapping orphan SURVIVED — expected escalation to KILL after the wait"
      cat /tmp/hygiene-test-x.log
    else
      pass "case x: TERM-trapping orphan was reaped via escalation to SIGKILL"
    fi
    if grep -q "orphaned release server killed" /tmp/hygiene-test-x.log; then
      pass "case x: the report recorded 'killed' only after the KILL escalation actually succeeded"
    else
      fail "case x: expected the report to record the kill after escalation"
    fi
  fi
  cleanup_case_x
else
  echo "SKIP: case x — no /proc or no setsid on this host (Windows dev box)"
fi

# --- Case y: W-136 review MINOR-1 — group-wide kill verify. A setsid ------
# --- leader (the matched next-server orphan) with a CHILD that traps TERM -
# --- and ignores it: a leader-only `kill -0 $opid` check would report the --
# --- group dead once the leader alone exits, while the TERM-ignoring child
# --- lives on. After the sweep BOTH must be dead, and "killed" must only --
# --- be logged once the whole group (not just the leader) is verified gone.
if [ -d /proc ] && command -v setsid >/dev/null 2>&1; then
  ROOTY="$(fresh_root)"
  assert_safe_root "$ROOTY"
  mkdir -p "$ROOTY/releases"
  DELETED_DIR_Y="$(make_release "$ROOTY/releases" 20260828-000000 fffffe7)"
  CHILDPIDFILE_Y="$(mktemp -u)"
  LEADER_SCRIPT_Y="$(mktemp)"
  cat > "$LEADER_SCRIPT_Y" <<'EOS'
#!/usr/bin/env bash
cd "$1"
bash -c 'trap "" TERM; while true; do sleep 1; done' &
echo $! > "$2"
exec -a "next-server (v18.2.0)" sleep 60
EOS
  chmod +x "$LEADER_SCRIPT_Y"
  LEADER_PID_Y=""
  cleanup_case_y() {
    [ -n "$CHILD_PID_Y" ] && kill -KILL "$CHILD_PID_Y" >/dev/null 2>&1 || true
    [ -n "$LEADER_PID_Y" ] && kill -KILL -- -"$LEADER_PID_Y" >/dev/null 2>&1 || true
    [ -n "$LEADER_PID_Y" ] && kill -KILL "$LEADER_PID_Y" >/dev/null 2>&1 || true
    wait "$LEADER_PID_Y" 2>/dev/null || true
    rm -f "$LEADER_SCRIPT_Y" "$CHILDPIDFILE_Y"
  }
  DELETED_DIR_Y="$DELETED_DIR_Y" CHILDPIDFILE_Y="$CHILDPIDFILE_Y" setsid "$LEADER_SCRIPT_Y" "$DELETED_DIR_Y" "$CHILDPIDFILE_Y" &
  LEADER_PID_Y=$!
  HELPER_PIDS+=("$LEADER_PID_Y")
  sleep 0.4
  CHILD_PID_Y="$(cat "$CHILDPIDFILE_Y" 2>/dev/null || true)"
  HELPER_PIDS+=("$CHILD_PID_Y")
  if [ -z "$CHILD_PID_Y" ] || ! kill -0 "$LEADER_PID_Y" 2>/dev/null || ! kill -0 "$CHILD_PID_Y" 2>/dev/null; then
    fail "case y: leader/TERM-trapping-child setup did not start — cannot exercise the group-wide verify"
  else
    rm -rf -- "$DELETED_DIR_Y"
    HYGIENE_ROOT="$ROOTY" HYGIENE_SKIP_ORPHANS= HYGIENE_ORPHAN_ROOTS="$ROOTY/releases" HYGIENE_DEPLOY_CHECK_CMD="false" \
      bash "$HYGIENE_SCRIPT" >/tmp/hygiene-test-y.log 2>&1
    sleep 0.5
    if kill -0 "$LEADER_PID_Y" 2>/dev/null || kill -0 "$CHILD_PID_Y" 2>/dev/null; then
      fail "case y: leader and/or TERM-trapping child SURVIVED — expected the whole group verified/reaped"
      cat /tmp/hygiene-test-y.log
    else
      pass "case y: group-wide verify killed both the leader and the TERM-trapping child"
    fi
    if grep -q "orphaned release server killed" /tmp/hygiene-test-y.log && ! grep -q "SURVIVED" /tmp/hygiene-test-y.log; then
      pass "case y: the report recorded 'killed' only once the whole group was verified gone"
    else
      fail "case y: expected 'killed' with no SURVIVED line once the group was actually clean"
      cat /tmp/hygiene-test-y.log
    fi
  fi
  cleanup_case_y
else
  echo "SKIP: case y — no /proc or no setsid on this host (Windows dev box)"
fi

if [ "$FAILED" -ne 0 ]; then
  echo "vps-disk-hygiene.test.sh: FAILED"
  exit 1
fi

echo "vps-disk-hygiene.test.sh: all cases passed"
