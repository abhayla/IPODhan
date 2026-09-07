#!/usr/bin/env bash
# T-501 — self-test for scripts/ops/deploy-and-watch.sh (signal-ownership.md
# R7: a windowed deploy is dispatched + watched by one command that does not
# depend on session idleness). Uses a fake `gh` shim on PATH so no real
# GitHub Actions run is touched. Run: bash scripts/tests/deploy-and-watch.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/ops/deploy-and-watch.sh"
FAILED=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

fresh_dir() { mktemp -d; }

# --- fake git repo with a release/prod-<date> branch at a known sha --------
GIT_REPO="$(fresh_dir)"
git -C "$GIT_REPO" init -q -b main
git -C "$GIT_REPO" config user.email test@example.com
git -C "$GIT_REPO" config user.name test
echo one > "$GIT_REPO/a.txt"
git -C "$GIT_REPO" add a.txt
git -C "$GIT_REPO" commit -qm "feat: seed"
GOOD_SHA="$(git -C "$GIT_REPO" rev-parse --short HEAD)"
git -C "$GIT_REPO" branch "release/prod-2026-09-08"
# a second commit that is NOT on the release branch, to test the mismatch case
echo two > "$GIT_REPO/b.txt"
git -C "$GIT_REPO" add b.txt
git -C "$GIT_REPO" commit -qm "feat: drift"
DRIFT_SHA="$(git -C "$GIT_REPO" rev-parse --short HEAD)"
git -C "$GIT_REPO" checkout -q "release/prod-2026-09-08"
# a fake "origin" remote pointing at itself (fetch of origin/<ref> must resolve)
git -C "$GIT_REPO" remote add origin "$GIT_REPO"
# also seed one prod-* tag on the release branch for the rollback-sha case
git -C "$GIT_REPO" tag -a "prod-2026-09-01" "$GOOD_SHA" -m "prior release"

run_deploy() {
  local outcome="$1"; shift
  local logfile="$1"; shift
  local bindir
  bindir="$(fresh_dir)"
  cat > "$bindir/gh" <<SHIM
#!/usr/bin/env bash
echo "\$@" >> "$GH_ARGV_LOG"
case "\$1" in
  workflow)
    # workflow run ...
    exit 0
    ;;
  run)
    case "\$2" in
      list)
        # Round 2: simulate a STAGING run (databaseId 111, createdAt BEFORE
        # dispatch) landing alongside the real PROD run (databaseId 999,
        # createdAt AFTER dispatch) on the same workflow. Apply the caller's
        # real --jq expression against this fixture with the real `jq`
        # binary, so the test proves the script's own filter (createdAt >=
        # dispatch time) picks 999, not the first-listed 111.
        JQ_EXPR=""
        prev=""
        for a in "\$@"; do
          if [ "\$prev" = "--jq" ]; then JQ_EXPR="\$a"; fi
          prev="\$a"
        done
        FIXTURE='[{"databaseId":111,"createdAt":"2020-01-01T00:00:00Z","headBranch":"release/prod-2026-09-08"},{"databaseId":999,"createdAt":"2099-01-01T00:00:00Z","headBranch":"release/prod-2026-09-08"}]'
        if [ -n "\$JQ_EXPR" ]; then
          echo "\$FIXTURE" | jq -r "\$JQ_EXPR"
        else
          echo '999'
        fi
        exit 0
        ;;
      watch)
        if [ "$outcome" = "success" ]; then exit 0; else exit 1; fi
        ;;
      view)
        cat <<'LOG'
probe port 3000 responded 200
release_scraper_cycle_locks acquired
Deploying release 20260908-abc1234
rollback plan: revert symlink
migrat: none pending
LOG
        exit 0
        ;;
    esac
    ;;
esac
exit 1
SHIM
  chmod +x "$bindir/gh"
  PATH="$bindir:$PATH" "$@" > "$logfile" 2>&1
  return $?
}

# Re-point deploy script's repo root resolution at our fake repo for every
# case. The script does `git -C "$REPO_ROOT" fetch origin "$REF"`; REPO_ROOT
# is derived from the script's own path (two dirs up), which is the real
# repo root — not our fake one. So we run a copy of the script with
# REPO_ROOT overridden via a tiny wrapper.
WRAPPED="$(fresh_dir)/deploy-and-watch.sh"
sed "s#^REPO_ROOT=.*#REPO_ROOT=\"$GIT_REPO\"#" "$DEPLOY_SCRIPT" > "$WRAPPED"
chmod +x "$WRAPPED"

# --- Case 1: sha mismatch -> refuses, never dispatches ----------------------
GH_ARGV_LOG="$(mktemp)"
: > "$GH_ARGV_LOG"
LOG1="$(mktemp)"
run_deploy success "$LOG1" "$WRAPPED" 2026-09-08 "$DRIFT_SHA" > /dev/null 2>&1
RC1=$?
if [ "$RC1" -ne 0 ] && grep -q "refusing" "$LOG1"; then
  pass "case 1: sha mismatch refuses (exit $RC1)"
else
  fail "case 1: expected non-zero exit + 'refusing' message, got rc=$RC1"; cat "$LOG1"
fi
if [ ! -s "$GH_ARGV_LOG" ]; then
  pass "case 1: gh never invoked on a sha mismatch"
else
  fail "case 1: gh was invoked despite sha mismatch"; cat "$GH_ARGV_LOG"
fi

# --- Case 2: sha match -> dispatches the exact gh workflow run command -----
GH_ARGV_LOG="$(mktemp)"
: > "$GH_ARGV_LOG"
LOG2="$(mktemp)"
run_deploy success "$LOG2" "$WRAPPED" 2026-09-08 "$GOOD_SHA"
RC2=$?
if [ "$RC2" -eq 0 ]; then
  pass "case 2: matching sha deploy exits 0"
else
  fail "case 2: matching sha deploy exited $RC2"; cat "$LOG2"
fi
EXPECTED_DISPATCH="workflow run deploy-linux.yml --ref release/prod-2026-09-08 -f slot=prod -f ref=$GOOD_SHA"
if grep -qF "$EXPECTED_DISPATCH" "$GH_ARGV_LOG"; then
  pass "case 2: dispatches exactly '$EXPECTED_DISPATCH'"
else
  fail "case 2: expected dispatch line not found"; cat "$GH_ARGV_LOG"
fi
if grep -qF "run watch 999 --exit-status" "$GH_ARGV_LOG"; then
  pass "case 2: watches with 'gh run watch <id> --exit-status'"
else
  fail "case 2: expected watch line not found"; cat "$GH_ARGV_LOG"
fi
if grep -qF -- "--branch release/prod-2026-09-08 --event workflow_dispatch" "$GH_ARGV_LOG"; then
  pass "case 2: run list scoped to the release branch + workflow_dispatch event"
else
  fail "case 2: run list not scoped as expected"; cat "$GH_ARGV_LOG"
fi
if grep -qF "run id: 999" "$LOG2" && ! grep -qF "run id: 111" "$LOG2"; then
  pass "case 2: picks the prod run (999) not the earlier-created staging run (111)"
else
  fail "case 2: did not pick the correct (dispatch-time-scoped) run id"; cat "$LOG2"
fi
if grep -q "probe port 3000 responded 200" "$LOG2" && grep -q "release_scraper_cycle_locks acquired" "$LOG2"; then
  pass "case 2: prints the grep of key proof log lines"
else
  fail "case 2: proof log lines missing from output"; cat "$LOG2"
fi
STATE_FILE="$(grep -oE 'wrote state file: .*' "$LOG2" | sed 's/wrote state file: //')"
if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ] && grep -q '"runId":"999"' "$STATE_FILE"; then
  pass "case 2: writes the run id to a state file"
else
  fail "case 2: state file missing or wrong run id"; cat "$STATE_FILE" 2>/dev/null
fi

# --- Case 3: watch fails -> non-zero exit + rollback command printed -------
GH_ARGV_LOG="$(mktemp)"
: > "$GH_ARGV_LOG"
LOG3="$(mktemp)"
run_deploy fail "$LOG3" "$WRAPPED" 2026-09-08 "$GOOD_SHA"
RC3=$?
if [ "$RC3" -ne 0 ]; then
  pass "case 3: failed run watch exits non-zero (rc=$RC3)"
else
  fail "case 3: failed run watch exited 0"
fi
if grep -qF "rollback command: gh workflow run deploy-linux.yml --ref release/prod-2026-09-08 -f slot=prod -f ref=$GOOD_SHA" "$LOG3"; then
  pass "case 3: prints rollback command with the previous prod tag sha ($GOOD_SHA)"
else
  fail "case 3: rollback command missing or wrong sha"; cat "$LOG3"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "ALL PASS"
  exit 0
else
  echo "SOME TESTS FAILED"
  exit 1
fi
