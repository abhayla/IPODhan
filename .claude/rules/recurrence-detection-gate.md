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
`scraper/src/utils/data-validation.ts`, or a row in `docs/reviews/failure-classes.md` — OR carry a
line matching `^No detection change: <reason, 20+ chars>$` in the PR body or a commit message. The
CI job `detection-change-gate` in `.github/workflows/pr-gate.yml` enforces this
(`scripts/ci/require-detection-change.mjs`); a fix with no detection change and no declaration fails
the PR gate, naming the touched files.

Why: the "share count stored as issue size" class was fixed on one write path in August
(`w177-detection-rca.md`) and recurred on a different write path in September because nothing
re-checked the new path. A write-time guard stops one call site; only an independent audit check
catches the next one.
