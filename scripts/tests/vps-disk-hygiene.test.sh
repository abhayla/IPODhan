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

if [ "$FAILED" -ne 0 ]; then
  echo "vps-disk-hygiene.test.sh: FAILED"
  exit 1
fi

echo "vps-disk-hygiene.test.sh: all cases passed"
