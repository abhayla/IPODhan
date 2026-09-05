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
- **Fixed-price SME issue (BSE SME, bsesme.com):** Fly-Hi Maritime Travels Ltd
  — BSE SME, "Fixed Price Issue" of 51,60,000 shares at ₹102/share (opened
  2026-09-01, closed 2026-09-03) —
  https://www.chittorgarh.com/ipo/fly-hi-maritime-ipo/2845/, corroborated by
  https://aninews.in/news/business/fly-hi-maritime-travels-ltds-rs-5263-crore-public-issue-to-open-on-september-1-202620260831160626/.
  Its own DRHP is served directly from bsesme.com (the host prod already
  holds 14 documents from):
  https://www.bsesme.com/download/375028/SME_IPO%20InPrinciple/FlyhiDP_20251231223429.pdf.

No PDFs downloaded/committed — labels and URLs only.

### How BSE SME vs NSE Emerge label the same document types

- **BSE SME (`bsesme.com`)** uses a numeric-id path with a STAGE-NAMED folder
  segment baked into the URL itself, e.g.
  `/download/375028/SME_IPO%20InPrinciple/FlyhiDP_20251231223429.pdf` (DRHP,
  at the in-principle-approval stage) vs.
  `/download/318356/SME_IPO%20Open/01.%20RML_Prospectus_Final_20240817180440.pdf`
  (final Prospectus, once the issue is open) — a second real bsesme.com
  example, RML's IPO. The PDF's own cover text is plain English: "PROSPECTUS
  Dated: <date>". This mirrors bseindia.com mainboard's convention
  (`/corporates/download/<id>/IPO%20Open/RedHerringProspectus_<ts>.pdf`) with
  an `SME_` prefix inserted into the folder name — same underlying BSE
  document system, SME-tagged.
- **NSE Emerge (`nsearchives.nseindia.com`)** serves the prospectus itself
  under a flat, non-staged `/emerge/corporates/content/<CompanyName>_PROSP.pdf`
  path (e.g. `GalaxyMedicareLimited_PROSP.pdf`,
  `CredentConnectNCareLimited_PROSP.pdf` — no "Open"/"InPrinciple" folder
  segment). Corrigenda, by contrast, are NOT served under `/emerge/` at all —
  they land in NSE's general corporate-filings archive, e.g.
  `nsearchives.nseindia.com/corporate/Mahickra_04022026183722_Intimation_of_Corrigendum.pdf`
  and `.../corporate/IPSL_08082025133539_corrigendum.pdf`, named
  `<Company>_<timestamp>_Intimation_of_Corrigendum.pdf` — the SME/mainboard
  distinction lives in which BOARD filed it, not in a folder segment the way
  BSE SME encodes it.
- Net effect for W-143: the two exchanges do not just label these documents
  differently, they publish CORRIGENDA under structurally different URL
  spaces (BSE SME: same domain, `SME_IPO` in the path; NSE Emerge: a
  completely different NSE path than the prospectus itself uses) — any future
  URL-pattern-based discovery heuristic (as opposed to the title-based
  classifier this repo already uses) would need this distinction, and the
  title classifier in `document-classifier.ts` already does not care which
  path served the file, so it is unaffected by this split.

## Root cause 3 — `ipos.listing_exchanges` (the field the supervisor calls
`ipos.exchange`) is NULL/untrustworthy for SME rows, so NSE Emerge vs BSE SME
cannot be told apart

There is no scalar `ipos.exchange` column; the closest DB field is
`ipos.listing_exchanges` (`packages/shared/src/db/schema.ts:290`, jsonb
`('NSE'|'BSE')[]`). Combined with `segment='SME'` it is the ONLY signal that
distinguishes an NSE Emerge SME issue from a BSE SME issue. Three real,
citable defects converge on it never being trustworthy:

1. **It is the one identity field excluded from the field-priority-matrix.**
   `grep -n "listingExchange" scraper/src/config/field-priority-matrix.ts`
   returns nothing — every other field this pipeline writes (`companyName`,
   `priceRangeMin`, `issueType`, ...) has a documented per-source trust order;
   this one does not. Its value is instead decided ad hoc by
   `extractListingExchanges` (`data-consolidation-orchestrator.ts:440-450`):
   `consolidated.listingExchange || originalScraped.listingExchange` — whoever
   scraped most recently wins, with no memory of a board a prior cycle
   correctly identified.
2. **The consolidation "incoming" vs "existing" comparison records use
   MISMATCHED key names for this field**, so the two sides can never be
   recognized as the same field even if it were added to the matrix:
   `mapScrapedIPOToRecord` (`data-consolidation-orchestrator.ts:359`) emits
   `listingExchange` (singular); `mapIPOToRecord` (line 387) emits
   `listingExchanges` (plural, reading `ipo.listingExchanges`). This is the
   exact "two names for one field" drift `configuration-ssot.md`/DRY exists to
   catch.
3. **Several sources hard-code `'BOTH'` unconditionally, with no real
   per-board detection**, and — per point 1 — nothing stops one of them from
   overwriting a correctly-identified single exchange on the very next cycle:
   `moneycontrol-scraper.ts:299` (`listingExchange: 'BOTH', // Moneycontrol
   aggregates both exchanges`), `description-backfill.ts:53`, and
   `historical-ipo-assembler.ts:91`. For a genuine SME issue — which by
   definition lists on exactly ONE of NSE Emerge or BSE SME, never both — a
   `'BOTH'` value is not merely uninformative, it is wrong, and it happening
   to render as effectively-unusable/null-equivalent for "which SME board is
   this" is consistent with the supervisor's observation across all 172 SME
   rows.
4. Separately, `bse-api-scraper.ts:289-292` documents (in its own comment)
   that BSE's JSON API "exposes no segment field ... asserting a segment here
   mislabels them" and deliberately leaves `segment: undefined` — evidence
   this source family is already known to be missing SME-board-identifying
   signal, though this specific line affects `segment`, not `listingExchanges`
   directly.

**Assumption:** I traced this from code only (no DB access permitted for this
task) — I can show the write path has no per-source authority for this field
and several sources can stomp it with `'BOTH'`, but I could not directly
confirm from a live row whether the persisted value is literal SQL NULL vs.
`['NSE','BSE']` vs. a single-item array that a later cycle overwrote. Whichever
of those it is, points 1-3 are the same underlying defect: this field has no
SSOT/priority discipline, unlike every other field in the pipeline.

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

**Fix 3 (exchange field — Opus-sized, ~4-5 files + tests; needs a design
call, not a mechanical patch):** (a) add a `listingExchange`/`listingExchanges`
entry to `field-priority-matrix.ts` so this field gets the same per-source
trust order as every other field; (b) rename `mapScrapedIPOToRecord`'s
`listingExchange` key to `listingExchanges` (or vice versa) so the incoming
and existing consolidation records agree on one field name; (c) fix the
`'BOTH'`-stomping sources (`moneycontrol-scraper.ts:299`,
`description-backfill.ts:53`, `historical-ipo-assembler.ts:91`) to leave the
field `undefined` when they cannot determine a real single exchange, the same
discipline `bse-api-scraper.ts:289-292` already applies to `segment` ("a
source that can't determine a field must not overwrite it"). Opus-sized
because it touches the shared consolidation contract and 3+ scrapers whose
current behavior other tests likely depend on — this is a design call
(which source outranks which for this field) as much as a patch. Consumer
map: `field-priority-matrix.ts`, `data-consolidation-orchestrator.ts`,
`moneycontrol-scraper.ts`, `description-backfill.ts`,
`historical-ipo-assembler.ts`, plus every existing test asserting the current
`'BOTH'`-wins behavior.

**Staging proof (all three fixes):** deploy to staging, run one full
document-cycle against a currently-OPEN or newly-LISTED fixed-price SME IPO
(e.g. a Fly-Hi Maritime-shaped BSE SME issue) and a currently-open mainboard
IPO with a real corrigendum on file; confirm `documents` gains a
CORRIGENDUM/ADDENDUM row where one exists, `ipo_details.issue_type =
'FIXED_PRICE'` for the SME issue, and `ipos.listing_exchanges` stays a single
correct exchange (not `'BOTH'`) across at least two consolidation cycles for
that SME issue — read from staging logs/API only, no ad-hoc DB queries on any
production/staging host (per the VPS-is-production rule).
