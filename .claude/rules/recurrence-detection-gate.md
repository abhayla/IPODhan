# Scope: paths
paths:
  - "scraper/src/services/**"
  - "scraper/src/scrapers/**"
  - "scraper/src/config/field-priority-matrix.ts"
  - "scraper/scripts/*.py"

# Recurrence loop, part 1: detection-change gate

Any PR touching scraper/persister write paths (`scraper/src/services/**`, `scraper/src/scrapers/**`,
`scraper/src/config/field-priority-matrix.ts`, `scraper/scripts/*.py`, excluding test files) MUST
also change a detection check — `scripts/lib/substance-checks.mjs`, an `audit-*.mjs` script,
`scraper/src/utils/data-validation.ts`, a new/changed file under `docs/reviews/detection-checks/`
or `docs/reviews/failure-classes/` (one file per check / per failure-class, T-487), or a row in
`docs/reviews/failure-classes.md` — OR carry a line matching
`^No detection change: <reason, 20+ chars>$` in the PR body or a commit message. The CI job
`detection-change-gate` in `.github/workflows/pr-gate.yml` enforces this
(`scripts/ci/require-detection-change.mjs`); a fix with no detection change and no declaration fails
the PR gate, naming the touched files.

**Registry layout (T-487).** `docs/reviews/detection-checks.json` and the table in
`docs/reviews/failure-classes.md` are generated aggregates, not hand-edited. Add/edit a check at
`docs/reviews/detection-checks/<id>.json` (fields plus `"section": "checks" |
"notCoveredByThisManifest"`), add/edit a failure class at
`docs/reviews/failure-classes/<slug>.json` (the seven table columns), then run
`node scripts/build-detection-registry.mjs` and commit both the per-entry file and the regenerated
aggregate. `node scripts/build-detection-registry.mjs --check` (wired into
`scripts/tests/build-detection-registry.test.mjs` and the `detection-change-gate` CI job) fails the
PR if the committed aggregate has drifted from the per-entry sources. This is what stops parallel
PRs that each add one check from conflicting on the same two files.

Why: the "share count stored as issue size" class was fixed on one write path in August
(`w177-detection-rca.md`) and recurred on a different write path in September because nothing
re-checked the new path. A write-time guard stops one call site; only an independent audit check
catches the next one.
