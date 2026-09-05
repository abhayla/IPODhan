---
paths:
  - ".github/workflows/**"
  - "scripts/deploy*"
  - "scripts/deploy/**"
  - "docs/ops/**"
  - ".claude/hooks/**"
---

# Branching model — one frozen production line, main never frozen

version: "1.0.0" (owner decision 2026-09-05; SSOT of the model = `docs/ops/branching-model.md`)

- MUST deploy production ONLY from a `release/prod-<date>` branch:
  `gh workflow run deploy-linux.yml --ref release/prod-<date> -f slot=prod -f ref=<sha>` where `<sha>` is
  reachable from that branch. The workflow and the `deploy-branch-guard` hook refuse anything else (W-141).
- MUST cut `release/prod-<date>` from `main` only at a sha that has soaked on staging and passed a full
  local pass plus one hosted gate run; MUST tag `prod-<date>` after the served sha is verified.
- MUST keep `main` open: work branches (`fix/*`, `chore/*`, `feat/*`, worktrees via `wt-new.ps1`) PR into
  `main`; every push to `main` deploys staging, which soaks the NEXT release. Merge to `main` only after the
  last staging read a pending brief depends on.
- MUST route an outage-class fix for the current production line as `hotfix/*` from the release branch,
  PR into that release branch, deploy from it, then cherry-pick to `main` (never merge main into a release).
- MUST NOT ask the owner which branch to use; the table in `docs/ops/branching-model.md` decides.
- MUST delete a `release/prod-*` branch only after the NEXT release is verified in production (keep one back).
