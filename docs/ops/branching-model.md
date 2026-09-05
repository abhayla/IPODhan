# Branching model (owner decision 2026-09-05 16:05 IST)

One frozen line per production release; main stays open. Owner: "keep the code that is ready for
deployment on one branch and keep coding on the others."

| Branch | Role | Who moves it |
|---|---|---|
| `main` | integration. Every fix lands here by PR (squash or merge commit per `git-collaboration.md`). Every push auto-deploys **staging**, so staging always soaks the NEXT release. | PRs only |
| `release/prod-<date>` | the frozen production line, cut from `main` at the proven sha. **Prod deploys only from this branch**: `gh workflow run deploy-linux.yml --ref release/prod-<date> -f slot=prod -f ref=<sha>`. Tagged `prod-<date>` after the served sha is verified. | cut once; hotfixes only |
| `fix/*`, `chore/*`, `feat/*` | short-lived work branches in worktrees (`wt-new.ps1`), PR into `main`. | workers |
| `hotfix/*` | an outage-class fix for the CURRENT production line: branch from `release/prod-<date>`, PR into that release branch, deploy from it, then cherry-pick into `main` (never the other way round). | Fable + Tier A review |

Rules
1. Nothing reaches production except a commit on a `release/prod-*` branch; the deploy `ref` input must
   be a commit reachable from that branch.
2. A release branch is cut only from a sha that has soaked on staging (Rule 7 of the deploy-window rule)
   and passed a full local pass + one hosted gate run.
3. `main` is never frozen. Merging a fix to `main` before a prod deploy is allowed; it only moves staging.
   Merge to `main` AFTER the last staging read the brief depends on, so the evidence stays on one sha.
4. Old `release/prod-*` branches are deleted after the next release is verified in production (keep one
   back for rollback; the tag keeps the history).
5. PR-bundle branches (`release/<date>[a-e]`, used 2026-09-03..05) are retired; a bundle is just a work
   branch PR'd into `main`.

Current lines
- `release/prod-2026-09-05` = d38b72aa (cut 16:05 IST 2026-09-05; deploy candidate for the 21:00-23:30 window).
- production before that: 8cd287d5 (no branch; rollback = `-f ref=8cd287d5` from the same release branch, since 8cd287d5 is an ancestor).
