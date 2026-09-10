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
