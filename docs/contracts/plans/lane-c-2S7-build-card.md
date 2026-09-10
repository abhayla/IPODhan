# 2-S7 build card — `ipo_details.issue_type` from Chittorgarh report 82

**Written 2026-09-11 01:50 IST, from measurement taken the same night.** Everything below
was measured, not assumed. Where something is untested it says so.

## Do not start by re-discovering these

| fact | measured value |
|---|---|
| Source field | Chittorgarh report 82 `Pricing Method` — **Bookbuilding 206 / Fixed Price 25** |
| Also carried | `Issue Category` (SME 145 / Mainboard 86), and a **real href** per row |
| Endpoint | `report/data-read/82/1/10/2026/2026-27/0/all/0?search=&v=15-11`, Referer `https://www.chittorgarh.com/` |
| Rows in that report | 231 for FY2026-27 |
| Matching our IPO rows | **194 of 277** by identity fold |
| Rows it would FILL | **183** (issue_type null today), **zero conflicts** with existing values |
| Rows needing a NEW `ipo_details` row | **182 of 183** |
| `ipo_details` today | 25 rows for 333 IPOs — 19 BOOK_BUILDING, 6 NULL, **zero FIXED_PRICE** |
| Captured fixture | `docs/design/probes/fixtures/chittorgarh/report-82-pricing-method.json` |

## Start from the existing draft, do not rebase it

**PR #367** (`feat/t475-issue-type-writer`, draft, 2026-09-07) already builds this from the
Chittorgarh **detail page** — one HTTP call per IPO. It is **286 commits** behind main with
**five** contested files, two of them generated aggregates that per T-487 are regenerated
rather than merged. **Do not rebase it.**

**Take from it** (the expensive, thought-through parts):
- `scraper/tests/unit/scrapers/chittorgarh-detail-issue-type.test.ts` and
  `scraper/tests/unit/services/chittorgarh-issue-type-visitor.test.ts`
- its `failure-classes.md` row — it already states the real defect: *the FIXED_PRICE
  exemption in `collectDegeneratePriceBandFields()` was dead code without this write path*
- the matrix entry `issueType: { sources: ['ADMIN','CHITTORGARH'], … }` — this is what
  gives the field priority resolution without `consolidateIPOData`
- `upsertIpoDetailsIssueType` — it already creates the row and never overwrites a value

**Replace** the per-IPO detail-page fetch with the report-82 list read: one call, 231 rows.

## The two traps

1. **Do not derive `issue_type` from the price band.** `filing-persister.ts:924` already has a
   last-resort `floor === cap → FIXED_PRICE` step, and `checkDegenerateBookbuildingBand`
   exempts `FIXED_PRICE`. Deriving it and then exempting on it makes that check permanently
   green on exactly the rows it exists to catch. Latent today (zero degenerate bands among the
   25 rows) — this slice should remove the need for that step, not add a second one.
2. **Do not match on symbol alone.** Our `INJECTO POLYMERS` carries symbol `IPL`; NSE's `IPL`
   is `India Pesticides Limited`. Filed as #562 against `nse-past-issue-matcher`. Use the
   identity fold.

## Proof

- Failing test first, on the real function, from the captured fixture.
- Real-data proof: `ipo_details.issue_type` non-null count on staging **before and after**,
  and the `issueType` provenance rows written with source `CHITTORGARH`.
- **Check the served staging sha first.** Deploys have been failing since #548; staging served
  `ecccc4bd` at the time of writing. A proof read against a stale slot proves nothing.
- Detection: the fill-rate row already drafted in #367 (report-only, not a `--gate` threshold —
  the field fills gradually as the cycle rotates).

## Open question, honestly open

Whether the Chittorgarh path may create `ipo_details` rows at all, or whether that must wait
for item 1's child-table consolidated writer. **#367's matrix entry is the argument that it
may** — the field gets priority resolution either way. That is a **review note on the PR**,
not a blocker, but it is the reviewer's call and it should be raised explicitly in the body.

## The write half — RULED from code 2026-09-11, verified line by line

The open question in the section above ("may the Chittorgarh path create `ipo_details`
rows, or must it wait for item 1?") is **answered: it may**, and the reason is not the
one I originally gave.

**Verified verbatim before accepting the ruling:**
- `makeIpoDetailsWriter` — `filing-persist-deps.ts:41-58` — has `upsert` (on `ipo_id`)
  **and** `insertIfMissing` (`INSERT … ON CONFLICT DO NOTHING`), added by W-151 precisely
  to create the identity row per IPO. That solves "182 of 183 have no row".
- `filing-persister.ts:967` already runs
  `dropOutranked('ipo_details', details, [… 'issueType' …])` — **issueType is explicitly in
  that list** — and `:980` runs `filterFields('ipo_details', details)`.

**Correction to this card's earlier reasoning, which was mine and was wrong.** I wrote that
#367's matrix entry `issueType: [ADMIN, CHITTORGARH]` gives the field priority resolution.
It does not. **The field-priority matrix governs `ipos` writes only** — `getFieldRules` is
consulted solely inside `consolidateIPOData`, and every call site passes
`tableName: 'ipos'`. `issueType` is an `ipo_details` field and never appears in ipos
`incomingData`. **`dropOutranked` over `field_sources` is the mechanism that ranks this
field**, not the matrix.

**And a correction to the ruling, which does not change it.** The ruling repeats the comment
at `filing-persist-deps.ts:40`, "ipo_details has no repository".
`web/lib/repositories/ipo-details-repository.ts` **exists**. It is not a bare insert:
`upsert()` at `:63-70` is `INSERT … ON CONFLICT DO UPDATE` on `ipo_id` — the same
operation `makeIpoDetailsWriter` performs — plus a `delete()` at `:93-100`. It is exported
at `web/lib/repositories/index.ts:13` with an interface at `types.ts:252`. Nothing calls it — only an export in `index.ts` and an interface in
`types.ts` — so the claim is right in **effect** and wrong in **fact**. Do not trust that
comment: a future caller wakes that path up and the one-writer-per-table rule is silently
already broken. Same latent shape as #562.

### The five rules for the write half

1. **Create only via `makeIpoDetailsWriter`** — `insertIfMissing` for the identity row
   (`data_source = CHITTORGARH`), then the `issueType` write through the **same**
   `dropOutranked` + `filterFields` sequence, with a `field_sources` row naming CHITTORGARH
   and report 82.
2. **Do NOT lift `upsertIpoDetailsIssueType` from #367.** It would be a second writer for the
   table, which is exactly what W-151 fixed. Lift #367's **tests and failure-class row only**.
3. **`dropOutranked` must let a filing-sourced value (DRHP/RHP/PROSPECTUS) or ADMIN beat
   report 82.** Report 82 fills nulls and never overwrites those. **Assert it with a
   mutation**, or the ordering is untested.
4. **Leave the `floor === cap` guess (`filing-persister.ts:924`) and the FIXED_PRICE
   exemption (`substance-checks.mjs:177`) in place.** Retiring both is a follow-on slice
   whose **detection change IS the exemption removal**. Do not bundle it here.
5. **Real-data proof:** staging `ipo_details` row count and non-null `issue_type` **before
   and after one cycle** — expected **+182 rows / +183 values** — and the zero-conflict claim
   **re-measured after the write, not before**. Read the served sha first with
   `Cache-Control: no-cache` (the endpoint carries a one-year `s-maxage`) and say which
   method the proof line used.
