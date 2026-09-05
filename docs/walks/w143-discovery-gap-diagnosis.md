# W-143 — corrigendum/addendum + fixed-price discovery gap diagnosis

Read-only diagnosis, worktree `IPODhan-w143`, branch
`fix/w143-discovery-corrigendum-fixed-price`. No tests run (laptop memory
reserved for another worker) — two failing unit tests written instead.

## Root cause 1 — corrigendum/addendum never fetched for an already-LISTED IPO

The classifier (`scraper/src/services/document-classifier.ts:108-109`) and the
parsers (`primary-source-discovery.ts:79-139`, wired into
`document-discovery-runner.ts:1718,1740`) correctly recognize and fetch
CORRIGENDUM/ADDENDUM — that part of the pipeline is sound.

The break is in `scraper/src/services/document-state-machine.ts`,
`planIpoCycle` (lines 340-374), via `isPermanentlyPastDue`
(line 133) and `OPTIONAL_DOCUMENT_TYPES` (line 126):

```
const notApplicable = [
  ...notApplicableTypes(issue),
  ...dueDocTypesForStage(params.stage).filter((t) =>
    isPermanentlyPastDue(t, params.stage)   // stage === 'LISTED' && optional type
  ),
];
...
for (const docType of dueDocTypesForStage(params.stage)) {
  if (notApplicable.includes(docType)) continue;   // <- never enters `due`
  ...
}
```

`isPermanentlyPastDue` fires the instant `stage === 'LISTED'`, with **no check
for whether a row exists or was ever attempted**. Almost all 358 IPOs were
already LISTED the first time the T-403 state machine (shipped ~2026-08/09)
ever evaluated them — this is a historical backfill, not a live-only feed. So
CORRIGENDUM/ADDENDUM never reach `due`, never reach `missingRows`
(the `continue` fires before the `byType` lookup), and the runner
(`document-discovery-runner.ts:1650-1658`) marks them NOT_APPLICABLE with
**zero network calls, zero attempts, forever** — indistinguishable from "the
issuer genuinely never filed one." That is exactly the 0/358 observed in
prod. The second usage of `isPermanentlyPastDue` (line 529, inside
`applyOutcome`'s `no_link` branch) is fine — it only fires after a real fetch
attempt already happened.

Failing test: `scraper/tests/unit/services/w143-corrigendum-discovery-gap.test.ts`.

## Root cause 2 — `ipo_details.issue_type` can never become FIXED_PRICE

`ipo_details` has exactly one writer (`filing-persist-deps.ts:39-49`,
`makeIpoDetailsWriter`), invoked only from `persistFilingExtraction`
(`filing-persister.ts:375`). Inside it, `issueType` has exactly one
assignment, `filing-persister.ts:687-688`:

```
const regulation = str(extraction, 'book_building_regulation');
if (regulation) mark('issueType', 'BOOK_BUILDING');
```

There is no sibling branch that can ever write `'FIXED_PRICE'` — the column
can only ever be `'BOOK_BUILDING'` or absent. Two other places in the same
codebase already compute `isFixedPrice` and never feed it here:
`bse-ipo-board.ts:99` (from BSE's `IR_FLAG_FULL`) and
`document-cycle.ts:196-201`'s `deriveIssueShape` (from `price_range_min ===
price_range_max`) — the latter uses the exact same floor/cap fields the
persister already reads at `filing-persister.ts:544-545`
(`price_band_floor`, `price_band_cap`). Combined with root cause 1 (few
extraction runs reach `ipo_details` at all — only 3/358 rows exist), this is
why FIXED_PRICE has never once been written.

Failing test: `scraper/tests/unit/services/w143-fixed-price-issue-type-gap.test.ts`.

## Live examples found on the public web (2026-09-05)

- **Corrigendum/price-band-ad-cum-corrigendum (mainboard):** Kusumgar Ltd's
  anchor intimation letter cites "Red Herring Prospectus dated July 1, 2026,
  read with Price Band Advertisement cum Corrigendum to the Red Herring
  Prospectus dated July 2, 2026" —
  https://www.bseindia.com/downloads/UploadDocs/Notices/Attach/Kusumgar_Ltd_Anchor_Intimation_Letter$2d556423-faa9-4f48-99a4-07705654c76e.pdf
  Hy. Tech Engineers Limited similarly references a "Corrigendum to the RHP" —
  https://www.bseindia.com/downloads/UploadDocs/Notices/Attach/Intimation_Anchor_Hy_Tech$6e4b10ca-afdd-445b-9cc2-ba8f86f107be.pdf
- **Fixed-price SME issue:** Fly-Hi Maritime Travels Ltd, BSE SME, labeled a
  "Fixed Price Issue" of 51,60,000 shares at ₹102/share (opened 2026-09-01,
  closed 2026-09-03) — https://www.chittorgarh.com/ipo/fly-hi-maritime-ipo/2845/,
  corroborated by https://aninews.in/news/business/fly-hi-maritime-travels-ltds-rs-5263-crore-public-issue-to-open-on-september-1-202620260831160626/.

No PDFs downloaded/committed — labels and URLs only.

## Fix plan

**Fix 1 (state machine — Sonnet-sized, ~1 file + tests):**
`document-state-machine.ts`'s `planIpoCycle` must not fold a
never-attempted optional type into `notApplicable` on sight of `LISTED`. Give
it one real `due` cycle first (treat "no row" or "0 attempts" as not yet
past-due even at LISTED), and only apply `isPermanentlyPastDue` once a row
exists with `attempts >= 1`. Consumer map: `document-state-machine.ts` (the
fix), `document-discovery-runner.ts` (no change — already correct once `due`
is populated), `document-state-machine.test.ts` +
`document-state-machine-w28.test.ts` (regression check — they assert the
current LISTED→NOT_APPLICABLE-on-sight behavior and must be updated
alongside the fix, not left contradicting it).

**Fix 2 (issue_type — Sonnet-sized, ~1-2 files + tests):**
Add a `mark('issueType', 'FIXED_PRICE')` branch in `filing-persister.ts`
before/alongside the existing BOOK_BUILDING branch, keyed off
`price_band_floor === price_band_cap` (mirroring `data-validation.ts:56`'s
already-documented rule) when no `book_building_regulation` was extracted.
Consumer map: `filing-persister.ts` (the fix), `filing-persister.test.ts`
(regression — the Deepa Jewellers oracle fixture is BOOK_BUILDING and must
stay BOOK_BUILDING).

**Staging proof (both fixes):** deploy to staging, run one full document-cycle
against a currently-OPEN or newly-LISTED fixed-price SME IPO (e.g. a Fly-Hi
Maritime-shaped issue) and a currently-open mainboard IPO with a real
corrigendum on file; confirm `documents` gains a CORRIGENDUM/ADDENDUM row
where one exists and `ipo_details.issue_type = 'FIXED_PRICE'` for the SME
issue, read from staging logs/API only — no ad-hoc DB queries on any
production/staging host (per the VPS-is-production rule).
