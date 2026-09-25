#!/usr/bin/env bash
# pre-push-local.sh — runs, for the refs a push actually sends, a subset of the
# SAME checks .github/workflows/pr-gate.yml runs, and refuses the push on failure.
#
# WHY (owner directive 2026-09-25, run-discipline.md B3): 44 of 149 PR Gate runs
# failed on repeats of the SAME misses — an integration test missing from CI's
# run list, a ratchet/baseline drift, `type-check:scripts`, `render-board --check`,
# `lint:ci` — because nothing ran any of this before the push. This script is the
# local mirror; pr-gate.yml stays the ground truth.
#
# WHAT IS GATED: git's pre-push hook receives one line per pushed ref on STDIN:
#   <local ref> <local sha> <remote ref> <remote sha>
# (.husky/pre-push passes it through with --stdin.) Per line:
#   - local sha all zeros  -> a delete: skipped, nothing to check;
#   - refs/tags/*          -> a tag: skipped;
#   - remote sha non-zero and known locally -> range <remote sha>..<local sha>
#     (an update or a force-push: exactly what the remote does not have yet);
#   - otherwise (new branch)  -> range $(git merge-base origin/main <local sha>)..<local sha>.
# The union of those ranges' changed paths picks the checks.
#
# WHICH TREE IS CHECKED: the checks run in THIS working tree, so the gate refuses
# unless every gated ref's sha equals HEAD and tracked files are unmodified
# (approach (a)). A temporary `git worktree add --detach` of the pushed sha was
# rejected: a fresh worktree has no node_modules, so every check would fail or
# the worktree would need node_modules junctions, and removing junctioned
# worktrees has wiped the main checkout twice (2026-07, 2026-08-24).
#
# Usage:
#   scripts/ci/pre-push-local.sh --stdin [remote] [url]   # what .husky/pre-push runs
#   scripts/ci/pre-push-local.sh                          # gate merge-base(origin/main)..HEAD
#   scripts/ci/pre-push-local.sh --range=A..B             # gate an explicit range
#   add --plan to any of the above: print the plan (and the tree verdict), run nothing
#
# Escape hatch: PRE_PUSH_LOCAL_SKIP=1 git push   (prints a warning; never silent)
set -u

# git exports GIT_DIR into hooks (from a linked worktree: .git/worktrees/<name>).
# Every check below may spawn tests that build throwaway repos; with GIT_DIR
# inherited, their `git init` / `git config user.*` / `git commit` in a temp dir
# hit THIS repository instead (2026-09-25: core.bare=true + [user] Test in the
# shared .git/config, fixture commits on the pushed branch, files overwritten).
# Neither `cd` nor `git -C` overrides an exported GIT_DIR, so drop git's
# repo-local variables here; after the cd below, git finds this repo from cwd.
for v in GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT          GIT_OBJECT_DIRECTORY GIT_DIR GIT_WORK_TREE GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE          GIT_INDEX_FILE GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE GIT_PREFIX GIT_SHALLOW_FILE          GIT_COMMON_DIR $(git rev-parse --local-env-vars 2>/dev/null); do
  unset "$v"
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PLAN_ONLY=0
RANGE_OVERRIDE=""
READ_STDIN=0
for arg in "$@"; do
  case "$arg" in
    --plan) PLAN_ONLY=1 ;;
    --range=*) RANGE_OVERRIDE="${arg#--range=}" ;;
    --stdin) READ_STDIN=1 ;;
    *) ;; # positional remote name / url from git: informational only
  esac
done

if [ "${PRE_PUSH_LOCAL_SKIP:-0}" = "1" ] && [ "$PLAN_ONLY" = "0" ]; then
  echo "WARNING: pre-push-local gate SKIPPED (PRE_PUSH_LOCAL_SKIP=1). This push was NOT verified locally." >&2
  exit 0
fi

is_zero_sha() {
  case "$1" in
    *[!0]*) return 1 ;;
    *) return 0 ;;
  esac
}

EMPTY_TREE="$(git hash-object -t tree /dev/null)"

# Base for a ref the remote does not have yet: where it forked from main.
fork_base() {
  local tip="$1" ref mb
  for ref in refs/remotes/origin/main refs/heads/main; do
    if git rev-parse --verify -q "$ref" >/dev/null; then
      mb="$(git merge-base "$ref" "$tip" 2>/dev/null)"
      if [ -n "$mb" ]; then echo "$mb"; return; fi
    fi
  done
  echo "$EMPTY_TREE"
}

# ---- 1. Collect the ranges to gate: "base tip localref" ---------------------
RANGES=()
if [ -n "$RANGE_OVERRIDE" ]; then
  RANGES+=("$(git rev-parse "${RANGE_OVERRIDE%%..*}") $(git rev-parse "${RANGE_OVERRIDE#*..}") ${RANGE_OVERRIDE#*..}")
elif [ "$READ_STDIN" = "1" ]; then
  while read -r lref lsha rref rsha; do
    [ -z "${lref:-}" ] && continue
    if is_zero_sha "$lsha"; then
      echo "pre-push-local: $rref is a delete — nothing to check."
      continue
    fi
    case "$rref" in
      refs/tags/*) echo "pre-push-local: $rref is a tag — nothing to check."; continue ;;
    esac
    case "$lref" in
      refs/tags/*) echo "pre-push-local: $lref is a tag — nothing to check."; continue ;;
    esac
    if ! is_zero_sha "$rsha" && git cat-file -e "${rsha}^{commit}" 2>/dev/null; then
      base="$rsha"
    else
      base="$(fork_base "$lsha")"
    fi
    RANGES+=("$base $lsha $lref")
  done
else
  RANGES+=("$(fork_base HEAD) $(git rev-parse HEAD) HEAD")
fi

if [ "${#RANGES[@]}" -eq 0 ]; then
  echo "pre-push-local: no branch commits in this push — nothing to check."
  exit 0
fi

CHANGED_FILES=""
RANGE_DESC=""
for r in "${RANGES[@]}"; do
  set -- $r
  CHANGED_FILES="$CHANGED_FILES
$(git diff --name-only "$1" "$2" 2>/dev/null)"
  RANGE_DESC="$RANGE_DESC ${1:0:8}..${2:0:8}($3)"
done
CHANGED_FILES="$(printf '%s\n' "$CHANGED_FILES" | sed '/^$/d' | sort -u)"
RANGE_DESC="${RANGE_DESC# }"

if [ -z "$CHANGED_FILES" ]; then
  echo "pre-push-local: no changed files in $RANGE_DESC — nothing to check."
  exit 0
fi

matches() { printf '%s\n' "$CHANGED_FILES" | grep -qE "$1"; }

HAS_WEB=0;        matches '^web/' && HAS_WEB=1
HAS_SHARED=0;     matches '^packages/shared/' && HAS_SHARED=1
HAS_SCRAPER=0;    matches '^scraper/' && HAS_SCRAPER=1
HAS_ROOT_PKG=0;   matches '^(package\.json|package-lock\.json)$' && HAS_ROOT_PKG=1
HAS_DESIGN=0;     matches '^docs/design/|^docs/reviews/' && HAS_DESIGN=1
HAS_HOOKS=0;      matches '^\.claude/hooks/' && HAS_HOOKS=1
HAS_WORKFLOWS=0;  matches '^\.github/' && HAS_WORKFLOWS=1
HAS_OPS=0;        matches '^scripts/ops/' && HAS_OPS=1
DOCS_ONLY=0
printf '%s\n' "$CHANGED_FILES" | grep -qvE '(^|/)[^/]+\.md$|^docs/' || DOCS_ONLY=1

RUN_WEB=0;     { [ "$HAS_WEB" = "1" ] || [ "$HAS_SHARED" = "1" ] || [ "$HAS_ROOT_PKG" = "1" ]; } && RUN_WEB=1
RUN_SCRAPER=0; { [ "$HAS_SCRAPER" = "1" ] || [ "$HAS_SHARED" = "1" ] || [ "$HAS_ROOT_PKG" = "1" ]; } && RUN_SCRAPER=1

# Docs fast path: a push of only *.md / docs/** never runs code checks, even
# when a README lives under web/ or scraper/.
if [ "$DOCS_ONLY" = "1" ]; then
  RUN_WEB=0
  RUN_SCRAPER=0
fi

# ---- 2. Build the ordered check plan: "name|workdir|command" ---------------
CHECKS=()
add() { CHECKS+=("$1|$2|$3"); }

# Companion test for a touched file: the touched test itself, or a test named
# after the touched source that exists in this tree (same file CI runs by name).
companion_cmd() {
  case "$1" in
    *.test.mjs|*.test.js) echo "node --test $1" ;;
    *.test.ts) echo "npx tsx --test $1" ;;
    *.test.sh) echo "bash $1" ;;
    *.test.py|*/test_*.py) echo "python $1" ;;
  esac
}
COMPANIONS=""
for f in $(printf '%s\n' "$CHANGED_FILES" | grep -E '^scripts/|^\.claude/hooks/' || true); do
  if [ -n "$(companion_cmd "$f")" ]; then
    [ -f "$f" ] && COMPANIONS="$COMPANIONS $f"
    continue
  fi
  b="$(basename "$f")"; b="${b%.*}"
  for t in "scripts/tests/$b.test.mjs" "scripts/tests/$b.test.ts" "scripts/tests/$b.test.sh" \
           "scripts/ci/tests/$b.test.mjs" ".claude/hooks/tests/$b.test.py" ".claude/hooks/tests/$b.test.mjs" \
           ".claude/hooks/tests/test_$(echo "$b" | tr '-' '_').py"; do
    [ -f "$t" ] && COMPANIONS="$COMPANIONS $t"
  done
done
COMPANIONS="$(printf '%s\n' $COMPANIONS | sed '/^$/d' | sort -u)"

if [ "$DOCS_ONLY" = "0" ]; then
  # Every code push: the two repo-wide ratchets CI runs on every PR. A code
  # push therefore never maps to "no checks".
  add "Write ratchet (no new direct ipos writers)" "." "node scripts/check-write-ratchet.mjs"
  add "Fixture provenance gate (T-518)" "." "node scripts/ci/require-fixture-provenance.mjs"
fi

if [ "$RUN_WEB" = "1" ] || [ "$RUN_SCRAPER" = "1" ]; then
  # web and scraper import @ipodhan/shared's compiled dist/ (CLAUDE.md). A stale
  # dist/ gives TS6305 errors that mask whatever the push actually broke.
  add "Build shared package" "." "rm -rf packages/shared/dist packages/shared/tsconfig.tsbuildinfo && cd packages/shared && npx tsc"
fi

if [ "$RUN_SCRAPER" = "1" ]; then
  TOUCHED_SCRAPER_TESTS="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^scraper/.*\.test\.ts$' | sed 's|^scraper/||' || true)"
  if [ -n "$TOUCHED_SCRAPER_TESTS" ]; then
    add "Scraper targeted unit tests" "scraper" "npx vitest run --config vitest.config.ts $(printf '%s ' $TOUCHED_SCRAPER_TESTS)"
  fi
  # 73 scripts under scraper/scripts import scraper/src and @ipodhan/shared, so
  # any change under either can break them.
  add "Scraper scripts type-check" "scraper" "npm run type-check:scripts"
  add "Integration-test coverage gate (#507, static, no DB)" "." "node scripts/ci/require-integration-test-coverage.mjs"
  add "Detection-change gate self-test" "." "node --test scripts/ci/tests/require-detection-change.test.mjs"
fi

if [ "$RUN_WEB" = "1" ]; then
  add "Web type-check (tsc --noEmit)" "web" "npx tsc --noEmit"
  add "Web lint (lint:ci)" "web" "npm run lint:ci"
  TOUCHED_WEB_TESTS="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^web/.*\.(test|spec)\.(ts|tsx)$' | sed 's|^web/||' || true)"
  if [ -n "$TOUCHED_WEB_TESTS" ]; then
    add "Web targeted unit tests" "web" "npx vitest run $(printf '%s ' $TOUCHED_WEB_TESTS)"
  fi
fi

if [ "$HAS_DESIGN" = "1" ] || [ "$DOCS_ONLY" = "1" ]; then
  add "Design consistency gate" "." "node docs/design/check-design-consistency.mjs --gate"
  add "Design traceability (OD-52)" "." "node scripts/ci/check-design-traceability.mjs --base origin/main"
  add "Detection registry aggregates not stale" "." "node scripts/build-detection-registry.mjs --check"
fi
if [ "$HAS_DESIGN" = "1" ] || [ "$DOCS_ONLY" = "1" ] || [ "$HAS_OPS" = "1" ]; then
  add "Plan board sections not stale" "." "node scripts/ops/build-plan-board.mjs --check"
  add "Rendered board not stale" "." "node scripts/ops/render-board.mjs --check"
fi

if [ "$HAS_WORKFLOWS" = "1" ]; then
  add "Workflow ASCII + YAML parse" "." "node scripts/check-workflow-ascii.js"
fi

if [ "$HAS_HOOKS" = "1" ]; then
  add "Board-owed-guard hook self-tests" "." "BOARD_OWED_NO_REGEN=1 python .claude/hooks/tests/board-owed-guard.test.py"
fi

for t in $COMPANIONS; do
  add "Companion test $t" "." "$(companion_cmd "$t")"
done

# ---- 3. Tree guard: the checks run on THIS tree, so it must be the pushed one
TREE_REFUSAL=""
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)"
for r in "${RANGES[@]}"; do
  set -- $r
  if [ "$(git rev-parse "$2^{commit}" 2>/dev/null)" != "$HEAD_SHA" ]; then
    name="${3#refs/heads/}"
    TREE_REFUSAL="${TREE_REFUSAL}  - $3 (${2:0:8}) is not the checked-out commit (HEAD ${HEAD_SHA:0:8}).
    Check out $name to push it, or PRE_PUSH_LOCAL_SKIP=1 git push to bypass with a warning.
"
  fi
done
if [ -z "$TREE_REFUSAL" ] && ! git diff --quiet HEAD -- 2>/dev/null; then
  TREE_REFUSAL="  - tracked files have uncommitted changes, so this tree is not the pushed commit.
    Commit them first, or PRE_PUSH_LOCAL_SKIP=1 git push to bypass with a warning.
"
fi

# The detection-change gate reads the PR body only when GH_PR_NUMBER is set, so
# locally it would refuse a declaration that lives in the PR body. It runs in CI.
DETECTION_NOTE=""
[ "$RUN_SCRAPER" = "1" ] && DETECTION_NOTE="note: detection-change gate runs in CI on the PR (it reads the PR body); not run locally."

# ---- 4. Plan mode: print and exit, run nothing ------------------------------
if [ "$PLAN_ONLY" = "1" ]; then
  echo "pre-push-local plan (ranges: $RANGE_DESC)"
  echo "  RUN_WEB=$RUN_WEB RUN_SCRAPER=$RUN_SCRAPER HAS_DESIGN=$HAS_DESIGN HAS_HOOKS=$HAS_HOOKS DOCS_ONLY=$DOCS_ONLY HAS_WORKFLOWS=$HAS_WORKFLOWS HAS_OPS=$HAS_OPS"
  i=0
  for c in "${CHECKS[@]}"; do
    i=$((i+1))
    name="${c%%|*}"; rest="${c#*|}"; workdir="${rest%%|*}"; cmd="${rest#*|}"
    echo "  $i. [$workdir] $name -- $cmd"
  done
  [ -n "$DETECTION_NOTE" ] && echo "  $DETECTION_NOTE"
  if [ -n "$TREE_REFUSAL" ]; then echo "  tree-guard: WOULD REFUSE"; printf '%s' "$TREE_REFUSAL"; else echo "  tree-guard: ok"; fi
  exit 0
fi

if [ "${#CHECKS[@]}" -eq 0 ]; then
  echo "pre-push-local: no path in $RANGE_DESC maps to a local check. Nothing to run."
  exit 0
fi

if [ -n "$TREE_REFUSAL" ]; then
  echo "=== pre-push-local: REFUSED ==="
  echo "The checks run on the working tree, which is not what this push sends:"
  printf '%s' "$TREE_REFUSAL"
  exit 1
fi

# ---- 5. Execute in order, stop at first failure -----------------------------
LOG_DIR="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/pre-push-local-$$")"
mkdir -p "$LOG_DIR"
echo "pre-push-local: ${#CHECKS[@]} check(s) for $RANGE_DESC"
[ -n "$DETECTION_NOTE" ] && echo "pre-push-local: $DETECTION_NOTE"
START_TIME=$(date +%s)
i=0
for c in "${CHECKS[@]}"; do
  i=$((i+1))
  name="${c%%|*}"; rest="${c#*|}"; workdir="${rest%%|*}"; cmd="${rest#*|}"
  LOG_FILE="$LOG_DIR/check-$i.log"

  printf '[%d/%d] %s ... ' "$i" "${#CHECKS[@]}" "$name"
  (cd "$REPO_ROOT/$workdir" && eval "$cmd") >"$LOG_FILE" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "PASS"
  else
    echo "FAIL"
    echo ""
    echo "=== pre-push-local: REFUSED ==="
    echo "Failing check: $name"
    echo "Command:       (cd $workdir && $cmd)"
    echo "Log:           $LOG_FILE"
    echo "--- last 60 lines ---"
    tail -n 60 "$LOG_FILE"
    echo "---------------------"
    if grep -qiE 'command not found|is not recognized|Cannot find module|could not determine executable|ERR_MODULE_NOT_FOUND|No such file or directory' "$LOG_FILE"; then
      echo "Hint: a tool or module looks missing. Run \`npm ci\` at the repo root (and build packages/shared), then push again."
    fi
    echo ""
    echo "Fix the failure above and push again, or (rare) PRE_PUSH_LOCAL_SKIP=1 git push to bypass with a printed warning."
    exit "$status"
  fi
done

END_TIME=$(date +%s)
echo "pre-push-local: all ${#CHECKS[@]} check(s) passed in $((END_TIME - START_TIME))s."
exit 0
