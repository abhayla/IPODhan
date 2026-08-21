# GitHub Actions Workflows

This directory contains the CI/CD workflows for the IPODhan project.

## Workflows

### Deploy Linux (`deploy-linux.yml`)

The **only** production deploy path. Runs on the `linux-vps-ipodhan` self-hosted runner and
ships to the Linux VPS `72.61.240.224`. Prod deploys are an explicit `workflow_dispatch`;
a push to the staging path deploys the staging slot only.

> The Windows-era deploy (`deploy.yml`) and its four `vps-*.yml` maintenance workflows were
> retired on 2026-08-21 (T-252) and moved to `.github/workflows-disabled/`, which GitHub does
> not read. See that folder's README for what they did and how to restore one.


### PR Gate (`pr-gate.yml`)

**Triggers:**
- On every pull request to `main` (no path filters, no manual step needed)

The only automatic check in this repo. Deliberately narrow — lint, type-check,
and unit tests only — to stay fast and avoid GitHub-hosted Actions minutes
costs. This is the check to require once branch protection / required status
checks are available (private free-plan repos don't support them yet); until
then, treat "wait for this to go green before merging" as the enforcement
mechanism.

### CI Workflow (`ci.yml`)

**Triggers:**
- Manual only (`workflow_dispatch`) — GitHub Actions tab, "Run workflow".
  Previously ran on every push/PR to `main`, but that consumed GitHub-hosted
  Actions minutes and tripped the account's billing block. Runs the full
  suite (lint, type-check, unit, E2E, Lighthouse, build) — heavier than
  `pr-gate.yml`.

**Jobs:**
1. **Checkout code** - Checks out the repository
2. **Setup Node.js 20** - Installs Node.js 20 with npm caching
3. **Install dependencies** - Runs `npm ci` for reproducible builds
4. **Run lint** - Executes ESLint checks (`npm run lint`)
5. **Run type-check** - Validates TypeScript types (`tsc --noEmit`)
6. **Run unit tests** - Executes Vitest unit tests (`npm run test:unit`)
7. **Install Playwright browsers** - Installs required browsers for E2E tests
8. **Run E2E tests** - Executes Playwright E2E tests (`npm run test:e2e`)
9. **Build** - Builds the Next.js application (`npm run build`)
10. **Upload test results** - Uploads test artifacts on failure

**Performance Optimizations:**
- **npm caching** - Caches `node_modules` based on `package-lock.json` hash
- **Dependency caching** - Uses `cache-dependency-path` for monorepo support
- **Artifact upload on failure** - Only uploads test results/reports when tests fail

**Required Checks:**
Not enforced by GitHub — this is a private repo on the free plan, which does
not support branch protection / required status checks. `pr-gate.yml` runs
automatically on every PR; treat waiting for it to go green before merging as
the enforcement mechanism until the plan/visibility changes.

**Execution Time:**
- Target: <5 minutes (with caching)
- First run: 3-7 minutes (no cache)
- Subsequent runs: 2-4 minutes (with cache)

**Artifacts:**
- `test-results/` - Playwright test results (retained for 7 days on failure)
- `playwright-report/` - HTML test report (retained for 7 days on failure)

## How to Use

### Testing Locally
Before pushing, ensure all checks pass locally:
```bash
cd web
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:e2e
npm run build
```

### Viewing CI Results
1. Navigate to the **Actions** tab in GitHub
2. Select the workflow run for your PR/commit
3. Expand each step to see detailed logs
4. Download artifacts (test results/reports) if tests fail

### Debugging Failures
If CI fails:
1. Check the failed step in the workflow logs
2. Download test artifacts (if available)
3. Reproduce the failure locally using the same commands
4. Fix the issue and push again

## Workflow Status Badge

To add a status badge to your README:
```markdown
![CI Status](https://github.com/YOUR_ORG/IPODhan/actions/workflows/ci.yml/badge.svg)
```

## Future Enhancements
- Add coverage reporting with Codecov/Coveralls
- Add deployment workflows (staging/production)
- Add release automation
- Add dependency security scanning (Dependabot)
- Add performance regression testing
