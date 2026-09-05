#!/usr/bin/env bash
# W-141 — mechanical gate for docs/ops/branching-model.md Rule 1:
# "Nothing reaches production except a commit on a release/prod-* branch;
# the deploy ref input must be a commit reachable from that branch."
#
# This script is the ONLY place that decides whether a prod deploy may
# proceed. It is deliberately standalone (not inlined in the workflow
# step) so it is unit-testable outside GitHub Actions — see
# scripts/deploy/tests/require-release-branch.test.sh.
#
# Why this can't be bypassed via the `ref` input alone: the gate checks
# BOTH (1) the branch the workflow run itself is on (github.ref, which a
# `workflow_dispatch` caller does NOT control independently of choosing
# which branch to run the workflow FROM) AND (2) that the requested
# target sha is an ancestor of that branch's tip. Passing an arbitrary
# `ref=<sha>` input while dispatching from `main` still fails check (1);
# dispatching from a release/prod-* branch but asking to deploy a sha
# that only exists on main still fails check (2).
#
# Usage:
#   require-release-branch.sh <slot> <ref-name> <target-sha>
#
#   slot        - the resolved deploy slot ("prod" or "staging"/anything else)
#   ref-name    - github.ref of the workflow run, e.g. refs/heads/release/prod-2026-09-05
#   target-sha  - the commit-ish actually being deployed (inputs.ref if
#                 non-empty, else github.sha) — the caller resolves which
#                 one that is before calling this script.
#
# Exit codes:
#   0  - pass (slot is not prod, or both checks succeeded)
#   12 - refused (prints "REFUSED: <reason>" to stdout/stderr and exits 12)
#
# Fails CLOSED: any missing argument, or any check that cannot be
# conclusively resolved (even after the one-shot deepen retry), is a
# REFUSE — never a silent pass.

set -euo pipefail

SLOT="${1:-}"
REF_NAME="${2:-}"
TARGET_SHA="${3:-}"

refuse() {
  echo "REFUSED: $1"
  exit 12
}

if [ -z "$SLOT" ] || [ -z "$REF_NAME" ] || [ -z "$TARGET_SHA" ]; then
  refuse "missing required argument(s) — usage: require-release-branch.sh <slot> <ref-name> <target-sha>"
fi

if [ "$SLOT" != "prod" ]; then
  echo "OK: slot '$SLOT' is not prod — release-branch gate does not apply."
  exit 0
fi

# --- Check 1: github.ref must be a release/prod-* branch -------------------
case "$REF_NAME" in
  refs/heads/release/prod-?*)
    ;;
  *)
    refuse "prod deploys must run from a release/prod-<date> branch (docs/ops/branching-model.md Rule 1); this run's ref is '$REF_NAME'. Cut a release branch and dispatch with --ref release/prod-<date>."
    ;;
esac

# --- Check 2: target sha must be an ancestor of that branch's tip ----------
# Resolve a short/partial sha to a full one first — also proves it exists
# in this clone (a sha the runner has never fetched is itself a REFUSE,
# not a "cannot evaluate, allow" — fail closed).
if ! RESOLVED_SHA="$(git rev-parse --verify "${TARGET_SHA}^{commit}" 2>/dev/null)"; then
  # The runner's clone may not have this commit yet (a shallow checkout,
  # or a sha from a branch not yet fetched). One bounded retry: deepen
  # the history on the release ref, then re-resolve.
  BRANCH_SHORT="${REF_NAME#refs/heads/}"
  git fetch --deepen=200 origin "$BRANCH_SHORT" >/dev/null 2>&1 || true
  if ! RESOLVED_SHA="$(git rev-parse --verify "${TARGET_SHA}^{commit}" 2>/dev/null)"; then
    refuse "target sha '$TARGET_SHA' could not be resolved to a commit in this clone (even after deepening ${REF_NAME#refs/heads/} by 200 commits) — cannot prove it is on the release branch."
  fi
fi

# NOTE: `if CMD; then ...; fi` with a false CMD and no else clause exits
# the *if statement* with status 0 (POSIX: "if no compound-list is
# executed, the exit status of if shall be zero") — `$?` read right after
# such a `fi` is NOT the condition's exit code. Capture it explicitly with
# `CMD && rc=0 || rc=$?` instead, so a real non-ancestor (rc=1) is
# distinguished from an undecidable check (rc>1, e.g. shallow history).
git merge-base --is-ancestor "$RESOLVED_SHA" "$REF_NAME" 2>/dev/null && MERGE_BASE_RC=0 || MERGE_BASE_RC=$?

if [ "$MERGE_BASE_RC" -eq 0 ]; then
  echo "OK: $RESOLVED_SHA is an ancestor of $REF_NAME — prod deploy gate satisfied."
  exit 0
fi

if [ "$MERGE_BASE_RC" -eq 1 ]; then
  refuse "target sha '$RESOLVED_SHA' is NOT reachable from '$REF_NAME' — it is not on the release branch."
fi

# Any other exit code (128, etc.) means merge-base could not evaluate the
# relationship at all (e.g. still-shallow history even after deepening,
# or an unrelated-history repo). One more bounded retry, then fail closed.
BRANCH_SHORT="${REF_NAME#refs/heads/}"
git fetch --deepen=200 origin "$BRANCH_SHORT" >/dev/null 2>&1 || true
git merge-base --is-ancestor "$RESOLVED_SHA" "$REF_NAME" 2>/dev/null && MERGE_BASE_RC=0 || MERGE_BASE_RC=$?
if [ "$MERGE_BASE_RC" -eq 0 ]; then
  echo "OK: $RESOLVED_SHA is an ancestor of $REF_NAME — prod deploy gate satisfied (after deepen retry)."
  exit 0
fi
if [ "$MERGE_BASE_RC" -eq 1 ]; then
  refuse "target sha '$RESOLVED_SHA' is NOT reachable from '$REF_NAME' — it is not on the release branch."
fi
refuse "could not determine whether '$RESOLVED_SHA' is an ancestor of '$REF_NAME' (ancestry unknown even after deepening) — refusing rather than guessing."
