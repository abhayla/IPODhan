# W-177 detection RCA — issueSize share-count pollution on the create path

## Instance

`shanti-inorganics-ltd` (issueSize 5,691,200; SME; band 79-83) and
`ashutosh-fibre-ltd` (issueSize 6,124,800; SME; band 87-92) held the SHARE
COUNT in the rupee `issue_size` column — ~80x below the real value. Both are
fresh rows created straight from CHITTORGARH (the field-priority-matrix
winner for SME `issueSize`, `scraper/src/config/field-priority-matrix.ts:413-419`).

Fixed in this PR: `scraper/src/services/data-persister.ts` now runs the same
`collectImplausibleIssueSizeFields` plausibility check (segment floor +
shares-x-band coherence) before `safeIssueSize` is written into `ipoData`,
which feeds both the CREATE door and the legacy-fallback UPDATE door. An
implausible value is dropped (never written) and logged with `logger.warn`
(ipoId, source, path, rejected value, segment floor, shares/band figures).

## Class mechanism

The guard now lives at a single call site that both non-consolidation write
doors share, so any future write door built on `ipoData.issueSize` inherits
it automatically. The consolidation UPDATE path (`consolidateIPOData`) keeps
its own, separately-wired call to the same underlying helper — the class
mechanism is "every door that writes `issueSize` calls
`collectImplausibleIssueSizeFields` before it writes", not a single shared
code path (the two doors build the value differently: consolidation merges
field-priority-ranked sources per field; create/legacy-fallback take the
current scrape's `ipoData` object wholesale).

## Detection RCA — which check should have caught this, and why it didn't

1. **The T-329 round-7 guard itself** (`collectImplausibleIssueSizeFields`)
   was correct in isolation but was called from exactly one site
   (`data-consolidation-service.ts` ~line 728, inside `consolidateIPOData`).
   It was never wired into `data-persister.ts`'s CREATE path or its
   legacy-fallback UPDATE path — both of which sanitize `issueSize` with
   `coercePositiveOrNull` only (positive-number check, no plausibility
   check). Why it didn't catch this: the guard was added as part of a fix to
   the UPDATE-via-consolidation flow and the review that landed it did not
   audit every write door that produces `ipos.issue_size` — a fresh SME row
   created straight from CHITTORGARH never goes through
   `consolidateIPOData` at all (there is no existing row to consolidate
   against), so the guard was structurally unreachable for a create.

2. **`npm run audit:substance`** (`scripts/audit-substance-plausibility.mjs`
   + `scripts/lib/substance-checks.mjs`) had a `checkIssueSize` predicate
   that only asserted `issue_size > 0` — no segment-floor or shares-x-band
   bound. Both polluted rows are positive numbers, so this check passed and
   the audit rendered green while displaying an impossible issue size. Why
   it didn't catch this: the audit's issue-size check was written to catch
   the "0 stored as a real value" class (#A.5), not the "plausible-looking
   but wrong magnitude" class — no check in the substance audit compared
   `issue_size` against `segment` or the price band at all.

3. **The field-priority-matrix `validation.min` for `issueSize`**
   (`scraper/src/config/field-priority-matrix.ts`) is set to `1_000_000` (Rs
   10 lakh) — below BOTH the mainboard floor (Rs10 Cr) and the SME floor
   (Rs1 Cr) established by the T-329 review's own plausibility sweep. This
   min is too permissive to have ever caught either polluted value on its
   own; it functions as a "not literally garbage" gate, not a plausibility
   gate. **Recommendation** (not applied in this PR): raise
   `validation.min` to `SME_ISSUE_SIZE_FLOOR` (1e7) as the floor for the
   whole field, since MAINBOARD's higher floor is enforced separately by
   segment inside `collectImplausibleIssueSizeFields`. Left out of this PR
   because it needs its own regression pass across every non-SME/MAINBOARD
   caller of the matrix (RIGHTS/NCD/REIT/InvIT segments, where `issueSize`
   validation currently shares the same entry) — a test should prove no
   segment is starved of a legitimate low value before the matrix changes.

## Detection upgrade shipped in this PR

- `scripts/lib/substance-checks.mjs`: new `checkIssueSizeSegmentFloor`
  predicate — flags any genuine IPO row where `issue_size` is below its
  segment's floor (MAINBOARD Rs10 Cr / SME Rs1 Cr, the SAME constants as the
  scraper-side guard, kept in sync by hand since this script has no import
  path into `scraper/src`) while a price band is on record. Wired into the
  `SUBSTANCE_CHECKS` registry consumed by `npm run audit:substance --gate`,
  so a future write-path regression (a new source, a matrix change, a manual
  fix that reintroduces the shape) fails the daily/CI-invoked gate on exit
  code, not just on a human noticing an absurd number on the page.
- `scraper/src/services/data-persister.ts`: the CREATE and legacy-fallback
  UPDATE doors now reject an implausible `issueSize` at write time (never
  written) instead of only at read-time detection — this closes the write
  side, the audit above closes the read side, so pollution introduced by
  either surface is now caught.
- Unit tests: `scraper/tests/unit/services/data-persister-issue-size-plausibility.test.ts`
  (create rejection, legacy-fallback rejection, a plausible value passing
  unchanged, the MAINBOARD floor, and the DRHP filing-total exemption not
  weakening the segment floor) and
  `web/tests/unit/scripts/substance-checks.test.ts` (new
  `checkIssueSizeSegmentFloor` suite: SME/MAINBOARD violations, plausible
  passes, no-band pass, null-segment pass, non-positive-size pass, and a
  constants-parity assertion against the scraper guard's values).

## Success metric

- Recurrence of this class (a fresh row's `issue_size` landing below its
  segment floor) = 0 going forward on any write path, enforced by the
  persister guard.
- `audit:substance --gate` now fails on exit code the moment such a row
  reaches the DB by any path the persister guard doesn't cover, closing the
  gap this incident's own detection check (audit:substance) had.
