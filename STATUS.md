# T-395 — IPODhan PR #233 zero-check-runs root cause — STATUS (DONE)

Branch: `task/t395-pr233-ci-gap` (worktree `IPODhan-T-395-t395`). PR #233 itself lives
on `fleet/T-328-detection-to-correction`, pushed directly (not via this task branch).

## Root cause (confirmed)

PR #233 had gone `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING` against `main`.
GitHub does not schedule a `pull_request`-triggered workflow run when it cannot
compute the PR's synthetic merge ref (`refs/pull/233/merge`) — that ref was
provably absent (`git ls-remote`), while sibling open PRs #236/#238/#239 all have
one. The only conflicting file was `STATUS.md` itself (a transient per-task worker
scratch file, not functionally merge-meaningful) — confirmed via a real local
merge attempt; `scraper/src/services/data-consolidation-service.ts` (also touched
by both branches) auto-merged clean.

Hypotheses (a) branch protection/rulesets, (b) pr-gate.yml trigger/paths filter,
and (d) a vanished/queued run were all ruled out with direct evidence — see
`C:\Abhay\GetWorkDone\evidence\2026-08-27-T-395\00-ROOT-CAUSE-SUMMARY.md`.

## Fix applied

1. Merged `origin/main` into `fleet/T-328-detection-to-correction`.
2. Resolved the sole `STATUS.md` conflict (kept the PR branch's own status notes).
3. Verified the merged tree locally against every pr-gate.yml step (write-ratchet
   self-tests, write-ratchet check, shared-package build, web lint:ci, web
   tsc --noEmit, web full unit suite: 165/166 files pass, scraper full unit suite:
   124/124 files pass) — full logs in
   `C:\Abhay\GetWorkDone\evidence\2026-08-27-T-395\05-local-substitute-ci-run.txt`.
4. Pushed the merge commit (`0caa44f`) directly to
   `fleet/T-328-detection-to-correction` on origin.
5. Updated PR #233's body (via REST PATCH, `gh pr edit`'s GraphQL path hit an
   unrelated deprecated-Projects-classic error) with the full findings + fix
   writeup.

## Confirmed fixed

Immediately after the push: `mergeable` flipped `CONFLICTING` → `MERGEABLE`
(`mergeable_state: "unstable"`, i.e. other non-required checks still pending/
absent — not conflicting), and GitHub scheduled run `33094893313` (`event:
pull_request`, head_sha `0caa44f`) — the first scheduled run since PR creation.
As of this worker's exit, that run was still `in_progress` (not polled to
completion — this worker runs headless and never waits on external CI events).

## PR #233 disposition

PR #233 was NOT merged or closed by this worker (never will be, per contract).
It is left in a mergeable state either way:
- If the newly-scheduled run reports green: normal mergeable PR, no exception needed.
- If it does not report for any reason: the PR body carries the local-run
  substitute evidence + an explicit note asking the dispatcher for an
  owner-approved manual-merge exception.

## Verification commands run this session

```
gh pr view 233 --json mergeStateStatus,mergeable,mergeCommit,potentialMergeCommit
gh api repos/abhayla/IPODhan/branches/fleet/T-328-detection-to-correction/protection
gh api repos/abhayla/IPODhan/rulesets
gh api "repos/abhayla/IPODhan/actions/runs?branch=fleet/T-328-detection-to-correction&per_page=100"
git ls-remote origin "refs/pull/233/*"
git merge origin/main --no-edit   # on fleet/T-328-detection-to-correction, real conflict test
node --test scripts/tests/check-write-ratchet.test.mjs      # 23/23 pass
node --test scripts/tests/audit-detection-floor.test.mjs    # 78/78 pass
node scripts/check-write-ratchet.mjs                        # PASS, 61 files match baseline
cd packages/shared && npx tsc                                # schema.d.ts OK
cd web && npm run lint:ci                                    # PASS, matches baseline
cd web && npx tsc --noEmit                                   # clean
cd web && npm run test:unit                                  # 165/166 files, 2362 pass/17 skip, exit 0
cd scraper && npx vitest run --config vitest.config.ts       # 124/124 files, 1362 pass/1 skip, 0 fail
```
