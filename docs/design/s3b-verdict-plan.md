# S3b — the comparator decides; the verdict is written. Closes OD-58.

**Core:** a field with two witnesses that agree is stored CONFIRMED, and one with two that
disagree is stored DISPUTED, decided by the OD-59 comparator at write time.
**Proof:** ONE real field on staging, `ipos.issue_size`, with DOC and CHITTORGARH as its two
witnesses, read back showing `witnesses` populated and a verdict that matches what the two
sources actually said.

Tier A. Flag OFF by default. Depends on: S2 (columns) + S3a (collection) both merged.

## THE PROOF MUST USE DOC + CHITTORGARH. NOT NSE.
`ipos.issue_size` has `NSE: capable:false` in the manifest, because NSE computes issue size
EXCLUDING the OFS portion. An earlier plan named NSE here and would have produced a fabricated
proof. Read the capability block before choosing the proof field.

## Step 1 — the field -> ComparisonFamily mapping (issue #775). This IS part of S3b.
Measured 2026-09-19: NOTHING supplies a family today. The spec has zero occurrences of
`comparisonFamily`; the manifest's `class` is a SOURCING class; `unit` is scale-only.

DERIVE it from structure, do NOT hand-assign and do NOT guess from naming conventions.
Three layers, in this order, exactly the way `unitForField()` already layers its own answer
(`scripts/generate-field-manifest.mjs`, whose comment says it "reads the SAME probe output rather
than a hand-typed guess, so it cannot silently diverge"):

  LAYER 1 - the amount-columns probe (`docs/design/probes/amount-columns.out.json`, 160 columns,
  already reviewed under OD-20 and already read by the generator):
      CRORE / PER_SHARE / RUPEES_KEPT / SHARE_COUNT -> MONEY
      RATIO / PERCENT / MULTIPLE                    -> RATIO
    MEASURED: this classifies 100 of 190 fields (76 MONEY + 24 RATIO) with zero guesses.

  LAYER 2 - the DB column type, read from the DECLARATION LINE in schema.ts (anchor the regex to
  the line; a byte-window lookahead produced two false positives when I tried it):
      date / timestamp -> DATE      (exactly 10 fields)
      boolean          -> BOOLEAN   (exactly 4 fields)
      jsonb / .array() -> SET or abstain, per the split below (13 fields)
      text/varchar/char-> IDENTITY or IDENTIFIER (42 fields)
      integer/numeric/bigint not in the probe -> MONEY or RATIO (10 fields, one look each)

  LAYER 3 - a small explicit decisions file for what layers 1 and 2 do not settle, with a stated
  reason per entry. Never a bare list.

WHY STRUCTURE BEATS BOTH HEURISTICS, measured: the column type finds
`brlm_track_record.as_of_date` and `documents.filing_date` as DATE - NEITHER the manifest `class`
nor a name-pattern guess identifies them (they are not class T). And `class === 'T' ? 'DATE'`
would additionally include `ipos.status` (an enum string) and `ipos.listing_exchanges` (an array),
both of which normalise to null via normalizeDate and would then COMPARE EQUAL - the null-collapse
bug the #774 mutation test caught. BOOLEAN likewise: the column type finds 4, a name guess finds 2.

THE THREE REMAINING HUMAN DECISIONS (not 40 fields - three questions):
  (a) the 42 text fields: IDENTITY vs IDENTIFIER. Mechanical for the obvious ones (isin/cin/symbol
      -> IDENTIFIER after exact match; company_name/registrar -> IDENTITY after folding corporate
      forms), but state the line once and apply it.
  (b) the 13 array/jsonb fields, which are TWO different problems:
      TRUE SETS OF SCALARS (6): ipos.listing_exchanges, ipo_details.exchanges,
        ipo_details.sponsor_banks, ipo_details.sub_categories_upi, ipos.lead_managers,
        ipo_details.lead_managers -> new SET family, unordered multiset after per-element
        normalisation. Borrow the element key from `unionSetValues`
        (data-consolidation-service.ts:459). NOTE: SET_VALUED_FIELDS currently holds exactly ONE
        field (listingExchanges), so this is mostly new, not a reuse.
      STRUCTURED LISTS (7): anchor_investors.investor_list, ipos.objectives,
        ipo_details.category_details, ipo_details.bid_windows, ipo_details.allocation_pct,
        ipo_risk_factors.kpis, ipo_details.promoter_group_transactions_since_drhp
        -> EXPLICITLY ABSTAIN from consensus, recorded as a named decision with its reason.
        "Same list of objects" needs a key, an ordering policy and an optional-field policy; that
        is a slice of its own. Reaching the string comparator marks every one permanently DISPUTED
        on a JSON key-order difference, which is worse than no verdict.
  (c) the 10 numerics absent from the probe: MONEY or RATIO, one look each.
  Plus FREE TEXT (ipo_risk_factors.body/heading, ipo_valuation.pe_not_ascertainable_reason) ->
  ABSTAIN. Two sources never produce identical prose; permanent DISPUTED on every risk factor
  buries the real disputes.

  Also look at `brlm_track_record.issues_3y` on its own - no declaration was found for it by the
  column-type pass, which is either a naming mismatch or a manifest row for a column that does not
  exist. Report which; do not silently default it.

The mapping is GENERATED into the manifest, never a hand-kept parallel list (the S0b precedent).
A test asserts 190/190 resolve AND that no field reaches the default. A field with no family
silently falls back to the OLD string comparison, which reads as "working" in every log.

## Step 2 — write the verdict
Five states (per segment, resolved at walk time, never a static list):
CONFIRMED / DISPUTED / UNCONFIRMED / SINGLE_SOURCE / NO_WITNESS.
OD-60: an empty answer ABSTAINS. null/undefined/'' only - NEVER 0. `ofs_shares = 0` on a pure
fresh issue is a real value. S1 already implements this correctly in areEquivalent's family path.
OD-57 tie-break by family: dates+status -> exchange wins; money+counts -> document; names+ids ->
document after normalisation; live numbers -> exchange.

## Step 3 — the flag
OFF by default. ON writes verdicts. The S7 check (built right after) is what gates any flip.

## Failing tests first
- two witnesses agreeing -> CONFIRMED; disagreeing -> DISPUTED; one abstaining -> UNCONFIRMED
  (never DISPUTED - OD-60)
- a single-capable-source field on SME_NSE -> SINGLE_SOURCE, using the SEGMENT's count not
  MAINBOARD's. VERIFIED 2026-09-19 against the manifest: SINGLE_SOURCE is 68 / 87 / 77 for
  MAINBOARD / SME_BSE / SME_NSE, and the sets are NOT the same fields -- 10 fields are
  single-source on SME_NSE but not on MAINBOARD, and 1 the other way, so a MAINBOARD-derived
  static list mislabels 11 fields on SME_NSE alone.
- NO_WITNESS is real and segment-specific: SME_BSE has exactly one
  (listing_performance.current_price_nse) and SME_NSE exactly one
  (listing_performance.current_price_bse) -- an SME listed on one exchange has no witness for
  the other exchange's price. MAINBOARD has none. A test must cover NO_WITNESS on an SME
  segment, because it is unreachable on MAINBOARD and would otherwise never execute.
- every one of the 190 manifest fields resolves to a family
- flag OFF -> no verdict written, behaviour identical to S3a

## Mutation tests
- map class T to DATE wholesale -> the status/listing_exchanges test goes red (null-collapse)
- treat an abstention as a disagreeing vote -> the UNCONFIRMED test goes red
- resolve SINGLE_SOURCE from MAINBOARD's list for an SME IPO -> the segment test goes red

## Real-data proof
Staging cycle: one `ipos.issue_size` row with DOC + CHITTORGARH, `witnesses` populated with both
answers, verdict matching what the two sources actually said - read back by identity, not counted.
