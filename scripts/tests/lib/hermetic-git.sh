# hermetic-git.sh — sourced by shell tests that build throwaway git repos.
#
# WHY (2026-09-25, PR #1037): git exports GIT_DIR into hooks, and from a linked
# worktree it points at .git/worktrees/<name>. A test run by a pre-push hook
# inherited it, so its `git init` / `git config user.*` / `git commit` in a temp
# dir went to the REAL repository: core.bare=true and [user] Test landed in the
# shared .git/config, and fixture commits landed on the pushed branch.
# `cd <tmp>` and `git -C <tmp>` do NOT override an exported GIT_DIR.

# Every variable `git rev-parse --local-env-vars` lists (git 2.4x), hard-coded so
# this works even when git itself is what is broken.
HERMETIC_GIT_LOCAL_VARS="GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_OBJECT_DIRECTORY GIT_DIR GIT_WORK_TREE GIT_IMPLICIT_WORK_TREE GIT_GRAFT_FILE GIT_INDEX_FILE GIT_NO_REPLACE_OBJECTS GIT_REPLACE_REF_BASE GIT_PREFIX GIT_SHALLOW_FILE GIT_COMMON_DIR"

hermetic_git_env() {
  local v
  for v in $HERMETIC_GIT_LOCAL_VARS $(git rev-parse --local-env-vars 2>/dev/null); do unset "$v"; done
}

# Fails loud unless <dir> is the top level of its OWN repository. Call it right
# after `git init` of a fixture, before any config/add/commit.
assert_hermetic_repo() {
  local dir="$1" top want v
  for v in $HERMETIC_GIT_LOCAL_VARS; do
    if [ -n "${!v+x}" ]; then
      echo "hermetic-git: REFUSED — $v is set; fixture git would hit another repo" >&2
      exit 97
    fi
  done
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"
  want="$(cd "$dir" 2>/dev/null && { pwd -W 2>/dev/null || pwd; })"
  if [ -z "$top" ] || [ -z "$want" ] || [ "$(printf '%s' "$top" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$want" | tr 'A-Z' 'a-z')" ]; then
    echo "hermetic-git: REFUSED — fixture '$dir' resolves to repo top '$top', not itself" >&2
    exit 97
  fi
}
