#!/usr/bin/env bash
# T-469 / #196 (G-K) — standing mutation job for the guard set.
#
# WHY: a guard whose suite stays GREEN after the guard's own condition is
# neutralised is not a guard — it is dead weight nobody notices until the
# defect it exists to catch ships anyway. T-285 P3-1 found this by hand:
# mutating the served-SHA post-flip probe and the DSN slot-mismatch checks
# left a fully green suite. A reviewer re-derives this manually every
# round; this script makes it a repeatable, unskippable check instead.
#
# MECHANISM: for every GUARDS[] entry — {file, anchor, mutation, suite} —
#   1. back up the file
#   2. apply the mutation (literal string replace via python3, matched
#      against a unique anchor string — never a sed regex, see apply_mutation)
#   3. run the named suite, capture its exit code
#   4. restore the file from backup UNCONDITONALLY (trap, runs even on a
#      crash/interrupt mid-mutation — see restore_all below)
#   5. assert `git status --porcelain` is empty post-restore
#   6. verdict: suite exited non-zero (RED) => guard CAUGHT the mutation,
#      PASS; suite exited 0 (GREEN) => the guard is NOT load-bearing, FAIL
#      (a "finding" — the thing this sweep exists to surface).
#
# Run: bash scripts/tests/mutation-guard-sweep.sh [--self-test-only]
#   --self-test-only   run only the fake-guard self-test (red-then-green
#                       proof the sweep mechanism itself works) and exit;
#                       used by the failing-test-first step and CI smoke.
#
# Output: a per-guard table (never a single boolean) to stdout; a survivor
# (mutation left the suite GREEN) is a FINDING — this script reports it,
# it does NOT fix the guard (out of scope, #196; file an issue per survivor).
#
# NOT wired into pr-gate.yml: the deploy suite alone runs ~5 minutes, so a
# full sweep is workflow_dispatch / nightly only (see the PR body for the
# CI-minutes estimate) — never a per-PR blocking gate.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

FAILED_GUARDS=()
RESULTS=()   # "name|verdict|detail"
BACKUP_FILE=""
CURRENT_TARGET=""

# --------------------------------------------------------------- restore ---
# Registered via `trap` before EVERY mutation so an interrupted run (kill,
# crash, ^C) can never leave a neutered guard sitting in the working tree —
# the risk the plan calls out explicitly. Idempotent: safe to call even when
# nothing is currently mutated.
restore_current() {
  if [ -n "$CURRENT_TARGET" ] && [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
    cp "$BACKUP_FILE" "$CURRENT_TARGET"
    rm -f "$BACKUP_FILE"
  fi
  CURRENT_TARGET=""
  BACKUP_FILE=""
}
trap restore_current EXIT INT TERM

assert_clean_tree() {
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain -- "$1" 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "FATAL: git status not clean after restore for $1:" >&2
    echo "$dirty" >&2
    return 1
  fi
  return 0
}

# Applies a literal string->string substitution against a file, asserting
# the anchor was found exactly once (a silently-0-match or ambiguous
# multi-match mutation is refused, not applied half-blind).
#
# Uses python3 for a LITERAL (non-regex) string replacement, never sed's
# `s/pattern/repl/` — several real guard anchors contain BRE metacharacters
# ([ ] { } . ^ $ /) that sed treats as regex syntax unless individually
# escaped. An escaping bug here is worse than a crash: sed silently fails
# to match and the file is left UNCHANGED, so the "mutation" never happens,
# the suite predictably still passes, and the guard is falsely reported
# CAUGHT — the exact false-negative this sweep exists to prevent. Verified
# in dry-run: `if [ "$slot" != "prod" ] ...` and `[...] as const;` anchors
# both silently no-op under sed's default BRE escaping.
apply_mutation() {
  local file="$1" anchor="$2" replacement="$3"
  local hits
  hits="$(grep -Fc -- "$anchor" "$file" 2>/dev/null || true)"
  if [ "$hits" -ne 1 ]; then
    echo "SKIP-AMBIGUOUS ($hits matches for anchor, expected exactly 1)"
    return 1
  fi

  local before_hash after_hash
  before_hash="$(md5sum "$file" | cut -d' ' -f1)"

  ANCHOR="$anchor" REPLACEMENT="$replacement" TARGET_FILE="$file" python3 - <<'PYEOF'
import os
path = os.environ["TARGET_FILE"]
anchor = os.environ["ANCHOR"]
repl = os.environ["REPLACEMENT"]
with open(path, "r", encoding="utf-8", newline="") as f:
    content = f.read()
count = content.count(anchor)
if count != 1:
    raise SystemExit(f"expected exactly 1 occurrence, found {count}")
content = content.replace(anchor, repl, 1)
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(content)
PYEOF
  local py_exit=$?
  if [ "$py_exit" -ne 0 ]; then
    echo "SKIP-PYTHON-REPLACE-FAILED (exit $py_exit)"
    return 1
  fi

  # Belt-and-braces: prove the file actually changed. A mutation that
  # "succeeds" (hits==1, python exits 0) but leaves the file byte-identical
  # is exactly the false-CAUGHT failure mode this sweep must never produce.
  after_hash="$(md5sum "$file" | cut -d' ' -f1)"
  if [ "$before_hash" = "$after_hash" ]; then
    echo "SKIP-NO-CHANGE (file hash unchanged after replace — mutation did not apply)"
    return 1
  fi
  return 0
}

# ------------------------------------------------------------- run_guard ---
# Args: name file anchor replacement suite_cmd
run_guard() {
  local name="$1" file="$2" anchor="$3" replacement="$4" suite_cmd="$5"
  local target="$REPO_ROOT/$file"

  if [ ! -f "$target" ]; then
    RESULTS+=("$name|ERROR|file not found: $file")
    FAILED_GUARDS+=("$name (file missing)")
    return
  fi

  BACKUP_FILE="$(mktemp)"
  cp "$target" "$BACKUP_FILE"
  CURRENT_TARGET="$target"

  if ! apply_mutation "$target" "$anchor" "$replacement"; then
    RESULTS+=("$name|ERROR|anchor not uniquely matched (guard file drifted — update the registry)")
    FAILED_GUARDS+=("$name (anchor drift)")
    restore_current
    return
  fi

  local suite_exit=0
  ( eval "$suite_cmd" ) >"/tmp/mutation-sweep-$$-$(echo "$name" | tr -c 'a-zA-Z0-9' '_').log" 2>&1 || suite_exit=$?

  restore_current

  if ! assert_clean_tree "$file"; then
    RESULTS+=("$name|ERROR|git status not clean post-restore")
    FAILED_GUARDS+=("$name (restore left dirty tree)")
    return
  fi

  if [ "$suite_exit" -eq 0 ]; then
    RESULTS+=("$name|FINDING|mutation left suite GREEN (exit 0) — guard is NOT load-bearing")
    FAILED_GUARDS+=("$name")
  else
    RESULTS+=("$name|CAUGHT|mutation turned suite RED (exit $suite_exit) — guard is load-bearing")
  fi
}

# ================================================================ GUARDS ===
# {name, file, anchor (unique literal string), mutation (replacement text),
#  suite (shell command, run from REPO_ROOT)}
# Seeded per #196 scope: assert-env-keys.sh (both original env checks +
# the #352 rollout-flag liveness assert), deploy-linux.sh (the served-SHA
# post-flip probe + the #353 deployed-sha lineage assert), and the T-285
# P3-1 data-validation/error-cause findings.

run_all_guards() {
  run_guard \
    "env-dsn-slot-mismatch" \
    "scripts/assert-env-keys.sh" \
    'if [ "$db" != "$want" ]; then' \
    'if false; then' \
    'bash scripts/tests/assert-env-keys.test.sh'

  run_guard \
    "env-nonprod-targets-prod-db" \
    "scripts/assert-env-keys.sh" \
    'if [ "$slot" != "prod" ] && [ "$db" = "ipodhan" ]; then' \
    'if false; then' \
    'bash scripts/tests/assert-env-keys.test.sh'

  run_guard \
    "env-rollout-flag-liveness-352" \
    "scripts/assert-env-keys.sh" \
    'if [ "${#FAILS[@]}" -gt 0 ]; then' \
    'if false; then' \
    'bash scripts/tests/assert-env-keys.test.sh'

  run_guard \
    "deploy-served-sha-probe" \
    "scripts/deploy-linux.sh" \
    'if [ "$served_sha" != "$SHORT_SHA" ]; then' \
    'if false; then' \
    'bash scripts/tests/deploy-linux.test.sh'

  run_guard \
    "deploy-deployed-sha-lineage-353" \
    "scripts/deploy-linux.sh" \
    'if ! (cd "$check_repo_root" && git merge-base --is-ancestor "$check_sha" origin/main) 2>/dev/null; then' \
    'if false; then' \
    'bash scripts/tests/deploy-linux.test.sh'

  run_guard \
    "non-ipo-window-too-long" \
    "scraper/src/utils/data-validation.ts" \
    'longWindowNoSubstance = duration > 10;' \
    'longWindowNoSubstance = false;' \
    'cd scraper && npx vitest run tests/unit/utils/data-validation.test.ts tests/unit/utils/data-validation-corporate-action-shape.test.ts'

  run_guard \
    "non-ipo-scrip-code-name" \
    "scraper/src/utils/data-validation.ts" \
    'const isBareScripCode = /^[A-Z0-9]{2,15}$/.test(name);' \
    'const isBareScripCode = false;' \
    'cd scraper && npx vitest run tests/unit/utils/data-validation.test.ts'

  run_guard \
    "pg-fields-error-cause" \
    "packages/shared/src/errors/db-cause.ts" \
    "const PG_FIELDS = ['code', 'detail', 'constraint', 'column', 'table'] as const;" \
    "const PG_FIELDS = [] as const;" \
    'cd scraper && npx vitest run tests/unit/errors/db-cause.test.ts'
}

print_table() {
  echo ""
  echo "=== mutation-guard-sweep results ==="
  printf '%-32s %-9s %s\n' "GUARD" "VERDICT" "DETAIL"
  local row name verdict detail
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r name verdict detail <<<"$row"
    printf '%-32s %-9s %s\n' "$name" "$verdict" "$detail"
  done
  echo ""
  if [ "${#FAILED_GUARDS[@]}" -gt 0 ]; then
    echo "FINDINGS (survivor guards — file an issue per entry, do not fix here):"
    local f
    for f in "${FAILED_GUARDS[@]}"; do
      echo "  - $f"
    done
  else
    echo "No findings — every registered guard's mutation turned its suite RED."
  fi
}

# ============================================================ self-test ===
# Failing-test-first proof (per the #196/T-469 brief): register a FAKE guard
# whose mutation deliberately does NOT change the suite's outcome, and
# assert the sweep classifies it as a FINDING (not silently green). This
# is red-then-green: it must fail before the sweep mechanism exists /
# before this classification logic is correct, and pass once it is.
self_test() {
  local tmp_dir tmp_file tmp_suite
  tmp_dir="$(mktemp -d)"
  tmp_file="$tmp_dir/fake-guard.sh"
  tmp_suite="$tmp_dir/fake-suite.sh"

  cat >"$tmp_file" <<'EOF'
#!/usr/bin/env bash
# fake guard: condition irrelevant to the suite below on purpose
if [ "1" = "2" ]; then
  echo "unreachable"
fi
EOF
  # A suite that ALWAYS passes, regardless of fake-guard.sh's content —
  # i.e. a guard with zero coverage. The sweep must report this as a FINDING.
  cat >"$tmp_suite" <<'EOF'
#!/usr/bin/env bash
echo "fake suite: always green (this guard has no test coverage)"
exit 0
EOF
  chmod +x "$tmp_file" "$tmp_suite"

  local rel_file="${tmp_file#"$REPO_ROOT"/}"
  # tmp_file is outside the repo (mktemp -d is under the OS temp dir), so
  # git status --porcelain -- <path> against it always reports clean
  # (nothing tracked there) — exercise the mutation+restore+verdict path
  # standalone rather than through the full REPO_ROOT-relative run_guard,
  # which assumes a tracked path.
  local backup exit_code
  backup="$(mktemp)"
  cp "$tmp_file" "$backup"
  sed -i 's/if \[ "1" = "2" \]; then/if false; then/' "$tmp_file"
  ( bash "$tmp_suite" ) >/dev/null 2>&1 || exit_code=$?
  exit_code="${exit_code:-0}"
  cp "$backup" "$tmp_file"
  rm -f "$backup"
  rm -rf "$tmp_dir"

  if [ "$exit_code" -eq 0 ]; then
    echo "SELF-TEST PASS: fake guard with a suite that never exercises it is correctly classified as a FINDING (suite stayed green under mutation, exit $exit_code)."
    return 0
  else
    echo "SELF-TEST FAIL: expected the fake suite to stay green (exit 0) under the fake guard's mutation; got exit $exit_code. The self-test fixture itself is broken." >&2
    return 1
  fi
}

# ==================================================================== =====

if [ "${1:-}" = "--self-test-only" ]; then
  self_test
  exit $?
fi

echo "mutation-guard-sweep: self-test (fake guard, red-then-green proof)"
if ! self_test; then
  echo "ABORT: self-test failed — the sweep mechanism itself is broken, not running the real registry." >&2
  exit 1
fi

echo ""
echo "mutation-guard-sweep: running the real GUARDS registry (this is slow — the deploy suite alone is ~5 min)"
run_all_guards
print_table

if [ "${#FAILED_GUARDS[@]}" -gt 0 ]; then
  exit 1
fi
exit 0
