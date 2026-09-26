#!/usr/bin/env bash
# Stage 3 item 3 slice S5 — self-test for scripts/ops/deploy-config.sh
# against a fake $ROOT and a throwaway fixture git repo (never the real
# origin/main or the real VPS layout).
#
# Run: bash scripts/tests/deploy-config.test.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_CONFIG="$SCRIPT_DIR/../ops/deploy-config.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

fresh_dir() {
  local d
  d="$(mktemp -d)"
  printf '%s' "$d"
}

# MINOR-7: case10 relies on its temp dir having no '.git' anywhere above
# it (mktemp -d alone never guarantees that — it depends on TMPDIR not
# itself living under a git checkout). Walk up to the filesystem root and
# fail loudly if one is found, so the case guards the real "no-git tree"
# shape instead of silently assuming it.
assert_no_git_above() {
  local dir="$1"
  dir="$(cd "$dir" && pwd)"
  while :; do
    if [ -e "$dir/.git" ]; then
      echo "PREMISE VIOLATION: found $dir/.git — case10's no-git-tree assumption is false in this environment" >&2
      return 1
    fi
    [ "$dir" = "/" ] && break
    dir="$(dirname "$dir")"
  done
  return 0
}

# --------------------------------------------------------------- fixture repo
# A tiny throwaway git repo standing in for the real IPODhan repo/origin.
# It has its own "origin/main" branch (a local ref, not a network remote —
# DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 tells deploy-config.sh not to run a
# real 'git fetch origin main' against it) so the lineage check has
# something real to walk.
build_fixture_repo() {
  local repo
  repo="$(fresh_dir)"
  (
    cd "$repo"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    # F6 (#752): deploy-config.sh now asserts the resolved repo's origin
    # is the real IPODhan remote, so every fixture repo needs a real
    # 'origin' remote matching EXPECTED_REPO_REMOTE_RE — otherwise every
    # existing case would fail the new identity check, not just the ones
    # this fixture was built for.
    git remote add origin "https://github.com/abhayla/IPODhan.git"
    mkdir -p scraper/config
    echo '{"version":1,"fields":{}}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "v1 manifest"
    # Only refs/remotes/origin/main is created — NOT a local branch of the
    # same name — because git treats 'origin/main' as ambiguous (and
    # resolves it to the wrong ref) when both exist simultaneously.
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  printf '%s' "$repo"
}

# Adds a second commit ON the fixture's main (so it IS on origin/main) that
# changes the manifest content, returns its sha.
commit_v2_on_main() {
  local repo="$1" sha
  (
    cd "$repo"
    echo '{"version":2,"fields":{}}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "v2 manifest"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  sha="$(cd "$repo" && git rev-parse HEAD)"
  printf '%s' "$sha"
}

# A commit that exists in the repo's object db but is NOT reachable from
# origin/main (an unmerged branch) — for the lineage-refusal case.
commit_unmerged() {
  local repo="$1" sha base
  base="$(cd "$repo" && git rev-parse HEAD)"
  (
    cd "$repo"
    git checkout -q -b unmerged-branch
    echo '{"version":99,"fields":{}}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "unmerged"
  ) >/dev/null 2>&1
  sha="$(cd "$repo" && git rev-parse unmerged-branch)"
  # Detach back to the pre-branch commit rather than checking out a
  # branch literally named 'main'/'master' (which would collide with
  # refs/remotes/origin/main the same way a local 'origin/main' branch
  # does, on some git versions' ambiguous-ref resolution).
  (cd "$repo" && git checkout -q "$base") >/dev/null 2>&1
  printf '%s' "$sha"
}

# A fixture repo whose 'origin' is exactly the given URL (case21/case22) —
# for probing EXPECTED_REPO_REMOTE_RE and credential redaction against
# every origin shape the guard must accept or refuse.
build_repo_with_origin() {
  local origin_url="$1" repo
  repo="$(fresh_dir)"
  (
    cd "$repo"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git remote add origin "$origin_url"
    mkdir -p scraper/config
    echo '{"version":1,"fields":{}}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "v1"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  printf '%s' "$repo"
}

run_deploy() {
  # run_deploy <repo> <root> [extra args...]
  #
  # DEPLOY_CONFIG_STATE_DIR defaults to a per-call fresh temp dir so this
  # suite NEVER writes into the real scripts/ops/state/ — every case here
  # gets its own empty cap counter unless the caller already exported
  # DEPLOY_CONFIG_STATE_DIR itself (case 5, which needs one shared dir
  # across several calls to prove the cap actually accumulates).
  local repo="$1" root="$2"
  shift 2
  DEPLOY_CONFIG_REPO="$repo" DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="${DEPLOY_CONFIG_STATE_DIR:-$(fresh_dir)}" \
    bash "$DEPLOY_CONFIG" --root "$root" "$@"
}

# ----------------------------------------------------------------- case 1
# Happy path: staging deploy of a valid, on-main sha copies ONLY the
# manifest, verifies sha256, writes CONFIG_SHA, appends the log line.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"

  OUT="$(run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case1 happy path" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case1: exit 0 on valid staging deploy"
  else
    fail "case1: expected exit 0, got $RC ($OUT)"
  fi

  MANIFEST="$ROOT/shared/config/staging/field-manifest.json"
  if [ -f "$MANIFEST" ] && grep -q '"version":2' "$MANIFEST"; then
    pass "case1: manifest copied with v2 content"
  else
    fail "case1: manifest not copied correctly ($(cat "$MANIFEST" 2>&1))"
  fi

  CONFIG_SHA_FILE="$ROOT/shared/config/staging/CONFIG_SHA"
  if [ -f "$CONFIG_SHA_FILE" ] && [ "$(cat "$CONFIG_SHA_FILE")" = "$SHA_V2" ]; then
    pass "case1: CONFIG_SHA written with the deployed sha"
  else
    fail "case1: CONFIG_SHA missing/wrong ($(cat "$CONFIG_SHA_FILE" 2>&1))"
  fi

  LOG_FILE="$ROOT/shared/config/deploy-config.log"
  if [ -f "$LOG_FILE" ] && grep -q "staging $SHA_V2" "$LOG_FILE" && grep -q "case1 happy path" "$LOG_FILE"; then
    pass "case1: log line appended with slot, sha, reason"
  else
    fail "case1: log line missing/wrong ($(cat "$LOG_FILE" 2>&1))"
  fi

  EXPECTED_SHA256="$(sha256sum "$MANIFEST" | awk '{print $1}')"
  if [ -n "$EXPECTED_SHA256" ] && grep -q "$EXPECTED_SHA256" "$LOG_FILE"; then
    pass "case1: log line carries the correct sha256"
  else
    fail "case1: log line missing correct sha256"
  fi

  # Only the manifest file exists under shared/config/staging — nothing
  # else got copied.
  COUNT="$(find "$ROOT/shared/config/staging" -type f | wc -l)"
  if [ "$COUNT" -eq 2 ]; then
    pass "case1: exactly two files under shared/config/staging (manifest + CONFIG_SHA)"
  else
    fail "case1: expected 2 files under shared/config/staging, found $COUNT"
  fi
}

# ----------------------------------------------------------------- case 2
# Lineage refusal: a sha not reachable from origin/main is refused, exit 1,
# reason 'lineage', and nothing is written.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  commit_v2_on_main "$REPO" >/dev/null
  SHA_UNMERGED="$(commit_unmerged "$REPO")"

  OUT="$(run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_UNMERGED" --reason "case2 lineage" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ]; then
    pass "case2: exit non-zero on unmerged sha"
  else
    fail "case2: expected non-zero exit, got 0"
  fi

  if printf '%s' "$OUT" | grep -qi "lineage"; then
    pass "case2: refusal reason names 'lineage'"
  else
    fail "case2: refusal did not name lineage ($OUT)"
  fi

  if [ ! -e "$ROOT/shared/config/staging/field-manifest.json" ]; then
    pass "case2: nothing written on lineage refusal"
  else
    fail "case2: manifest was written despite lineage refusal"
  fi
}

# ----------------------------------------------------------------- case 3
# Hash mismatch on the SOURCE blob: the manifest cannot be read at the
# given sha (bad path through the same 'hash' exit reason as a real
# checksum mismatch, but this specific case never reaches the post-write
# compare — that branch is exercised separately in case 3b below).
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  # Remove the manifest from the fixture repo's working tree AND make a
  # new commit without it, on main, so `git show <sha>:path` at THIS sha
  # still works (it did have the file) -- instead we target a sha that
  # exists on main but never had scraper/config/field-manifest.json at all,
  # by committing a manifestless initial state on a fresh repo.
  REPO2="$(fresh_dir)"
  (
    cd "$REPO2"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git remote add origin "https://github.com/abhayla/IPODhan.git"
    echo "no manifest here" > README.md
    git add -A
    git commit -q -m "no manifest"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  SHA_NOFILE="$(cd "$REPO2" && git rev-parse HEAD)"

  OUT="$(run_deploy "$REPO2" "$ROOT" --slot staging --sha "$SHA_NOFILE" --reason "case3 hash" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ]; then
    pass "case3: exit non-zero when the manifest cannot be read at the sha"
  else
    fail "case3: expected non-zero exit, got 0"
  fi

  if printf '%s' "$OUT" | grep -qi "hash"; then
    pass "case3: refusal reason names 'hash'"
  else
    fail "case3: refusal did not name hash ($OUT)"
  fi
}

# ---------------------------------------------------------------- case 3b
# NOT COVERED: the post-write compare (deploy-config.sh's second
# `sha256sum "$MANIFEST_TARGET"` call, the one that would catch a `cp`
# that landed different bytes than the source blob it just read) has no
# case here. A PATH-prefixed `sha256sum` stub keyed on call count was
# tried and left flaky under this suite's own re-exec of the real binary
# (`/usr/bin/env sha256sum "$@"` inside the stub did not reliably route
# back through the stub on the second invocation on this box) — cut for
# time (Tier A budget) rather than land a flaky case. This branch is
# effectively unreachable in the real deploy path too: it would require
# disk corruption between the `cp`/`mv` and the immediately-following
# read, not a code defect in this script.

# ----------------------------------------------------------------- case 4
# Prod guard: --slot prod without --i-have-the-owners-word is refused.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"

  OUT="$(run_deploy "$REPO" "$ROOT" --slot prod --sha "$SHA_V2" --reason "case4 prod no word" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ]; then
    pass "case4: exit non-zero on prod without the owner flag"
  else
    fail "case4: expected non-zero exit, got 0"
  fi

  if printf '%s' "$OUT" | grep -qi "prod-guard"; then
    pass "case4: refusal reason names 'prod-guard'"
  else
    fail "case4: refusal did not name prod-guard ($OUT)"
  fi

  if [ ! -e "$ROOT/shared/config/prod/field-manifest.json" ]; then
    pass "case4: nothing written on prod-guard refusal"
  else
    fail "case4: manifest was written despite prod-guard refusal"
  fi

  # With the flag, prod deploy succeeds. F7 (#752) now refuses
  # DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 for --slot prod, so this positive
  # control can no longer use run_deploy() (which always sets that var) —
  # it must exercise a REAL (unskipped) 'git fetch origin main'. A stub
  # 'git' ahead of PATH fakes that one subcommand as an instant success
  # (no real network) while every other git subcommand — including
  # 'remote get-url origin', which the F6 identity check depends on —
  # passes straight through to the real git, so this proves prod can still
  # complete its full, real lineage+identity path end to end.
  FETCHOK_STUB_DIR="$(fresh_dir)"
  REAL_GIT_FOR_FETCHOK="$(command -v git)"
  cat > "$FETCHOK_STUB_DIR/git" << STUBEOF
#!/usr/bin/env bash
if [ "\$1" = "fetch" ] && [ "\$2" = "origin" ] && [ "\$3" = "main" ]; then
  exit 0
fi
exec "$REAL_GIT_FOR_FETCHOK" "\$@"
STUBEOF
  chmod +x "$FETCHOK_STUB_DIR/git"

  OUT2="$(PATH="$FETCHOK_STUB_DIR:$PATH" env -u DEPLOY_CONFIG_LINEAGE_SKIP_FETCH \
    DEPLOY_CONFIG_REPO="$REPO" DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$DEPLOY_CONFIG" --root "$ROOT" \
    --slot prod --sha "$SHA_V2" --reason "case4 prod with word" --i-have-the-owners-word 2>&1)"
  RC2=$?
  if [ "$RC2" -eq 0 ] && [ -f "$ROOT/shared/config/prod/field-manifest.json" ]; then
    pass "case4: prod deploy succeeds with --i-have-the-owners-word and a real (unskipped) fetch"
  else
    fail "case4: prod deploy with the owner flag failed ($OUT2)"
  fi
}

# ----------------------------------------------------------------- case 5
# Cap: a 5th staging run in one UTC day is refused; runs use a private
# STATE_DIR under the fixture root so this test never touches the real
# button's state directory.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  STATE_DIR="$(fresh_dir)"

  for i in 1 2 3 4; do
    OUT="$(DEPLOY_CONFIG_STATE_DIR="$STATE_DIR" run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case5 run $i" 2>&1)"
    RC=$?
    if [ "$RC" -ne 0 ]; then
      fail "case5: run $i of 4 unexpectedly refused ($OUT)"
    fi
  done
  pass "case5: 4 staging runs in one day all succeeded"

  OUT5="$(DEPLOY_CONFIG_STATE_DIR="$STATE_DIR" run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case5 run 5" 2>&1)"
  RC5=$?
  if [ "$RC5" -ne 0 ]; then
    pass "case5: 5th staging run in one day refused"
  else
    fail "case5: expected the 5th staging run to be refused, got exit 0"
  fi
  if printf '%s' "$OUT5" | grep -qi "cap"; then
    pass "case5: refusal reason names 'cap'"
  else
    fail "case5: refusal did not name cap ($OUT5)"
  fi
}

# ----------------------------------------------------------------- case 6
# --dry-run writes nothing: fake root is byte-identical before/after.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"

  BEFORE="$(find "$ROOT" -type f | sort)"
  OUT="$(run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case6 dry run" --dry-run 2>&1)"
  RC=$?
  AFTER="$(find "$ROOT" -type f | sort)"

  if [ "$RC" -eq 0 ]; then
    pass "case6: --dry-run exits 0"
  else
    fail "case6: --dry-run exited $RC ($OUT)"
  fi

  if [ "$BEFORE" = "$AFTER" ]; then
    pass "case6: --dry-run wrote nothing to the fake root"
  else
    fail "case6: --dry-run wrote files (before=[$BEFORE] after=[$AFTER])"
  fi

  if printf '%s' "$OUT" | grep -qi "dry-run"; then
    pass "case6: dry-run output says so"
  else
    fail "case6: dry-run output did not say dry-run ($OUT)"
  fi
}

# ----------------------------------------------------------------- case 7
# Atomic replace: after a successful deploy, no leftover .tmp file remains.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case7 atomic" >/dev/null 2>&1

  if [ ! -e "$ROOT/shared/config/staging/field-manifest.json.tmp" ]; then
    pass "case7: no leftover .tmp file after a successful deploy"
  else
    fail "case7: .tmp file left behind"
  fi
}

# ----------------------------------------------------------------- case 8
# Missing required args are refused.
{
  ROOT="$(fresh_dir)"
  OUT="$(bash "$DEPLOY_CONFIG" --root "$ROOT" --slot staging --reason "no sha" 2>&1)"
  RC=$?
  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi "missing arg"; then
    pass "case8: missing --sha refused with 'missing arg'"
  else
    fail "case8: missing --sha not refused correctly (rc=$RC, $OUT)"
  fi
}

# ----------------------------------------------------------------- case 9
# A symbolic --sha (e.g. origin/main, a branch name, HEAD) is resolved to
# the 40-hex commit it names before it is written anywhere — CONFIG_SHA
# and the log line must carry the resolved commit, never the symbolic
# text itself.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  RESOLVED_SHA="$(cd "$REPO" && git rev-parse origin/main)"

  OUT="$(run_deploy "$REPO" "$ROOT" --slot staging --sha "origin/main" --reason "case9 symbolic sha" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case9: exit 0 on symbolic --sha origin/main"
  else
    fail "case9: expected exit 0, got $RC ($OUT)"
  fi

  if printf '%s' "$RESOLVED_SHA" | grep -qE '^[0-9a-f]{40}$'; then
    pass "case9: fixture's origin/main resolves to a 40-hex commit"
  else
    fail "case9: fixture origin/main did not resolve to 40-hex ($RESOLVED_SHA)"
  fi

  CONFIG_SHA_FILE="$ROOT/shared/config/staging/CONFIG_SHA"
  if [ -f "$CONFIG_SHA_FILE" ] && [ "$(cat "$CONFIG_SHA_FILE")" = "$RESOLVED_SHA" ]; then
    pass "case9: CONFIG_SHA holds the resolved 40-hex commit, not 'origin/main'"
  else
    fail "case9: CONFIG_SHA wrong ($(cat "$CONFIG_SHA_FILE" 2>&1), want $RESOLVED_SHA)"
  fi

  LOG_FILE="$ROOT/shared/config/deploy-config.log"
  if [ -f "$LOG_FILE" ] && grep -q "staging $RESOLVED_SHA" "$LOG_FILE" && ! grep -q "staging origin/main" "$LOG_FILE"; then
    pass "case9: log line carries the resolved 40-hex sha, not the symbolic name"
  else
    fail "case9: log line missing/wrong ($(cat "$LOG_FILE" 2>&1))"
  fi
}

# ---------------------------------------------------------------- case 10
# Deployed-shape run: the script must complete a real config-only deploy
# when it lives inside a directory tree with NO .git anywhere up to the
# filesystem root (the actual deployed shape — a release dir under
# /var/www/ipodhan/current-staging/scripts/ops/, #748). DEPLOY_CONFIG_REPO
# points the script's git operations at a fixture repo instead of the
# no-git tree it is physically copied into.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"

  # A standalone, git-free copy of the script tree, several directories
  # below a filesystem root that has no .git anywhere above it — this is
  # what scripts/ops/deploy-config.sh's own default REPO_ROOT computation
  # ($SCRIPT_DIR/../..) resolves to on a deployed release, and why it
  # breaks: there is no .git up that chain at all.
  NOGIT_ROOT="$(fresh_dir)"
  NOGIT_SCRIPT_DIR="$NOGIT_ROOT/current-staging/scripts/ops"
  mkdir -p "$NOGIT_SCRIPT_DIR"
  cp "$DEPLOY_CONFIG" "$NOGIT_SCRIPT_DIR/deploy-config.sh"
  chmod +x "$NOGIT_SCRIPT_DIR/deploy-config.sh"

  if assert_no_git_above "$NOGIT_ROOT"; then
    pass "case10: premise holds — no .git anywhere above the no-git tree"
  else
    fail "case10: premise violated — a .git dir exists above the supposedly git-free tree"
  fi

  OUT="$(DEPLOY_CONFIG_REPO="$REPO" DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$NOGIT_SCRIPT_DIR/deploy-config.sh" --root "$ROOT" \
    --slot staging --sha "$SHA_V2" --reason "case10 deployed shape" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case10: deploy-config.sh run from a no-.git tree (with DEPLOY_CONFIG_REPO set) exits 0"
  else
    fail "case10: expected exit 0 from a no-.git tree, got $RC ($OUT)"
  fi

  if [ -f "$ROOT/shared/config/staging/field-manifest.json" ] && grep -q '"version":2' "$ROOT/shared/config/staging/field-manifest.json"; then
    pass "case10: manifest deployed correctly from the no-.git tree"
  else
    fail "case10: manifest not deployed from the no-.git tree"
  fi
}

# ---------------------------------------------------------------- case 11
# Same no-.git tree, but DEPLOY_CONFIG_REPO is left UNSET: the script's own
# default REPO_ROOT ($SCRIPT_DIR/../..) is a directory with no .git in it
# or above it, so every git call in the script fails. The failure MUST
# name DEPLOY_CONFIG_REPO and tell the operator what to set — not just
# surface a raw git error, which gives the operator nothing to act on.
{
  NOGIT_ROOT="$(fresh_dir)"
  NOGIT_SCRIPT_DIR="$NOGIT_ROOT/current-staging/scripts/ops"
  mkdir -p "$NOGIT_SCRIPT_DIR"
  cp "$DEPLOY_CONFIG" "$NOGIT_SCRIPT_DIR/deploy-config.sh"
  chmod +x "$NOGIT_SCRIPT_DIR/deploy-config.sh"
  ROOT="$(fresh_dir)"

  # Deliberately unset DEPLOY_CONFIG_REPO (env -u belt-and-braces in case a
  # caller's shell exported it earlier in this suite).
  OUT="$(env -u DEPLOY_CONFIG_REPO DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$NOGIT_SCRIPT_DIR/deploy-config.sh" --root "$ROOT" \
    --slot staging --sha "deadbeef" --reason "case11 no repo override" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ]; then
    pass "case11: no-.git tree with DEPLOY_CONFIG_REPO unset is refused, not silently mis-resolved"
  else
    fail "case11: expected non-zero exit with DEPLOY_CONFIG_REPO unset from a no-.git tree, got 0"
  fi

  if printf '%s' "$OUT" | grep -q "DEPLOY_CONFIG_REPO"; then
    pass "case11: refusal names DEPLOY_CONFIG_REPO so the operator knows what to set"
  else
    fail "case11: refusal did not name DEPLOY_CONFIG_REPO ($OUT)"
  fi
}

# ---------------------------------------------------------------- case 12
# The committed script must carry the executable bit in git itself — a
# release is a 'git archive | tar -x' export (scripts/deploy-linux.sh
# step 4) which faithfully reproduces the committed mode, so a 100644 blob
# ships non-executable on every release regardless of any chmod done on
# the source checkout (#748's second, unnamed defect).
{
  MODE="$(cd "$SCRIPT_DIR/.." && git ls-tree HEAD -- ops/deploy-config.sh 2>/dev/null | awk '{print $1}')"
  if [ -z "$MODE" ]; then
    # MINOR-5, then #752 "also noted": not running inside a git checkout
    # (e.g. a real release dir, which is exactly the '.git'-free shape a
    # deployed release has) — there is no committed mode left to consult,
    # so an unconditional SKIP here means the 100755 property has NO guard
    # at all on the one artifact that actually matters (the deployed
    # release). An on-disk '-x' check is a WEAKER property than the
    # committed-mode check above — a local 'chmod +x' (or
    # core.fileMode=false) sets the filesystem bit independently of what
    # git committed, so this cannot catch a tree that was committed 100644
    # and then chmod'd +x by hand before packaging — but it DOES catch the
    # actual failure mode #748 named (git archive ships a 100644 blob
    # non-executable): on a real release, if the committed mode were wrong
    # the exported file would be non-executable on disk too, and this
    # check would fail. Asserted explicitly as the weaker property it is,
    # never silently upgraded to read as "committed mode verified".
    if [ -x "$DEPLOY_CONFIG" ]; then
      pass "case12 (weaker, no git tree): deploy-config.sh is executable on disk — does not prove committed mode, only that this release's export is runnable"
    else
      fail "case12 (weaker, no git tree): deploy-config.sh is NOT executable on disk ($DEPLOY_CONFIG) — a 'git archive' export of a 100644-mode commit ships exactly like this"
    fi
  elif [ "$MODE" = "100755" ]; then
    pass "case12: deploy-config.sh is committed with mode 100755 (executable) in git"
  else
    fail "case12: deploy-config.sh is committed with mode $MODE, not 100755 — git archive will ship it non-executable on every release"
  fi
}


# ---------------------------------------------------------------- case 13
# MAJOR-3: a bare repo, and a directory INSIDE a .git dir, both make
# 'git rev-parse --is-inside-work-tree' PRINT "false" but still EXIT 0 —
# an exit-code-only guard lets both slip past the repo-root guard into
# raw git errors further down instead of being refused here with a clear
# message.
{
  BARE_REPO="$(fresh_dir)/bare.git"
  git init -q --bare "$BARE_REPO" >/dev/null 2>&1
  ROOT="$(fresh_dir)"

  OUT="$(DEPLOY_CONFIG_REPO="$BARE_REPO" DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$DEPLOY_CONFIG" --root "$ROOT" \
    --slot staging --sha "deadbeef" --reason "case13 bare repo" 2>&1)"
  RC=$?
  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "repo-root"; then
    pass "case13: a bare repo as DEPLOY_CONFIG_REPO is refused by the repo-root guard"
  else
    fail "case13: expected a repo-root refusal for a bare repo, got rc=$RC ($OUT)"
  fi
}

{
  REPO="$(build_fixture_repo)"
  GIT_DIR_PATH="$REPO/.git"
  ROOT="$(fresh_dir)"

  OUT="$(DEPLOY_CONFIG_REPO="$GIT_DIR_PATH" DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$DEPLOY_CONFIG" --root "$ROOT" \
    --slot staging --sha "deadbeef" --reason "case13b .git dir" 2>&1)"
  RC=$?
  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "repo-root"; then
    pass "case13: a .git directory as DEPLOY_CONFIG_REPO is refused by the repo-root guard"
  else
    fail "case13: expected a repo-root refusal for a .git dir, got rc=$RC ($OUT)"
  fi
}

# ---------------------------------------------------------------- case 14
# MAJOR-4: a root-owned checkout hit by a non-root invoker triggers git's
# own 'dubious ownership' safe.directory refusal (exit 128) — the fatal
# message must show git's actual words, not just the generic
# DEPLOY_CONFIG_REPO advice the operator has already followed.
#
# round 2 asserted this with GIT_TEST_ASSUME_DIFFERENT_OWNER=1, which
# fakes the refusal only on a SID-based ownership check (Windows git).
# On the Linux CI runner (POSIX uid check, git 2.55.0) the fixture is
# owned by the invoking uid, so the env var is simply inert: the script
# runs past the repo-root guard and dies later at lineage, and the
# asserted text never appears (CI: 'FAIL: case14 ... got rc=1 ...
# FATAL: lineage: deadbeef is not an ancestor of origin/main'). That is a
# vacuous assertion, not a broken guard — round 1 and round 2 both made
# this mistake (case10's premise-assertion idiom exists for exactly this
# reason and was not applied here).
#
# Fix: stand in for the real-world condition (a root-owned
# /var/www/ipodhan/repo hit by a non-root invoker) with a stub 'git'
# ahead of PATH on 'rev-parse --is-inside-work-tree' only, printing git's
# own real refusal text and exiting 128 — deterministic on every
# platform, git version and uid, because it does not depend on the OS's
# ownership-check mechanism at all. Every other git subcommand passes
# through to the real git so the rest of the script (log(), fatal(), the
# parts that run BEFORE the probe) is unaffected.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"

  STUB_DIR="$(fresh_dir)"
  REAL_GIT="$(command -v git)"
  cat > "$STUB_DIR/git" << STUBEOF
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\$2" = "--is-inside-work-tree" ]; then
  echo "fatal: detected dubious ownership in repository at '\$PWD'" >&2
  exit 128
fi
exec "$REAL_GIT" "\$@"
STUBEOF
  chmod +x "$STUB_DIR/git"

  # Premise: the stub actually shadows the real git for this probe,
  # case10-style — assert it before trusting the outcome, so an inert
  # stub (wrong PATH order, non-executable, wrong git resolved) is loud
  # as a SKIP instead of masquerading as a guard defect either way.
  STUB_CHECK_OUT="$(PATH="$STUB_DIR:$PATH" git rev-parse --is-inside-work-tree 2>&1)"
  STUB_CHECK_RC=$?
  if [ "$STUB_CHECK_RC" -eq 128 ] && printf '%s' "$STUB_CHECK_OUT" | grep -qi "dubious ownership"; then
    OUT="$(PATH="$STUB_DIR:$PATH" DEPLOY_CONFIG_REPO="$REPO" \
      DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
      DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
      bash "$DEPLOY_CONFIG" --root "$ROOT" \
      --slot staging --sha "deadbeef" --reason "case14 dubious ownership" 2>&1)"
    RC=$?
    if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qi "dubious ownership"; then
      pass "case14: dubious-ownership refusal shows git's own cause, not only generic advice"
    else
      fail "case14: expected 'dubious ownership' in the refusal text, got rc=$RC ($OUT)"
    fi
  else
    echo "SKIP: case14: premise violated — the stub git did not shadow the real git (rc=$STUB_CHECK_RC, out=$STUB_CHECK_OUT)"
  fi
}

# ---------------------------------------------------------------- case 14b
# Generic form of case14's property: ANY probe result that is not exactly
# "true" on stdout, together with non-empty stderr, must end up verbatim
# inside the repo-root fatal — not just the one 'dubious ownership'
# string. This is the case that would also have caught round 1's guard
# (exit-code-only, ignored stderr entirely): it exercises several
# different stub outcomes, not one hand-picked message.
{
  for VARIANT in \
    "128:fatal: detected dubious ownership in repository at '/fixture'" \
    "1:error: not a git repository (or any of the parent directories): .git" \
    "128:fatal: unsafe repository ('/fixture' is owned by someone else)"
  do
    STUB_RC="${VARIANT%%:*}"
    STUB_MSG="${VARIANT#*:}"

    REPO="$(build_fixture_repo)"
    ROOT="$(fresh_dir)"
    STUB_DIR="$(fresh_dir)"
    REAL_GIT="$(command -v git)"
    cat > "$STUB_DIR/git" << STUBEOF
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\$2" = "--is-inside-work-tree" ]; then
  echo "$STUB_MSG" >&2
  exit $STUB_RC
fi
exec "$REAL_GIT" "\$@"
STUBEOF
    chmod +x "$STUB_DIR/git"

    STUB_CHECK_OUT="$(PATH="$STUB_DIR:$PATH" git rev-parse --is-inside-work-tree 2>&1)"
    STUB_CHECK_RC=$?
    if [ "$STUB_CHECK_RC" -eq "$STUB_RC" ] && [ "$STUB_CHECK_OUT" = "$STUB_MSG" ]; then
      OUT="$(PATH="$STUB_DIR:$PATH" DEPLOY_CONFIG_REPO="$REPO" \
        DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
        DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
        bash "$DEPLOY_CONFIG" --root "$ROOT" \
        --slot staging --sha "deadbeef" --reason "case14b generic probe failure" 2>&1)"
      RC=$?
      if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -qF "$STUB_MSG"; then
        pass "case14b: probe failure (rc=$STUB_RC) '$STUB_MSG' reaches the repo-root fatal verbatim"
      else
        fail "case14b: probe failure (rc=$STUB_RC) '$STUB_MSG' did not reach the fatal (rc=$RC, out=$OUT)"
      fi
    else
      echo "SKIP: case14b: premise violated for variant rc=$STUB_RC — stub did not shadow real git (got rc=$STUB_CHECK_RC, out=$STUB_CHECK_OUT)"
    fi
  done
}

# ---------------------------------------------------------------- case 15
# CRITICAL-1/2: the documented on-box command (no DEPLOY_CONFIG_REPO set)
# must SUCCEED when the script runs from a no-.git release tree and a
# real work tree exists at the server-default path — this is the
# fallback chain's whole point. SERVER_REPO_DEFAULT is pointed at a
# fixture via DEPLOY_CONFIG_SERVER_REPO_DEFAULT so this does not touch
# /var/www.
{
  REPO="$(build_fixture_repo)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  ROOT="$(fresh_dir)"

  NOGIT_ROOT="$(fresh_dir)"
  NOGIT_SCRIPT_DIR="$NOGIT_ROOT/current-staging/scripts/ops"
  mkdir -p "$NOGIT_SCRIPT_DIR"
  cp "$DEPLOY_CONFIG" "$NOGIT_SCRIPT_DIR/deploy-config.sh"
  chmod +x "$NOGIT_SCRIPT_DIR/deploy-config.sh"

  OUT="$(env -u DEPLOY_CONFIG_REPO DEPLOY_CONFIG_SERVER_REPO_DEFAULT="$REPO" \
    DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$NOGIT_SCRIPT_DIR/deploy-config.sh" --root "$ROOT" \
    --slot staging --sha "$SHA_V2" --reason "case15 server default fallback" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case15: documented command with no DEPLOY_CONFIG_REPO succeeds via the server-default fallback"
  else
    fail "case15: expected exit 0 via server-default fallback, got $RC ($OUT)"
  fi

  if [ -f "$ROOT/shared/config/staging/field-manifest.json" ] && grep -q '"version":2' "$ROOT/shared/config/staging/field-manifest.json"; then
    pass "case15: manifest deployed correctly via the server-default fallback"
  else
    fail "case15: manifest not deployed via the server-default fallback"
  fi

  if printf '%s' "$OUT" | grep -q "server default"; then
    pass "case15: log names which repo-root source was chosen (server default)"
  else
    fail "case15: expected a 'server default' log line naming the chosen source ($OUT)"
  fi
}

# ---------------------------------------------------------------- case 16
# #751: STATE_DIR defaults to $SCRIPT_DIR/state, and on a deployed release
# $SCRIPT_DIR is <release-dir>/scripts/ops — INSIDE that release's own
# directory tree. deploy-linux.sh creates a fresh release dir on every
# deploy, so the 4/day staging cap counter must NOT reset just because the
# NEXT staging config-only deploy happens to run from a different release's
# copy of this script. This case copies the real script into TWO separate
# fake release dirs (mirroring current-staging flipping across a deploy,
# #751's own mechanism) sharing one $ROOT, runs 4 staging deploys from
# release 1 with NO DEPLOY_CONFIG_STATE_DIR override (the on-box, undocumented
# default path #751 is about), then a 5th from release 2 — which must be
# refused by the SAME cap, proving the count carried across releases.
{
  REPO="$(build_fixture_repo)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  ROOT="$(fresh_dir)"

  RELEASES_ROOT="$(fresh_dir)"
  REL1_SCRIPT_DIR="$RELEASES_ROOT/release-1/scripts/ops"
  REL2_SCRIPT_DIR="$RELEASES_ROOT/release-2/scripts/ops"
  mkdir -p "$REL1_SCRIPT_DIR" "$REL2_SCRIPT_DIR"
  cp "$DEPLOY_CONFIG" "$REL1_SCRIPT_DIR/deploy-config.sh"
  cp "$DEPLOY_CONFIG" "$REL2_SCRIPT_DIR/deploy-config.sh"
  chmod +x "$REL1_SCRIPT_DIR/deploy-config.sh" "$REL2_SCRIPT_DIR/deploy-config.sh"

  run_from_release() {
    local script_dir="$1" run_label="$2"
    env -u DEPLOY_CONFIG_STATE_DIR DEPLOY_CONFIG_REPO="$REPO" \
      DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
      bash "$script_dir/deploy-config.sh" --root "$ROOT" \
      --slot staging --sha "$SHA_V2" --reason "case16 $run_label" 2>&1
  }

  CASE16_OK=1
  for i in 1 2 3 4; do
    OUT16="$(run_from_release "$REL1_SCRIPT_DIR" "release-1 run $i")"
    RC16=$?
    if [ "$RC16" -ne 0 ]; then
      fail "case16: release-1 run $i of 4 unexpectedly refused ($OUT16)"
      CASE16_OK=0
    fi
  done
  if [ "$CASE16_OK" -eq 1 ]; then
    pass "case16: 4 staging runs from release-1 (default STATE_DIR, no override) all succeeded"
  fi

  OUT16_5="$(run_from_release "$REL2_SCRIPT_DIR" "release-2 run 5")"
  RC16_5=$?
  if [ "$RC16_5" -ne 0 ]; then
    pass "case16: 5th staging run, from a DIFFERENT release dir, is refused by the same cap (#751 — state persists across releases)"
  else
    fail "case16: expected the 5th staging run (from release-2) to be refused by release-1's cap, got exit 0 — STATE_DIR reset across releases (#751)"
  fi
  if printf '%s' "$OUT16_5" | grep -qi "cap"; then
    pass "case16: cross-release refusal reason names 'cap'"
  else
    fail "case16: cross-release refusal did not name cap ($OUT16_5)"
  fi
}
# ----------------------------------------------------------------- case 17
# #1057: the staging cap is keyed on the IST calendar day, not the UTC day.
#  A) 23:59 IST and 00:01 IST, two minutes apart but crossing an IST
#     midnight, land in DIFFERENT day-state files.
#  B) 05:29 IST and 05:31 IST, crossing a UTC midnight but NOT an IST
#     midnight, land in the SAME day-state file and both count toward the
#     cap — this is the exact defect #1057 reports (the old `date -u` code
#     would have treated these as different UTC days and reset the cap).
# DEPLOY_CONFIG_NOW (epoch seconds) injects the clock so this never depends
# on when the suite happens to run.
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  STATE_DIR="$(fresh_dir)"

  NOW_2359_IST="$(date -u -d '2026-01-01T18:29:00Z' +%s)"   # 2026-01-01 23:59 IST
  NOW_0001_IST="$(date -u -d '2026-01-01T18:31:00Z' +%s)"   # 2026-01-02 00:01 IST

  DEPLOY_CONFIG_NOW="$NOW_2359_IST" DEPLOY_CONFIG_STATE_DIR="$STATE_DIR" \
    run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case17a 23:59 IST" >/dev/null 2>&1
  DEPLOY_CONFIG_NOW="$NOW_0001_IST" DEPLOY_CONFIG_STATE_DIR="$STATE_DIR" \
    run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case17a 00:01 IST" >/dev/null 2>&1

  if [ -f "$STATE_DIR/deploy-config-staging-2026-01-01.json" ] && [ -f "$STATE_DIR/deploy-config-staging-2026-01-02.json" ]; then
    pass "case17a: 23:59 IST and 00:01 IST (2 min apart, crossing IST midnight) land in different day-state files"
  else
    fail "case17a: expected deploy-config-staging-2026-01-01.json AND -2026-01-02.json, got: $(ls "$STATE_DIR")"
  fi

  STATE_DIR_B="$(fresh_dir)"
  NOW_0529_IST="$(date -u -d '2026-01-01T23:59:00Z' +%s)"   # 2026-01-02 05:29 IST
  NOW_0531_IST="$(date -u -d '2026-01-02T00:01:00Z' +%s)"   # 2026-01-02 05:31 IST

  DEPLOY_CONFIG_NOW="$NOW_0529_IST" DEPLOY_CONFIG_STATE_DIR="$STATE_DIR_B" \
    run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case17b 05:29 IST" >/dev/null 2>&1
  DEPLOY_CONFIG_NOW="$NOW_0531_IST" DEPLOY_CONFIG_STATE_DIR="$STATE_DIR_B" \
    run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case17b 05:31 IST" >/dev/null 2>&1

  if [ -f "$STATE_DIR_B/deploy-config-staging-2026-01-02.json" ] && [ ! -f "$STATE_DIR_B/deploy-config-staging-2026-01-01.json" ]; then
    COUNT_B="$(node -e '
      const fs = require("fs");
      const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(Array.isArray(rows) ? rows.length : 0);
    ' "$STATE_DIR_B/deploy-config-staging-2026-01-02.json" 2>/dev/null || echo 0)"
    if [ "$COUNT_B" = "2" ]; then
      pass "case17b: 05:29 IST and 05:31 IST (crossing UTC midnight, same IST day) land in the same day-state file and both count toward the cap"
    else
      fail "case17b: expected 2 entries in the 2026-01-02 state file, got $COUNT_B"
    fi
  else
    fail "case17b: expected only deploy-config-staging-2026-01-02.json, got: $(ls "$STATE_DIR_B")"
  fi
}

# ---------------------------------------------------------------- case 18
# #752 F5: a leaked GIT_DIR (from a parent process, a git alias/wrapper, or
# a hook-invoked shell) must NOT defeat the repo-root guard. Reproduces the
# issue's own repro shape: GIT_DIR pointing at an UNRELATED repo (a "decoy"
# with a different manifest) while DEPLOY_CONFIG_REPO names a plain
# directory that is NOT actually a git work tree. Confirmed red on the
# pre-fix script (deploy-config.sh at HEAD before this change): it exited 0
# and silently deployed the DECOY's manifest content, because
# 'git rev-parse --is-inside-work-tree' ignored cwd entirely and answered
# "true" for the GIT_DIR repo regardless of $REPO_ROOT. The fix (unset
# GIT_DIR/GIT_WORK_TREE for the script's own git calls) must refuse this
# invocation via the ordinary "not a usable git working tree" repo-root
# message, and must not write the decoy's content anywhere.
{
  DECOY_REPO="$(fresh_dir)"
  (
    cd "$DECOY_REPO"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git remote add origin "https://github.com/abhayla/IPODhan.git"
    mkdir -p scraper/config
    echo '{"version":999,"decoy":true}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "decoy"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  DECOY_SHA="$(cd "$DECOY_REPO" && git rev-parse HEAD)"

  NOT_A_REPO_DIR="$(fresh_dir)"
  ROOT="$(fresh_dir)"

  OUT="$(GIT_DIR="$DECOY_REPO/.git" DEPLOY_CONFIG_REPO="$NOT_A_REPO_DIR" \
    DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$DEPLOY_CONFIG" --root "$ROOT" \
    --slot staging --sha "$DECOY_SHA" --reason "case18 leaked GIT_DIR" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "repo-root"; then
    pass "case18: a leaked GIT_DIR pointing at an unrelated repo is refused via repo-root, not silently followed"
  else
    fail "case18: expected a repo-root refusal with GIT_DIR leaked at an unrelated repo, got rc=$RC ($OUT)"
  fi

  if [ ! -e "$ROOT/shared/config/staging/field-manifest.json" ]; then
    pass "case18: the decoy's manifest was never written"
  else
    fail "case18: the decoy repo's manifest (version 999) was written despite the leaked GIT_DIR ($(cat "$ROOT/shared/config/staging/field-manifest.json" 2>&1))"
  fi
}

# ---------------------------------------------------------------- case 19
# #752 F6: the repo-root fallback chain only asked "is this a git work
# tree", never "is this IPODhan" — a foreign repo (a fork, a mirror, any
# unrelated origin) that happens to be a real work tree passed silently.
# Confirmed red on the pre-fix script: DEPLOY_CONFIG_REPO pointed at a repo
# whose origin is a DIFFERENT GitHub project, and it deployed that repo's
# manifest with exit 0. The fix must refuse it, naming both the foreign
# origin URL and 'repo-root', before ever reading the manifest.
{
  FOREIGN_REPO="$(fresh_dir)"
  (
    cd "$FOREIGN_REPO"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git remote add origin "https://github.com/someoneelse/unrelated-fork.git"
    mkdir -p scraper/config
    echo '{"version":1,"fields":{}}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "v1"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1
  FOREIGN_SHA="$(cd "$FOREIGN_REPO" && git rev-parse HEAD)"
  ROOT="$(fresh_dir)"

  OUT="$(run_deploy "$FOREIGN_REPO" "$ROOT" --slot staging --sha "$FOREIGN_SHA" --reason "case19 foreign origin" 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "repo-root" && printf '%s' "$OUT" | grep -q "unrelated-fork"; then
    pass "case19: a foreign-origin repo is refused by the repo-root identity check, naming the wrong origin"
  else
    fail "case19: expected a repo-root refusal naming the foreign origin, got rc=$RC ($OUT)"
  fi

  if [ ! -e "$ROOT/shared/config/staging/field-manifest.json" ]; then
    pass "case19: nothing written when the origin identity check refuses"
  else
    fail "case19: manifest was written despite the foreign-origin refusal"
  fi
}

# ---------------------------------------------------------------- case 20
# #752 F7: DEPLOY_CONFIG_LINEAGE_SKIP_FETCH exists only so a test can point
# the lineage check at a local fixture with no real 'origin' remote — but
# nothing tied it to a test context, so it also skipped the fetch that
# keeps origin/main fresh on a REAL prod deploy. Confirmed red on the
# pre-fix script: --slot prod with the owner's word AND SKIP_FETCH=1
# deployed successfully (exit 0) instead of being refused. The fix refuses
# it outright, reason printed first, before any repo-root/lineage work runs.
{
  REPO="$(build_fixture_repo)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  ROOT="$(fresh_dir)"

  OUT="$(run_deploy "$REPO" "$ROOT" --slot prod --sha "$SHA_V2" --reason "case20 skip-fetch on prod" --i-have-the-owners-word 2>&1)"
  RC=$?

  if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "prod-guard"; then
    pass "case20: DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 is refused for --slot prod, reason named"
  else
    fail "case20: expected a prod-guard refusal with SKIP_FETCH=1 on prod, got rc=$RC ($OUT)"
  fi

  if printf '%s' "$OUT" | grep -qi "skip_fetch"; then
    pass "case20: refusal names DEPLOY_CONFIG_LINEAGE_SKIP_FETCH so the operator knows what to unset"
  else
    fail "case20: refusal did not name DEPLOY_CONFIG_LINEAGE_SKIP_FETCH ($OUT)"
  fi

  if [ ! -e "$ROOT/shared/config/prod/field-manifest.json" ]; then
    pass "case20: nothing written when SKIP_FETCH-on-prod is refused"
  else
    fail "case20: manifest was written despite the SKIP_FETCH-on-prod refusal"
  fi

  # Positive control: staging is UNAFFECTED — SKIP_FETCH=1 stays legal there
  # (it is how every other case in this suite avoids real network calls).
  OUT_STAGING="$(run_deploy "$REPO" "$ROOT" --slot staging --sha "$SHA_V2" --reason "case20 staging still allowed" 2>&1)"
  RC_STAGING=$?
  if [ "$RC_STAGING" -eq 0 ]; then
    pass "case20: SKIP_FETCH=1 remains allowed for --slot staging (unaffected by the prod-only refusal)"
  else
    fail "case20: expected staging with SKIP_FETCH=1 to still succeed, got rc=$RC_STAGING ($OUT_STAGING)"
  fi
}

# ---------------------------------------------------------------- case 21
# #752 MAJOR: the F6 identity refusal printed the RAW origin URL, which
# leaks any embedded 'user:pass@' credential (a GitHub Actions installation
# token, exactly this shape) into the operator's terminal and the deploy
# log. Confirmed red on the pre-fix script: an ACCEPTED credentialed origin
# still logged the raw URL (with 'ghs_FAKE' inside it) at the "repo-root:
# using ..." line, and a REFUSED foreign origin echoed the raw credential
# straight back in the fatal message.
{
  CRED_REPO="$(build_repo_with_origin "https://x-access-token:ghs_FAKE@github.com/abhayla/IPODhan.git")"
  SHA="$(cd "$CRED_REPO" && git rev-parse HEAD)"
  ROOT="$(fresh_dir)"

  OUT="$(run_deploy "$CRED_REPO" "$ROOT" --slot staging --sha "$SHA" --reason "case21a credentialed IPODhan origin" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case21a: a credentialed https origin for the real IPODhan remote is accepted"
  else
    fail "case21a: expected exit 0 for a credentialed IPODhan origin, got rc=$RC ($OUT)"
  fi

  if ! printf '%s' "$OUT" | grep -q "ghs_FAKE"; then
    pass "case21a: no output (stdout/stderr) contains the embedded credential"
  else
    fail "case21a: the credential 'ghs_FAKE' leaked into output ($OUT)"
  fi

  FOREIGN_CRED_REPO="$(build_repo_with_origin "https://x-access-token:ghs_FAKE@github.com/someoneelse/unrelated-fork.git")"
  FOREIGN_CRED_SHA="$(cd "$FOREIGN_CRED_REPO" && git rev-parse HEAD)"
  ROOT2="$(fresh_dir)"

  OUT2="$(run_deploy "$FOREIGN_CRED_REPO" "$ROOT2" --slot staging --sha "$FOREIGN_CRED_SHA" --reason "case21b credentialed foreign origin" 2>&1)"
  RC2=$?

  if [ "$RC2" -ne 0 ] && printf '%s' "$OUT2" | grep -q "unrelated-fork"; then
    pass "case21b: a refused foreign origin still names the repo in the refusal"
  else
    fail "case21b: expected a repo-root refusal naming the foreign repo, got rc=$RC2 ($OUT2)"
  fi

  if ! printf '%s' "$OUT2" | grep -q "ghs_"; then
    pass "case21b: the refusal's printed URL has its credentials stripped (no 'ghs_' anywhere)"
  else
    fail "case21b: the refusal leaked the credential ($OUT2)"
  fi

  if [ ! -e "$ROOT2/shared/config/staging/field-manifest.json" ]; then
    pass "case21b: nothing written for the refused credentialed foreign origin"
  else
    fail "case21b: manifest was written despite the credentialed foreign-origin refusal"
  fi
}

# ---------------------------------------------------------------- case 22
# #752 MINOR: EXPECTED_REPO_REMOTE_RE was case-sensitive and only accepted
# 'https://github.com/...' or the 'git@github.com:...' scp-like form with
# no trailing '.git' variance — refusing real, legitimate origins
# ('ssh://git@github.com/...', a lowercase 'ipodhan', a trailing '/') that
# 'git remote get-url origin' can genuinely print. A different owner or
# repo name must still be refused regardless of case.
{
  SSH_REPO="$(build_repo_with_origin "ssh://git@github.com/abhayla/IPODhan.git")"
  SSH_SHA="$(cd "$SSH_REPO" && git rev-parse HEAD)"
  OUT_SSH="$(run_deploy "$SSH_REPO" "$(fresh_dir)" --slot staging --sha "$SSH_SHA" --reason "case22 ssh form" 2>&1)"
  if [ $? -eq 0 ]; then
    pass "case22: ssh://git@github.com/abhayla/IPODhan.git is accepted"
  else
    fail "case22: expected the ssh:// long form to be accepted ($OUT_SSH)"
  fi

  LOWER_REPO="$(build_repo_with_origin "https://github.com/abhayla/ipodhan")"
  LOWER_SHA="$(cd "$LOWER_REPO" && git rev-parse HEAD)"
  OUT_LOWER="$(run_deploy "$LOWER_REPO" "$(fresh_dir)" --slot staging --sha "$LOWER_SHA" --reason "case22 lowercase, no .git" 2>&1)"
  if [ $? -eq 0 ]; then
    pass "case22: a lowercase 'ipodhan' origin with no .git suffix is accepted"
  else
    fail "case22: expected a lowercase, suffix-less origin to be accepted ($OUT_LOWER)"
  fi

  SLASH_REPO="$(build_repo_with_origin "https://github.com/abhayla/IPODhan.git/")"
  SLASH_SHA="$(cd "$SLASH_REPO" && git rev-parse HEAD)"
  OUT_SLASH="$(run_deploy "$SLASH_REPO" "$(fresh_dir)" --slot staging --sha "$SLASH_SHA" --reason "case22 trailing slash" 2>&1)"
  if [ $? -eq 0 ]; then
    pass "case22: a trailing '/' on the origin is accepted"
  else
    fail "case22: expected a trailing-slash origin to be accepted ($OUT_SLASH)"
  fi

  FORK_REPO="$(build_repo_with_origin "https://github.com/abhayla/IPODhan-fork.git")"
  FORK_SHA="$(cd "$FORK_REPO" && git rev-parse HEAD)"
  OUT_FORK="$(run_deploy "$FORK_REPO" "$(fresh_dir)" --slot staging --sha "$FORK_SHA" --reason "case22 negative: different repo name" 2>&1)"
  RC_FORK=$?
  if [ "$RC_FORK" -ne 0 ] && printf '%s' "$OUT_FORK" | grep -q "IPODhan-fork"; then
    pass "case22: a different repo name (IPODhan-fork) is still refused"
  else
    fail "case22: expected IPODhan-fork to be refused as a foreign repo, got rc=$RC_FORK ($OUT_FORK)"
  fi
}

# ---------------------------------------------------------------- case 23
# #752 F8: GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR leaked from a parent process
# (like GIT_DIR/GIT_WORK_TREE, case18) can redirect git's repository
# discovery for every call this script makes. Confirmed red on the pre-fix
# script: pointing these two at an unrelated decoy repo's .git dir made
# 'git rev-parse HEAD' inside the REAL $REPO_ROOT resolve against the
# decoy's object database, so the real repo's own commit could not be
# found and a legitimate deploy was falsely refused as a lineage failure.
{
  DECOY_REPO="$(fresh_dir)"
  (
    cd "$DECOY_REPO"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test"
    git remote add origin "https://github.com/abhayla/IPODhan.git"
    mkdir -p scraper/config
    echo '{"version":999,"decoy":true}' > scraper/config/field-manifest.json
    git add -A
    git commit -q -m "decoy"
    git update-ref refs/remotes/origin/main HEAD
  ) >/dev/null 2>&1

  REPO="$(build_fixture_repo)"
  SHA_V2="$(commit_v2_on_main "$REPO")"
  ROOT="$(fresh_dir)"

  OUT="$(GIT_OBJECT_DIRECTORY="$DECOY_REPO/.git/objects" GIT_COMMON_DIR="$DECOY_REPO/.git" \
    DEPLOY_CONFIG_REPO="$REPO" DEPLOY_CONFIG_LINEAGE_SKIP_FETCH=1 \
    DEPLOY_CONFIG_STATE_DIR="$(fresh_dir)" \
    bash "$DEPLOY_CONFIG" --root "$ROOT" \
    --slot staging --sha "$SHA_V2" --reason "case23 leaked GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR" 2>&1)"
  RC=$?

  if [ "$RC" -eq 0 ]; then
    pass "case23: leaked GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR does not block a legitimate deploy"
  else
    fail "case23: expected exit 0 with GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR leaked at a decoy, got rc=$RC ($OUT)"
  fi

  MANIFEST="$ROOT/shared/config/staging/field-manifest.json"
  if [ -f "$MANIFEST" ] && grep -q '"version":2' "$MANIFEST"; then
    pass "case23: the real repo's manifest (v2) was deployed, not the decoy's"
  else
    fail "case23: wrong/no manifest deployed with GIT_OBJECT_DIRECTORY/GIT_COMMON_DIR leaked ($(cat "$MANIFEST" 2>&1))"
  fi
}

echo "---"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
