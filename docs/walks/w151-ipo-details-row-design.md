# W-151 design: an `ipo_details` row for every persisted filing (Fable, 2026-09-05 17:35 IST)

## Problem
Production has 3 `ipo_details` rows for 358 IPOs. `persistFilingExtraction` (filing-persister.ts ~L720-731)
upserts `ipo_details` only when the extraction yielded at least one writable detail field; W-147 shows
RHP/PROSPECTUS/DRHP extraction never yields the offering headline, so most filings produce zero detail
fields and no row. The page and audits treat "no row" and "row with unknown fields" the same, so the
defect is invisible.

## Decision
1. **A row per IPO once ANY filing (ad, RHP, DRHP, prospectus) is persisted**, even if every optional
   column is null: the row carries `data_source`, the source document id and the extractor version, so
   coverage becomes measurable (`audit:coverage` can count "IPOs with a details row" vs "with issue_type").
2. **Not before W-147.** Creating empty rows without the headline extractor only moves the gap; W-147
   (offering headline from RHP/PROSPECTUS cover) lands first, W-151 follows in the same bundle so the
   first backfill populates real values.
3. **Field protection unchanged**: the empty-row insert goes through `filterFields` like every other
   write; an admin-protected column is never overwritten.
4. **Backfill = the normal cycle**, not a script: resetting the stored filings to PENDING lets the
   document cycle re-run extraction under the new code (bounded by the spawn budget); no direct DB script.

## Out of scope
The stray `ipos.exchange` varchar (W-145c, schema drift) and the exchange priority-matrix entry (W-145)
stay separate.

## Acceptance
- Staging: after one full rotation, `ipo_details` rows >= number of IPOs with a COMPLETED filing.
- `audit:coverage --gate` gains the "details row present" counter (fails below 90% of COMPLETED filings).
- Unit: persister writes the row on a zero-detail extraction; protected columns untouched.
