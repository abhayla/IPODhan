#!/usr/bin/env bash
# pre-push-local.test.sh — proves scripts/ci/pre-push-local.sh gates exactly the
# refs a push sends, by driving the REAL .husky/pre-push hook through real
# `git push`es to a throwaway local bare remote.
#
# node / npx / npm / python are replaced on PATH by a stub that logs its command
# line to $STUB_LOG and exits 1 when the line matches $STUB_FAIL (a regex). So a
# test can see WHICH checks ran for a push, and make one of them fail for real
# to prove the push is refused. Nothing heavy runs; nothing touches GitHub.
set -uo pipefail

# A pre-push hook of the outer repo can run this file; git exports GIT_DIR and
# friends into hooks, and `git -C` does not override GIT_DIR. Drop them all so
# every git call below hits only the throwaway repos.
for v in $(env | sed -n 's/^\(GIT_[A-Za-z_]*\)=.*/\1/p'); do unset "$v"; done

SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0
FAIL=0
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
pass() { PASS=$((PASS + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

STUBS="$WORK/stubs"
mkdir -p "$STUBS"
for tool in node npx npm python; do
  cat > "$STUBS/$tool" <<EOF
#!/usr/bin/env bash
line="$tool \$*"
echo "\$line" >> "\${STUB_LOG:?}"
if [ -n "\${STUB_FAIL:-}" ] && printf '%s\n' "\$line" | grep -qE "\$STUB_FAIL"; then
  echo "stub: simulated failure of: \$line" >&2
  exit 1
fi
exit 0
EOF
  chmod +x "$STUBS/$tool"
done
export STUB_LOG="$WORK/stub.log"
export STUB_FAIL=""

new_repo() {
  # Runs inside $(...), so state lives on disk (mktemp), never in a counter.
  local dir remote
  dir="$(mktemp -d "$WORK/repoXXXXXX")"
  remote="$dir.git"
  {
  git init -q --bare "$remote"
  git init -q -b main "$dir"
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "test"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config core.autocrlf false
  mkdir -p "$dir/scripts/ci" "$dir/web/lib" "$dir/scraper/src/services" "$dir/scraper/scripts" \
           "$dir/packages/shared" "$dir/docs/design" "$dir/.claude/hooks" "$dir/.github/workflows" "$dir/scripts/ops"
  cp "$SRC_ROOT/scripts/ci/pre-push-local.sh" "$dir/scripts/ci/pre-push-local.sh"
  echo "base" > "$dir/README.md"
  touch "$dir/web/.keep" "$dir/scraper/.keep" "$dir/packages/shared/.keep"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "base"
  git -C "$dir" remote add origin "$remote"
  git -C "$dir" push -q origin main
  # The REAL hook file, installed where git runs hooks by default.
  { echo '#!/usr/bin/env sh'; cat "$SRC_ROOT/.husky/pre-push"; } > "$dir/.git/hooks/pre-push"
  chmod +x "$dir/.git/hooks/pre-push"
  } >/dev/null 2>&1
  echo "$dir"
}

commit_file() { # dir path content
  mkdir -p "$(dirname "$1/$2")"
  echo "$3" > "$1/$2"
  git -C "$1" add -A && git -C "$1" commit -q -m "change $2"
}

OUT=""
RC=0
push() { # dir args...
  local dir="$1"; shift
  : > "$STUB_LOG"
  OUT="$(cd "$dir" && PATH="$STUBS:$PATH" git push "$@" 2>&1)"
  RC=$?
}
ran() { grep -qE "$1" "$STUB_LOG"; }
remote_has() { git -C "$1" ls-remote --exit-code origin "$2" >/dev/null 2>&1; }

# --- 1. New branch, web change, checked out: web checks run, push lands -----
D="$(new_repo)"
git -C "$D" checkout -q -b feat
commit_file "$D" web/lib/a.ts "export const a = 1;"
push "$D" origin feat
[ "$RC" -eq 0 ] && pass || fail "new branch: push should pass, rc=$RC out=$OUT"
ran '^npx tsc --noEmit' && pass || fail "new branch: web tsc did not run: $(cat "$STUB_LOG")"
ran '^npm run lint:ci' && pass || fail "new branch: web lint did not run"
ran 'check-write-ratchet' && pass || fail "new branch: write ratchet did not run"
ran 'require-fixture-provenance' && pass || fail "new branch: fixture ratchet did not run"

# --- 2. A real check failing refuses the push, and the ref never lands -------
D="$(new_repo)"
git -C "$D" checkout -q -b bad
commit_file "$D" web/lib/b.ts "export const b: number = 'x';"
STUB_FAIL='tsc --noEmit' push "$D" origin bad
[ "$RC" -ne 0 ] && pass || fail "failing tsc: push should be REFUSED, rc=$RC"
echo "$OUT" | grep -q "REFUSED" && pass || fail "failing tsc: no REFUSED message: $OUT"
echo "$OUT" | grep -q "Web type-check" && pass || fail "failing tsc: refusal did not name the check"
remote_has "$D" refs/heads/bad && fail "failing tsc: branch reached the remote" || pass

# --- 3. Existing branch: only the new commits are gated ---------------------
D="$(new_repo)"
git -C "$D" checkout -q -b feat
commit_file "$D" web/lib/a.ts "export const a = 1;"
push "$D" origin feat
commit_file "$D" scraper/src/services/s.ts "export const s = 1;"
push "$D" origin feat
[ "$RC" -eq 0 ] && pass || fail "existing branch: push should pass: $OUT"
ran 'type-check:scripts' && pass || fail "existing branch: scraper check did not run"
ran 'tsc --noEmit' && fail "existing branch: web tsc ran for a commit the remote already has" || pass

# --- 4. Force-push: gated against the remote's old sha ----------------------
git -C "$D" reset -q --hard HEAD~1
commit_file "$D" web/lib/c.ts "export const c = 1;"
push "$D" --force origin feat
[ "$RC" -eq 0 ] && pass || fail "force-push: should pass: $OUT"
ran 'tsc --noEmit' && pass || fail "force-push: web tsc did not run"

# --- 5. Delete: nothing to check, passes even when every check would fail ---
STUB_FAIL='.' push "$D" origin --delete feat
[ "$RC" -eq 0 ] && pass || fail "delete: should pass: $OUT"
[ -s "$STUB_LOG" ] && fail "delete: ran checks: $(cat "$STUB_LOG")" || pass
remote_has "$D" refs/heads/feat && fail "delete: branch still on remote" || pass

# --- 6. Tag (alone, and alongside a branch in one push) ---------------------
git -C "$D" tag v1 HEAD
STUB_FAIL='.' push "$D" origin v1
[ "$RC" -eq 0 ] && pass || fail "tag: should pass: $OUT"
[ -s "$STUB_LOG" ] && fail "tag: ran checks" || pass
git -C "$D" tag v2 HEAD
push "$D" origin feat v2
[ "$RC" -eq 0 ] && pass || fail "branch+tag in one push: should pass: $OUT"
ran 'tsc --noEmit' && pass || fail "branch+tag: branch range not gated"

# --- 7. Wrong branch: pushing X while Y is checked out gates X, then refuses -
D="$(new_repo)"
git -C "$D" checkout -q -b bad-web
commit_file "$D" web/lib/w.ts "export const w = 1;"
git -C "$D" checkout -q main
git -C "$D" checkout -q -b docs-br
commit_file "$D" docs/design/n.md "notes"
push "$D" origin bad-web
[ "$RC" -ne 0 ] && pass || fail "wrong branch: push of bad-web from docs-br should be REFUSED: $OUT"
echo "$OUT" | grep -q "Check out bad-web" && pass || fail "wrong branch: no 'Check out bad-web' hint: $OUT"
remote_has "$D" refs/heads/bad-web && fail "wrong branch: bad-web reached the remote" || pass
PLAN="$(cd "$D" && printf 'refs/heads/bad-web %s refs/heads/bad-web %s\n' "$(git rev-parse bad-web)" 0000000000000000000000000000000000000000 | bash scripts/ci/pre-push-local.sh --plan --stdin)"
echo "$PLAN" | grep -q "Web type-check" && pass || fail "wrong branch: plan did not gate bad-web's web range: $PLAN"
push "$D" origin docs-br
[ "$RC" -eq 0 ] && pass || fail "wrong branch: the checked-out docs branch should pass: $OUT"
git -C "$D" checkout -q bad-web
push "$D" origin bad-web
[ "$RC" -eq 0 ] && pass || fail "wrong branch: bad-web checked out should pass: $OUT"

# --- 8. Uncommitted tracked change: the tree is not the pushed commit -------
D="$(new_repo)"
git -C "$D" checkout -q -b feat
commit_file "$D" web/lib/a.ts "export const a = 1;"
echo "export const a = 2;" > "$D/web/lib/a.ts"
push "$D" origin feat
[ "$RC" -ne 0 ] && pass || fail "dirty tree: push should be REFUSED"

# --- 9. Docs fast path: docs-only (incl. web/*.md) runs no code checks ------
D="$(new_repo)"
git -C "$D" checkout -q -b docs
commit_file "$D" web/NOTES.md "notes"
commit_file "$D" docs/design/x.md "x"
push "$D" origin docs
[ "$RC" -eq 0 ] && pass || fail "docs-only: should pass: $OUT"
ran 'tsc|lint:ci|check-write-ratchet' && fail "docs-only: ran code checks: $(cat "$STUB_LOG")" || pass
ran 'check-design-consistency' && pass || fail "docs-only: design gate did not run"

# --- 10. Path mapping via --plan --range ------------------------------------
plan() { (cd "$1" && bash scripts/ci/pre-push-local.sh --plan --range=main..HEAD); }
D="$(new_repo)"; git -C "$D" checkout -q -b p
commit_file "$D" packages/shared/src/x.ts "export const x = 1;"
P="$(plan "$D")"
echo "$P" | grep -q "Scraper scripts type-check" && pass || fail "shared change: type-check:scripts not planned: $P"
echo "$P" | grep -q "Web type-check" && pass || fail "shared change: web tsc not planned"
echo "$P" | grep -q "detection-change gate runs in CI" && pass || fail "scraper-ish change: detection note missing"

D="$(new_repo)"; git -C "$D" checkout -q -b p
commit_file "$D" scraper/src/services/s.ts "export const s = 1;"
P="$(plan "$D")"
echo "$P" | grep -q "Scraper scripts type-check" && pass || fail "scraper/src change: type-check:scripts not planned"
echo "$P" | grep -q "require-detection-change.mjs " && fail "detection-change gate must not run locally" || pass

D="$(new_repo)"; git -C "$D" checkout -q -b p
commit_file "$D" scripts/ops/render-board.mjs "//x"
P="$(plan "$D")"
echo "$P" | grep -q "render-board.mjs --check" && pass || fail "scripts/ops: render-board --check not planned: $P"

D="$(new_repo)"; git -C "$D" checkout -q -b p
commit_file "$D" .github/workflows/x.yml "on: push"
P="$(plan "$D")"
echo "$P" | grep -q "check-workflow-ascii" && pass || fail ".github: workflow ASCII check not planned"

D="$(new_repo)"; git -C "$D" checkout -q -b p
echo "# hook" > "$D/.claude/hooks/thing.py"
git -C "$D" add -f .claude/hooks/thing.py && git -C "$D" commit -q -m hook
P="$(plan "$D")"
echo "$P" | grep -q "board-owed-guard.test.py" && pass || fail ".claude/hooks: hook self-tests not planned"

D="$(new_repo)"; git -C "$D" checkout -q -b p
commit_file "$D" config/some.json "{}"
P="$(plan "$D")"
echo "$P" | grep -q "check-write-ratchet" && pass || fail "code push mapped to no checks: $P"

echo ""
echo "pre-push-local.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
