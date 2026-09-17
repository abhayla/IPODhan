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

  # With the flag, prod deploy succeeds.
  OUT2="$(run_deploy "$REPO" "$ROOT" --slot prod --sha "$SHA_V2" --reason "case4 prod with word" --i-have-the-owners-word 2>&1)"
  RC2=$?
  if [ "$RC2" -eq 0 ] && [ -f "$ROOT/shared/config/prod/field-manifest.json" ]; then
    pass "case4: prod deploy succeeds with --i-have-the-owners-word"
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
    # MINOR-5: not running inside a git checkout (e.g. a release dir) —
    # there is no committed mode to consult here. An on-disk '-x' check
    # is NOT a substitute: a local 'chmod +x' (or core.fileMode=false)
    # sets the filesystem bit independently of what git actually
    # committed, so a tree committed 100644 could still pass this
    # fallback. SKIP explicitly instead of asserting a weaker property —
    # a skip is not counted as a PASS and does not mask the defect this
    # case exists to catch.
    echo "SKIP: case12: no git tree to check the committed mode (on-disk -x is not proof of committed mode)"
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
{
  REPO="$(build_fixture_repo)"
  ROOT="$(fresh_dir)"

  OUT="$(DEPLOY_CONFIG_REPO="$REPO" GIT_TEST_ASSUME_DIFFERENT_OWNER=1 \
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
echo "---"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME FAILED"
  exit 1
fi
