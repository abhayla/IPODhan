# T-431 — WP C-3: persist extracted filing fields through the write path

Contract: `T-431-ipodhan-wp-c3-filing-persist`. Review tier A (write path + flag + money data).
Reads: `wp-c-extraction-contract.md` §1/§5, `T-403-plan.md` §2/§8/§9, `ipo-document-lifecycle-plan.md` §1.

## 0. Pre-write gate (MUST land before anything writes) — MAJOR-3 from the T-430 round-2 review

`_find_unit` in `scraper/scripts/extract_filing.py` matched bare prose ("3 million customers in
millions of cities" -> `millions`; "in lakhs of homes" -> `lakhs`). Every C-group money field is
multiplied by that unit, so a false match is a silent 10x/100x scale error carrying a GREEN check —
exactly the class the extraction contract's C7 write-gate exists to stop.

Fix:
- Two anchored patterns only:
  - currency-anchored — `(₹|Rs.|INR|Rupees) in <unit>`;
  - caption-anchored — `in <unit>` immediately closed by `)`, `unless otherwise stated`, or `except …`
    (the shape a table header/units caption actually takes).
- Any `in <unit> of …` is rejected outright (the prose shape).
- All pages are scanned. Currency-anchored matches win as a tier; if the surviving tier holds two
  different units the unit is nulled with reason `unit_conflict` (fail closed, never pick one).
- `check_mcap_consistency` and `check_shares_amount` no longer hard-code ₹ million: the rupee
  multiplier is derived from the detected unit (millions 1e6, lakhs 1e5, crores 1e7) and both fail
  closed with `unit_unknown` when no unit was detected. A crore-denominated ad therefore fails with
  a reason instead of passing a 10x-wrong arithmetic check.
- Unit detection moves to the top of `extract_price_band_ad` (the A/B mcap block runs before the
  old detection point).

Tests (`scraper/tests/unit/scripts/extract-filing.test.ts`): the two prose probes -> unit null; a
two-page conflicting-unit probe -> null with `unit_conflict`; a crore ad -> mcap check fails with
`unit`; the PSL RHP + price-band-ad fixtures still resolve to `millions`. The existing mcap mutation
probe gains an explicit `(₹ in million)` caption (it previously relied on the hard-coded multiplier).

## 1. `scraper/src/services/filing-persist.ts`

For each `document_fetch_state` row in `FOUND` that has a stored file (T-403 store path):
spawn `scripts/extract_filing.py`, map the emitted fields onto the T-428 repositories
(`financial-statements`, `ipo-valuation`, `promoters`, `ipo-intermediaries`, `brlm-track-record`,
`ipo-risk-factors`) plus `ipos` / `ipo_details` columns, and write **through `upsertIPO`** (the only
write door) / the repositories.

Rules, all enforced in one place (`shouldWriteField`):
- a field whose check failed is NEVER written; the reason is recorded, not the value;
- `[•]` / `not_priced_yet` / any null-with-reason never overwrites an existing value (E3);
- per-field precedence, ADMIN still top: `ADMIN > PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP >
  DRHP > NSE > BSE > …` (lifecycle plan §1 — the filing tier sits between ADMIN and NSE);
- one `field_sources` row per written field: source = doc type, page, confidence, check name.

Row transitions: `FOUND -> EXTRACTED` (with `extractor_version` stamped) or, after 3 attempts,
`FOUND -> EXTRACT_FAILED` with the admin flag (matrix §7.1).

## 2. Supersession (E2)

`decideSupersession` / `isStaleInProgress` / `markSuperseded` / `repointToSurvivor` are implemented
in `document-state-machine.ts` but unwired. Call them from the persist step when a newer
`filing_date` arrives for the same doc-type family: the older `documents` row goes
`is_active=false`, only carried fields are overwritten, and `field_sources.previous_value` is kept.

## 3. Wiring

New flag `ENABLE_FILING_EXTRACTION` in `scraper/src/config/feature-flags.ts` (default OFF, §GATE
comment). New `runStep('filingExtraction', …)` in `scraper/src/index.ts`, immediately after
`documentDiscovery`.

## 4. Carry-overs from the T-428 review

`BrlmTrackRepository.upsert` becomes atomic (unique `(brlm_name, as_of_date, source_ipo_id)` +
`onConflictDoUpdate`) — or is renamed `recordIfAbsent` with the race documented. Replace-style
repository tests assert the values array handed to `.values()`, not merely call order.

## 5. Nightly checks

`scripts/lib/document-state-checks.mjs` + `detection-checks.json` + self-tests:
- FAIL when a `FOUND` row with a stored PDF is unread > 48 h while the flag is ON;
- FAIL when a Prospectus exists but a price-dependent field still carries `PRICE_BAND_AD` after 48 h.

## 6. Fixture test on `ipodhan_test`

Seed the Purple Style Labs `ipos` row + `FOUND` rows pointing at the local PDFs, run the step once
with the flag ON: every value in `docs/reviews/fixtures/purple-style-labs-expected.json` is readable
through the repositories with the right `field_sources`. Run twice: the second run writes nothing.
Evidence to `evidence/T-431/`.
