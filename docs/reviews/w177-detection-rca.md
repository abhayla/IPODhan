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

## Round 2 (Opus review: CRITICAL-1, MAJOR-1)

### CRITICAL-1 — round 1's "class mechanism" claim was false

Round 1 said the class mechanism was "every door that writes `issueSize`
calls `collectImplausibleIssueSizeFields` before it writes." That was true of
`data-persister.ts`'s two doors but **not of the door prod actually uses**:
with `ENABLE_DATA_CONSOLIDATION` on (prod), `BaseScraperOrchestrator.ts:539`
writes via `DataConsolidationOrchestrator.consolidatedUpsertIPO`, which calls
`consolidationOrchestrator.extractConsolidatedData()` to build the insert/
update payload — `data-persister.ts`'s `upsertIPO` runs only on the
skip-fallback (:554) / flag-off (:595) branches. The T-329 guard's OWN call
inside `consolidateIPOData` correctly rejected Shanti's share count (`
fieldResult.finalValue` came back `undefined` — no stored value to fall back
to on a brand-new row), but `extractConsolidatedData` then rebuilt the write
payload as `consolidated.issueSize?.toString() ??
originalScraped.issueSize?.toString()` — the `??` treated "consolidation
rejected the value, nothing to write" the same as "consolidation never
touched this field," and re-admitted the exact raw share count the guard had
just refused.

**Why round 1's own review didn't catch it:** round 1 traced from
`data-persister.ts` outward (the file the T-329 guard's original author
touched) and never traced INTO `BaseScraperOrchestrator.ts` to check which of
the two write doors prod's `ENABLE_DATA_CONSOLIDATION=true` config actually
exercises. The unit tests added in round 1
(`data-persister-issue-size-plausibility.test.ts`) call `upsertIPO` directly,
so they never exercised the consolidation-orchestrator door at all — a green
suite proved the door round 1 fixed was fixed, and said nothing about the
door prod uses.

**Fix:** `DataConsolidationOrchestrator.extractConsolidatedData()` now builds
a `rejectedFields` set from `result.fieldResults[].rejectedSources` (any
entry naming the incoming `source` — the shape every rejection branch in
`data-consolidation-service.ts` already produces) and never falls back to
`originalScraped` for a field in that set. Swept the same `??`/`||
originalScraped.<field>` pattern across every field in
`extractConsolidatedData` that reads from `originalScraped`:
`companyName`, `segment`, `offeringType`, `issueSize`, `status`, `openDate`,
`closeDate` (all seven now gated through the same `fallback()` helper).
`priceRangeMin`/`priceRangeMax`/`sector`/`lotSize`/`faceValue`/
`allotmentDate`/`listingDate`/`companyDescription`/`registrar`/
`leadManagers`/`symbol`/`isin` were already read straight off `consolidated`
with no `originalScraped` fallback and needed no change; `listingExchanges`
has its own dedicated resolver (`extractListingExchanges`) already reasoned
about separately (W-145) and was left as-is.

**Corrected class mechanism:** the class is now genuinely closed at BOTH
doors — `data-persister.ts` create/legacy-fallback (round 1) AND the
consolidation orchestrator's create/update (round 2) — because both now
distinguish "consolidation had nothing to say about this field" from
"consolidation evaluated and rejected the incoming value," and only the
former falls back to the raw scrape.

**Detection upgrade:** `scraper/tests/unit/services/data-consolidation-orchestrator-issue-size-rejection.test.ts`
exercises the REAL `DataConsolidationService.consolidateIPOData()` (not a
mocked stand-in) feeding a REAL rejection result into
`extractConsolidatedData`, so a future regression that reintroduces a bare
`?? originalScraped.<field>` on a guarded field fails a unit test, not just
`audit:substance` on the next scrape cycle. `audit:substance --gate`
(round 1) remains the read-side backstop for whichever door a future write
bypasses next.

### MAJOR-1 — the coherence arm's `sharesOffered` input is a dead field name

`data-persister.ts:755/773` passed `(scrapedIPO as any).sharesOffered` into
`collectImplausibleIssueSizeFields`'s shares-x-band coherence check.
`sharesOffered` is NOT a field on `ScrapedIPO`
(`scraper/src/utils/validators.ts` `ScrapedIPOSchema`) — it belongs to the
unrelated `ScrapedSubscriptionSchema` (subscription-multiple records). No
IPO-main scraper or adapter sets either `sharesOffered` or
`noOfSharesOffered` on the `ScrapedIPO` object reaching this door: NSE's
`computeNSEIssueSizeRupees` (`nse-api-client.ts`) reads `noOfSharesOffered`
off the RAW API response and converts it to rupees internally, but the share
count itself never survives onto `ScrapedIPO`. **The coherence arm at the
create/legacy-fallback door has therefore never fired in prod** — it silently
degrades to the segment-floor check alone for every real scraper today.

**Fix applied:** changed the read to `(scrapedIPO as any).noOfSharesOffered
?? (scrapedIPO as any).sharesOffered`, matching the same preference order
`collectImplausibleIssueSizeFields` itself uses internally
(`data-consolidation-service.ts:563`) — the day a scraper starts populating
either key, this door and the consolidation orchestrator's coherence check
agree with no further change needed. **This is a documented gap, not a
closed one**: no schema field currently carries the share count onto
`ScrapedIPO`, so the coherence arm remains dormant at this door until a
future scraper change adds one (out of scope for this round — the segment
floor, which DOES fire today, is what caught both Shanti and Ashutosh Fibre).
Test 5 in the new orchestrator test file proves the coherence arm fires
correctly at the `DataConsolidationService` layer when a real field name
(`noOfSharesOffered`) is present, so the logic itself is verified even though
today's scrapers never feed it.
