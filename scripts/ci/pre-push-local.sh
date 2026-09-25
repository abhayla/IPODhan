#!/usr/bin/env bash
# pre-push-local.sh — runs, for the trees a push touches, a subset of the SAME
# checks .github/workflows/pr-gate.yml runs, and refuses the push on failure.
#
# WHY (owner directive 2026-09-25, run-discipline.md B3): 44 of 149 PR Gate runs
# failed on repeats of the SAME misses — an integration test missing from CI's
# run list, a ratchet/baseline drift, `type-check:scripts`, `render-board --check`,
# `lint:ci` — because nothing ran any of this before the push. This script is the
# local mirror; it does not replace pr-gate.yml (which stays the ground truth),
# it catches the repeat-miss class before a push burns an Actions run on it.
#
# Scope: this deliberately does NOT try to run every one of pr-gate.yml's ~80
# steps (several need a live Postgres/Redis service container CI provisions and
# this script does not — the DB-integration test files themselves, the
# scraper-document-integration job's migration replay). It runs: web
# tsc+lint+targeted unit tests, scraper targeted vitest + type-check:scripts +
# the (static, DB-free) integration coverage/detection-change/ratchet gates,
# and the design/docs/board generators' --check modes. Path-mapped from the
# actual pushed diff, same idea as pr-gate.yml's own path filtering.
#
# Usage:
#   scripts/ci/pre-push-local.sh              # run for real
#   scripts/ci/pre-push-local.sh --plan       # print the check plan only, run nothing
#   scripts/ci/pre-push-local.sh --range A..B # override the diff range (tests use this)
#
# Escape hatch: PRE_PUSH_LOCAL_SKIP=1 git push   (prints a warning; never silent)
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

PLAN_ONLY=0
RANGE_OVERRIDE=""
for arg in "$@"; do
  case "$arg" in
    --plan) PLAN_ONLY=1 ;;
    --range=*) RANGE_OVERRIDE="${arg#--range=}" ;;
  esac
done

if [ "${PRE_PUSH_LOCAL_SKIP:-0}" = "1" ] && [ "$PLAN_ONLY" = "0" ]; then
  echo "WARNING: pre-push-local gate SKIPPED (PRE_PUSH_LOCAL_SKIP=1). This push was NOT verified locally." >&2
  exit 0
fi

LOG_DIR="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/pre-push-local-$$")"
mkdir -p "$LOG_DIR"

# ---- 1. Determine the diff range -------------------------------------------
if [ -n "$RANGE_OVERRIDE" ]; then
  RANGE="$RANGE_OVERRIDE"
else
  BASE_REF="origin/main"
  git rev-parse --verify "$BASE_REF" >/dev/null 2>&1 || BASE_REF="main"
  if git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
    MERGE_BASE="$(git merge-base HEAD "$BASE_REF" 2>/dev/null)"
  else
    MERGE_BASE=""
  fi
  if [ -z "$MERGE_BASE" ]; then
    # First push of a fresh repo / detached history: diff against the empty tree.
    MERGE_BASE="$(git hash-object -t tree /dev/null)"
  fi
  RANGE="${MERGE_BASE}..HEAD"
fi

CHANGED_FILES="$(git diff --name-only $RANGE 2>/dev/null)"
if [ -z "$CHANGED_FILES" ]; then
  # Nothing to diff (e.g. pushing a tag, or no commits ahead) — nothing to gate.
  echo "pre-push-local: no changed files in range $RANGE — nothing to check."
  exit 0
fi

has_prefix() {
  local prefix="$1"
  printf '%s\n' "$CHANGED_FILES" | grep -q "^${prefix}"
}

only_docs() {
  ! printf '%s\n' "$CHANGED_FILES" | grep -qvE '(^|/)[^/]+\.md$|^docs/'
}

HAS_WEB=0;        has_prefix 'web/' && HAS_WEB=1
HAS_SHARED=0;     has_prefix 'packages/shared/' && HAS_SHARED=1
HAS_SCRAPER=0;    has_prefix 'scraper/' && HAS_SCRAPER=1
HAS_SCRAPER_SCRIPTS=0; has_prefix 'scraper/scripts/' && HAS_SCRAPER_SCRIPTS=1
HAS_RATCHET_PATHS=0
printf '%s\n' "$CHANGED_FILES" | grep -qE '^scraper/src/services/|^scraper/src/scrapers/|^scraper/src/config/field-priority-matrix\.ts$|^scraper/scripts/.*\.py$' && HAS_RATCHET_PATHS=1
HAS_DESIGN=0;     printf '%s\n' "$CHANGED_FILES" | grep -qE '^docs/design/|^docs/reviews/' && HAS_DESIGN=1
HAS_HOOKS=0;      has_prefix '\.claude/hooks/' && HAS_HOOKS=1
DOCS_ONLY=0;      only_docs && DOCS_ONLY=1

if [ "$HAS_WEB" = "1" ] || [ "$HAS_SHARED" = "1" ]; then RUN_WEB=1; else RUN_WEB=0; fi
if [ "$HAS_SCRAPER" = "1" ]; then RUN_SCRAPER=1; else RUN_SCRAPER=0; fi

if [ "$DOCS_ONLY" = "1" ]; then
  RUN_WEB=0
  RUN_SCRAPER=0
fi

# ---- 2. Build the ordered check plan: "name|workdir|command" ---------------
CHECKS=()

if [ "$HAS_RATCHET_PATHS" = "1" ]; then
  CHECKS+=("Write ratchet (no new direct ipos writers)|.|node scripts/check-write-ratchet.mjs")
fi

if [ "$RUN_SCRAPER" = "1" ]; then
  # Targeted vitest on touched test files (fast path); falls back to no-op if
  # the touched set has no *.test.ts under scraper/ (source-only changes still
  # get the type-check + integration/detection static gates below).
  TOUCHED_SCRAPER_TESTS="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^scraper/.*\.test\.ts$' | sed 's|^scraper/||' || true)"
  if [ -n "$TOUCHED_SCRAPER_TESTS" ]; then
    REL_LIST="$(printf '%s ' $TOUCHED_SCRAPER_TESTS)"
    CHECKS+=("Scraper targeted unit tests|scraper|npx vitest run --config vitest.config.ts $REL_LIST")
  fi
  if [ "$HAS_SCRAPER_SCRIPTS" = "1" ]; then
    CHECKS+=("Scraper scripts type-check|scraper|npm run type-check:scripts")
  fi
  CHECKS+=("Integration-test coverage gate (#507, static, no DB)|.|node scripts/ci/require-integration-test-coverage.mjs")
  CHECKS+=("Detection-change gate self-test|.|node --test scripts/ci/tests/require-detection-change.test.mjs")
  CHECKS+=("Detection-change gate (recurrence loop pt.1)|.|node scripts/ci/require-detection-change.mjs origin/main HEAD")
fi

if [ "$RUN_WEB" = "1" ]; then
  CHECKS+=("Web type-check (tsc --noEmit)|web|npx tsc --noEmit")
  CHECKS+=("Web lint (lint:ci)|web|npm run lint:ci")
  TOUCHED_WEB_TESTS="$(printf '%s\n' "$CHANGED_FILES" | grep -E '^web/.*\.(test|spec)\.(ts|tsx)$' | sed 's|^web/||' || true)"
  if [ -n "$TOUCHED_WEB_TESTS" ]; then
    REL_LIST="$(printf '%s ' $TOUCHED_WEB_TESTS)"
    CHECKS+=("Web targeted unit tests|web|npx vitest run $REL_LIST")
  fi
fi

if [ "$HAS_DESIGN" = "1" ] || [ "$DOCS_ONLY" = "1" ]; then
  CHECKS+=("Design consistency gate|.|node docs/design/check-design-consistency.mjs --gate")
  CHECKS+=("Design traceability (OD-52)|.|node scripts/ci/check-design-traceability.mjs --base origin/main")
  CHECKS+=("Plan board sections not stale|.|node scripts/ops/build-plan-board.mjs --check")
  CHECKS+=("Rendered board not stale|.|node scripts/ops/render-board.mjs --check")
  CHECKS+=("Detection registry aggregates not stale|.|node scripts/build-detection-registry.mjs --check")
fi

if [ "$HAS_HOOKS" = "1" ]; then
  CHECKS+=("Board-owed-guard hook self-tests|.|python .claude/hooks/tests/board-owed-guard.test.py")
fi

if [ "${#CHECKS[@]}" -eq 0 ]; then
  echo "pre-push-local: no path in the diff maps to a local check (range $RANGE). Nothing to run."
  exit 0
fi

# ---- 3. Plan mode: print and exit, run nothing ------------------------------
if [ "$PLAN_ONLY" = "1" ]; then
  echo "pre-push-local plan (range: $RANGE)"
  echo "  RUN_WEB=$RUN_WEB RUN_SCRAPER=$RUN_SCRAPER HAS_DESIGN=$HAS_DESIGN HAS_HOOKS=$HAS_HOOKS DOCS_ONLY=$DOCS_ONLY HAS_RATCHET_PATHS=$HAS_RATCHET_PATHS"
  i=0
  for c in "${CHECKS[@]}"; do
    i=$((i+1))
    name="${c%%|*}"
    rest="${c#*|}"
    workdir="${rest%%|*}"
    cmd="${rest#*|}"
    echo "  $i. [$workdir] $name -- $cmd"
  done
  exit 0
fi

# ---- 4. Execute in order, stop at first failure -----------------------------
echo "pre-push-local: ${#CHECKS[@]} check(s) for range $RANGE"
START_TIME=$(date +%s)
i=0
for c in "${CHECKS[@]}"; do
  i=$((i+1))
  name="${c%%|*}"
  rest="${c#*|}"
  workdir="${rest%%|*}"
  cmd="${rest#*|}"
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
    echo ""
    echo "Fix the failure above and push again, or (rare) PRE_PUSH_LOCAL_SKIP=1 git push to bypass with a printed warning."
    exit 1
  fi
done

END_TIME=$(date +%s)
echo "pre-push-local: all ${#CHECKS[@]} check(s) passed in $((END_TIME - START_TIME))s."
exit 0
