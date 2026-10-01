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

# Physical path, Windows-style when available (pwd -W), lower-cased for compare.
_hermetic_abs() { (cd "$1" 2>/dev/null && { pwd -W 2>/dev/null || pwd -P; }) | tr 'A-Z' 'a-z'; }

# The repository this helper ships in. A fixture must never be it, or inside it.
HERMETIC_GIT_HOST_ROOT="$(_hermetic_abs "$(dirname "${BASH_SOURCE[0]}")/../../..")"

_hermetic_refuse() { echo "hermetic-git: REFUSED — $1" >&2; exit 97; }

# Fails loud unless <dir> is safe for fixture git. Call it BEFORE `git init`
# (the dir must be a non-empty absolute path that exists outside the host repo)
# and again after it (the dir must then be the top level of its OWN repository).
# #1063: the first version passed dir="" and dir=".", because `cd ""` succeeds
# in bash and both resolve to the caller's cwd, which is the real repository.
assert_hermetic_repo() {
  local dir="${1-}" top want v
  for v in $HERMETIC_GIT_LOCAL_VARS; do
    [ -n "${!v+x}" ] && _hermetic_refuse "$v is set; fixture git would hit another repo"
  done
  [ -n "$dir" ] || _hermetic_refuse "fixture dir is empty"
  local abs_re='^(/|[A-Za-z]:[/\])'
  [[ "$dir" =~ $abs_re ]] || _hermetic_refuse "fixture dir '$dir' is not absolute"
  [ -d "$dir" ] || _hermetic_refuse "fixture dir '$dir' does not exist"
  want="$(_hermetic_abs "$dir")"
  [ -n "$want" ] || _hermetic_refuse "fixture dir '$dir' does not resolve"
  case "$want/" in
    "$HERMETIC_GIT_HOST_ROOT"/*) _hermetic_refuse "fixture dir '$dir' is the host repository or inside it ($HERMETIC_GIT_HOST_ROOT)" ;;
  esac
  [ -e "$dir/.git" ] || return 0   # before `git init`: path checks are all that apply
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$top" ] || _hermetic_refuse "fixture '$dir' is not a git repository"
  top="$(_hermetic_abs "$top")"
  [ "$top" = "$want" ] || _hermetic_refuse "fixture '$dir' resolves to repo top '$top', not itself"
}
