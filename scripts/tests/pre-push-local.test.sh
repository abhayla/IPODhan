#!/usr/bin/env bash
# pre-push-local.test.sh — proves the path -> check-set MAPPING in
# scripts/ci/pre-push-local.sh (web-only, scraper-only, docs-only, mixed)
# via its --plan mode, WITHOUT running any of the heavy checks themselves.
#
# Builds a real throwaway git repo (same idiom as
# scripts/tests/merge-if-current-cli.test.mjs) with the real pre-push-local.sh
# copied in, so the mapping is exercised end to end against real git diff
# output rather than a re-implementation of the path logic.
set -euo pipefail

SCRIPT_UNDER_TEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/ci/pre-push-local.sh"
PASS=0
FAIL=0

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

pass() {
  PASS=$((PASS + 1))
}

new_repo() {
  local dir
  dir="$(mktemp -d)"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "test"
  mkdir -p "$dir/scripts/ci" "$dir/web" "$dir/scraper/src/services" "$dir/scraper/scripts" "$dir/docs/design" "$dir/.claude/hooks"
  cp "$SCRIPT_UNDER_TEST" "$dir/scripts/ci/pre-push-local.sh"
  chmod +x "$dir/scripts/ci/pre-push-local.sh"
  echo "base" > "$dir/README.md"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "base"
  git -C "$dir" branch -f main
  echo "$dir"
}

plan_for() {
  local dir="$1"
  (cd "$dir" && bash scripts/ci/pre-push-local.sh --plan --range=main..HEAD)
}

# --- Case 1: web-only change -> web checks, no scraper checks ---------------
DIR="$(new_repo)"
mkdir -p "$DIR/web/lib"
echo "export const x = 1;" > "$DIR/web/lib/thing.ts"
git -C "$DIR" add -A && git -C "$DIR" commit -q -m "web change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "RUN_WEB=1 RUN_SCRAPER=0"; then pass; else fail "web-only: expected RUN_WEB=1 RUN_SCRAPER=0, got: $OUT"; fi
if echo "$OUT" | grep -q "Web type-check"; then pass; else fail "web-only: missing web type-check step"; fi
if echo "$OUT" | grep -q "Scraper targeted"; then fail "web-only: unexpectedly planned a scraper check"; else pass; fi
rm -rf "$DIR"

# --- Case 2: scraper-only change -> scraper checks, no web checks -----------
DIR="$(new_repo)"
echo "export const y = 1;" > "$DIR/scraper/src/services/thing.ts"
git -C "$DIR" add -A && git -C "$DIR" commit -q -m "scraper change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "RUN_WEB=0 RUN_SCRAPER=1"; then pass; else fail "scraper-only: expected RUN_WEB=0 RUN_SCRAPER=1, got: $OUT"; fi
if echo "$OUT" | grep -q "Integration-test coverage gate"; then pass; else fail "scraper-only: missing integration coverage gate"; fi
if echo "$OUT" | grep -q "HAS_RATCHET_PATHS=1"; then pass; else fail "scraper-only (services/): expected ratchet path match"; fi
if echo "$OUT" | grep -q "Web type-check"; then fail "scraper-only: unexpectedly planned a web check"; else pass; fi
rm -rf "$DIR"

# --- Case 3: scraper/scripts change -> type-check:scripts included ----------
DIR="$(new_repo)"
echo "print('x')" > "$DIR/scraper/scripts/thing.py"
git -C "$DIR" add -A && git -C "$DIR" commit -q -m "scraper scripts change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "Scraper scripts type-check"; then pass; else fail "scraper/scripts: missing type-check:scripts step: $OUT"; fi
if echo "$OUT" | grep -q "HAS_RATCHET_PATHS=1"; then pass; else fail "scraper/scripts/*.py: expected ratchet path match"; fi
rm -rf "$DIR"

# --- Case 4: docs-only change -> ONLY docs checks, fast path ----------------
DIR="$(new_repo)"
echo "notes" > "$DIR/docs/design/notes.md"
git -C "$DIR" add -A && git -C "$DIR" commit -q -m "docs change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "DOCS_ONLY=1"; then pass; else fail "docs-only: expected DOCS_ONLY=1, got: $OUT"; fi
if echo "$OUT" | grep -q "RUN_WEB=0 RUN_SCRAPER=0"; then pass; else fail "docs-only: expected no web/scraper checks, got: $OUT"; fi
if echo "$OUT" | grep -q "Design consistency gate"; then pass; else fail "docs-only: missing design consistency gate"; fi
rm -rf "$DIR"

# --- Case 5: mixed web + scraper change -> both check sets ------------------
DIR="$(new_repo)"
mkdir -p "$DIR/web/lib"
echo "export const x = 1;" > "$DIR/web/lib/thing.ts"
echo "export const y = 1;" > "$DIR/scraper/src/services/thing.ts"
git -C "$DIR" add -A && git -C "$DIR" commit -q -m "mixed change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "RUN_WEB=1 RUN_SCRAPER=1"; then pass; else fail "mixed: expected both RUN_WEB=1 and RUN_SCRAPER=1, got: $OUT"; fi
rm -rf "$DIR"

# --- Case 6: .claude/hooks change -> hook self-test included ----------------
DIR="$(new_repo)"
echo "# hook" > "$DIR/.claude/hooks/thing.py"
git -C "$DIR" add -f -A && git -C "$DIR" commit -q -m "hook change"
OUT="$(plan_for "$DIR")"
if echo "$OUT" | grep -q "HAS_HOOKS=1"; then pass; else fail "hooks: expected HAS_HOOKS=1, got: $OUT"; fi
if echo "$OUT" | grep -q "Board-owed-guard hook self-tests"; then pass; else fail "hooks: missing board-owed-guard self-test step"; fi
rm -rf "$DIR"

echo ""
echo "pre-push-local.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
