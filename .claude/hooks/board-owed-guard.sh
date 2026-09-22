#!/usr/bin/env bash
# Stop hook — BOARD-OWED guard.
#
# WHY THIS EXISTS. `.claude/rules/owner-status-artifact.md` R4 refers to "the
# `board-owed-guard` hook" as if it were built. It was not: until this file,
# `grep -rln "board-owed" .claude/` matched only that rule and a todo entry. So
# the only thing keeping the owner's status artifact fresh was a session
# remembering to publish it — and a session that ends mid-work, or a merge
# nobody is watching, leaves the published page stale.
#
# That is the same class as the defects this repo keeps finding: a rule asserting
# a guard that does not exist, so nothing detects the gap. Measured 2026-09-23:
# the owner asked why the artifact was not updating, and the answer was that
# nothing ever made it update.
#
# WHAT IT DOES. After a turn, it asks one cheap question: has a MERGE landed
# since `docs/design/board/index.html` was last rendered? If yes, it regenerates
# the board from its data files and prints ONE line telling the session to
# publish. It does not publish — publishing is an outward action that belongs to
# the session, not to a hook.
#
# TOKEN COST, because that is an explicit owner constraint:
#   - a quiet run costs ZERO model tokens: it is git plumbing plus a file
#     comparison, and it prints nothing when the board is current.
#   - a firing run costs one short line to read and one Artifact publish call.
#   - what it avoids is the ~70k-token full re-read the artifact service forces
#     when a long-stale 160KB page has to be re-read before it can be updated.
#
# WHY MERGES, NOT COMMITS. R4 is explicit: "Update when a stage crosses, not when
# a commit lands." A merge commit on main is the cheapest available proxy for a
# stage crossing; ordinary commits, docs edits and CI re-runs are not. This is a
# PROMPT to ask whether a stage crossed, not an instruction to republish blindly.
#
# FAIL-OPEN in every direction: no git, no board, no generators, a generator that
# errors — all exit 0 silently. A status-page hook must never block work.
exec 2>/dev/null
exit_quiet() { exit 0; }

command -v git >/dev/null || exit_quiet
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit_quiet
[ -n "$root" ] || exit_quiet
cd "$root" || exit_quiet

board="docs/design/board/index.html"
[ -f "$board" ] || exit_quiet

# Only speak on the main line. A feature worktree mid-build has nothing to
# publish yet, and firing there would be noise on every turn.
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ "$branch" = "main" ] || exit_quiet

# The last commit that TOUCHED the board is the render marker: the board is
# regenerated and committed together, so its commit time is when it last matched
# its data. Compare against the newest merge on main.
board_commit="$(git log -1 --format=%ct -- "$board" 2>/dev/null)"
[ -n "$board_commit" ] || exit_quiet

# `--merges` catches a merge commit; a squash-merged PR is an ordinary commit, so
# also count commits whose subject carries a PR number — that is what this repo's
# squash merges look like ("feat(x): thing (#123) (#124)").
last_merge="$(git log -1 --format=%ct --merges main 2>/dev/null)"
last_squash="$(git log -20 --format='%ct %s' main 2>/dev/null | grep -E '\(#[0-9]+\)' | head -1 | cut -d' ' -f1)"
newest="$last_merge"
[ -n "$last_squash" ] && { [ -z "$newest" ] || [ "$last_squash" -gt "$newest" ]; } && newest="$last_squash"
[ -n "$newest" ] || exit_quiet

# Board is at or ahead of the newest merge: nothing owed, say nothing.
[ "$board_commit" -ge "$newest" ] && exit_quiet

# A merge landed after the board was last rendered. Regenerate from data (never
# hand-edit, never read the published page — owner-status-artifact.md R1), then
# report only if the regeneration actually CHANGED something. A merge that moved
# no verdict is exactly the case R4 says not to republish for.
command -v node >/dev/null || exit_quiet

# Refuse to touch a tree that already has board edits in flight — regenerating
# over someone's uncommitted work, or over a half-finished edit, is worse than
# staying quiet.
git diff --quiet -- docs/design/board/ 2>/dev/null || exit_quiet

node scripts/ops/build-plan-board.mjs >/dev/null 2>&1 || exit_quiet
node scripts/ops/render-board.mjs      >/dev/null 2>&1 || exit_quiet

# Did regenerating change anything that MATTERS? Both generated files carry a
# date stamp that moves every day on its own, so a stamp-only diff is not a
# stage change and must not be reported (R4) — nor left in the tree.
#
# Compare with the stamps normalised out. Tested 2026-09-23: without this, a
# forced-stale run left plan-sections.generated.html dirty with nothing but
# "generated 2026-09-22" -> "2026-09-23", which would dirty the tree on every
# turn and break the next commit.
substantive=0
for f in "$board" docs/design/board/plan-sections.generated.html; do
  git show "HEAD:$f" 2>/dev/null | sed -E 's/generated [0-9]{4}-[0-9]{2}-[0-9]{2}( IST)?//g; s/updated [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]+ IST//g' > /tmp/.board-head.$$ 2>/dev/null
  sed -E 's/generated [0-9]{4}-[0-9]{2}-[0-9]{2}( IST)?//g; s/updated [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]+ IST//g' "$f" > /tmp/.board-now.$$ 2>/dev/null
  cmp -s /tmp/.board-head.$$ /tmp/.board-now.$$ || substantive=1
  rm -f /tmp/.board-head.$$ /tmp/.board-now.$$
done

# Nothing substantive: put the tree back exactly as it was and say nothing. A
# Stop hook must never leave uncommitted churn behind.
if [ "$substantive" -eq 0 ]; then
  git checkout -- docs/design/board/ 2>/dev/null
  exit_quiet
fi

merged_subject="$(git log -1 --format=%s main 2>/dev/null | cut -c1-72)"
cat <<EOF
BOARD OWED: a merge landed after the board was last rendered, and regenerating it
CHANGED docs/design/board/index.html — so a stage crossed and the published page
is now behind.

  last merge : $merged_subject
  regenerated: docs/design/board/index.html (uncommitted, review the diff)

Commit the regenerated board with the work, then publish to the SAME url:
  Artifact(action="publish",
           url="https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM",
           file_path="docs/design/board/index.html")

Publishing without that url creates a SECOND artifact and every shared link goes
stale (owner-status-artifact.md R6). If the diff is only a timestamp, discard it
and publish nothing — R4: update on stage changes, not on every merge.
EOF
exit 0
