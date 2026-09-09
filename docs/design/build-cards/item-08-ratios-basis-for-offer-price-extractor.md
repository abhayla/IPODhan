# Item 8 — the ratios / basis-for-offer-price extractor

## Purpose

`documents.type = 'RATIOS_BASIS_ISSUE_PRICE'` (NSE's "Ratios / Basis of Issue Price" filing) stops
being `SKIPPED` by the python filing extractor and starts writing `peer_companies.*`,
`promoters.waca`, and `financial_data.current_ratio` / `.quick_ratio` / `.inventory_turnover` — the
three fields nothing extracts today. After this ships, an IPO with this document type stored gets a
peer set, a WACA multiple and the three ratio fields without a human ever opening the PDF.

## Serves

Design §5.4 (build item 8, "32 pending documents"), §7.1 row 8, and the field mapping's rank-1
document assignment for `peer_companies.*` (#121–128, §1.7) and `promoters.waca` (#111, §1.7) and
`financial_data.current_ratio` / `.quick_ratio` / `.inventory_turnover` (Appendix A #107–109, "no
rank 2: KPI table only"). Cross-referenced against `docs/reviews/wp-c-extraction-contract.md` §1
row "C9 KPIs" and "D Promoter & WACA", and `docs/reviews/price-band-ad-field-inventory.md` rows
D3–D5 (WACA) and C9 (KPI table).

**The "32 pending documents" number, cited.** Design §5.4's cause table: "No extractor exists for
the type | 78 | ... the ratios / basis-for-offer-price document (**32 pending** — ...)". I did not
re-measure this count myself this session (no DB tunnel was opened); it is carried from the design
document as written 2026-09-09, not typed from memory independently.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/scripts/extract_filing.py` | exists (2727 lines) | `DOC_TYPES` tuple at line 86 (`("RHP", "PRICE_BAND_AD", "PROSPECTUS", "DRHP")`) gains `"RATIOS_BASIS_ISSUE_PRICE"`. `run()` (lines 2590–2621) branches only on `doc_type == "PRICE_BAND_AD"` (→ `extract_price_band_ad`) vs everything else (→ `extract_rhp`, line 2603–2606); add a third arm routing `RATIOS_BASIS_ISSUE_PRICE` to `extract_price_band_ad` (see Interfaces below for why) or a thin wrapper around it. New parsing added inside (or alongside) `extract_price_band_ad` (function starts line 1020) for the three ratio fields — no existing regex touches them (verified: zero hits for `current.ratio`, `quick.ratio`, `inventory.turnover` anywhere under `scraper/scripts/` or `scraper/src/`). |
| `scraper/src/services/filing-persister.ts` | exists | `FilingDocType` at line 68 (`'PRICE_BAND_AD' \| 'RHP' \| 'DRHP' \| 'PROSPECTUS'`) gains `'RATIOS_BASIS_ISSUE_PRICE'`. New field-write block for `current_ratio` / `quick_ratio` / `inventory_turnover` on `financial_data` (existing blocks: `promoters.waca` at lines 1360–1404, `peer_companies.*` at lines 1681–1717 — **both already write correctly and need no change**, verified by reading `deps.promoters.replacePromoters` / `deps.peerCompanies.batchCreate` call sites). |
| `scraper/src/services/filing-auto-persist.ts` | exists | `EXTRACTABLE_DOC_TYPES` (lines 136–141) gains `'RATIOS_BASIS_ISSUE_PRICE'`. `EXTRACTOR_VERSION` (line 133, currently `'extract_filing.py@2026-09-03'`) MUST bump — its own doc comment says a bump "is what makes every already-extracted document eligible again", and every `RATIOS_BASIS_ISSUE_PRICE` row already sitting at `extraction_status = 'PENDING'` needs no bump to be picked up (PENDING rows are always eligible); the bump matters only if any such row was ever marked `SKIPPED`/terminal by prior code — **the design does not say, and I did not find a terminal-skip write path for an unhandled doc type in `filing-auto-persist.ts`; this is a fork, not a decision I am making.** |
| `packages/shared/src/db/schema.ts` | exists | No change. `documentTypeEnum` already carries `'RATIOS_BASIS_ISSUE_PRICE'` (line 65). `financial_data.currentRatio` / `.quickRatio` / `.inventoryTurnover` already exist (lines 567–569, `numeric(precision:5, scale:2)`). `peer_companies` and `promoters` tables and their WACA/PE/EPS/RONW/NAV/PBV columns already exist. |
| `scraper/src/config/field-priority-matrix.ts` | exists | **No change.** Verified by grep: zero entries for `currentRatio`, `quickRatio`, `inventoryTurnover`, `peerCompanies`, `waca` anywhere in this file today — it only carries `ipos` fields (confirms design §7.1's "32 of 240 fields" claim). Wiring these into a priority matrix is item 2/3's job, not item 8's; item 8's writes go through `persistFilingExtraction`, which has no priority resolution today (design §7.1 item 1's own description) and this card does not change that. |

## A fact I verified myself, and it changes the card's scope

The task brief that produced this card asserted: *"on production these documents are served by NSE
as ZIP archives, not PDFs ... the card must cover unzipping as part of the path."* I read the
download path before writing anything on that assumption, and it is **already handled, generically,
before extraction ever runs**:

- `scraper/src/services/document-download-verifier.ts` lines 307–325: every discovered document
  download is tested for the zip magic bytes (`body.readUInt32LE(0) === 0x04034b50`); if it is a
  zip, `extractPdfMembersFromZip` + `selectZipMemberForType` unwrap it to a single PDF buffer
  **before** anything is stored.
- `document-classifier.ts` line 181, `isNseRatiosArchiveUrl()`: NSE's `RATIOS_<SYMBOL>.zip` naming
  is checked explicitly so the "bytes win" member-name retype rule (line 325,
  `!isNseRatiosArchiveUrl(meta.url)`) does **not** relabel a ratios filing as `PRICE_BAND_AD` just
  because the PDF member inside is named "... - Price Band Advertisement.pdf" (per
  `document-discovery-runner.ts` lines 1055–1063's own comment, this is the literal NSE filing name:
  "Price Band Advertisement-cum-Basis of Issue Price").
- `scraper/src/services/document-store.ts` line 3 (module doc): the local store layout is
  `<ipo_id>/<doc_type>-<sha8>.pdf` — always `.pdf`, never `.zip`. `storeDocument()` (line 160) takes
  a `pdf: Buffer` param that the caller already unwrapped.
- Verified against the two probes: `extract-real-pdf.out.json` lines 463–467 and 1169–1173 show
  `stored_status: "PENDING"` with a `stored_sha256` present for both sampled RATIOS documents — the
  file is already downloaded and stored (as a plain PDF); the recorded failure is purely
  `"SKIPPED — the python filing extractor does not handle this document type"`, never a zip error.

**So this card does not add unzip handling — none is needed.** The one useful fact the "combined
filing" naming surfaces is that a `RATIOS_BASIS_ISSUE_PRICE` PDF is, physically, the same
"Price Band Advertisement-cum-Basis of Issue Price" content a `PRICE_BAND_AD` row already carries —
which is why routing it to `extract_price_band_ad` (which already parses WACA at lines ~1560–1672
and peer companies at lines ~1715–1725, verified this session) is the low-risk path, rather than
writing a parser from nothing. **Fork, not decided here:** whether NSE's ratios filing is *always*
byte-identical in section layout to a PBA, or only usually — the design does not say, and this card
recommends building against `extract_price_band_ad` first and falling back to a dedicated parser
only where the two live fixtures (below) disagree.

## Schema

No schema change. Every target column already exists (see Files table).

## Interfaces

```ts
// scraper/src/services/filing-persister.ts:68
export type FilingDocType = 'PRICE_BAND_AD' | 'RHP' | 'DRHP' | 'PROSPECTUS' | 'RATIOS_BASIS_ISSUE_PRICE';
```

```python
# scraper/scripts/extract_filing.py:86
DOC_TYPES = ("RHP", "PRICE_BAND_AD", "PROSPECTUS", "DRHP", "RATIOS_BASIS_ISSUE_PRICE")

# run(), line 2590 — new branch
if doc_type in ("PRICE_BAND_AD", "RATIOS_BASIS_ISSUE_PRICE"):
    meta = extract_price_band_ad(page_texts, emit, segment)
else:
    meta = extract_rhp(page_texts, emit, issue_size_rupees=issue_size_rupees,
                        segment=segment, doc_type=doc_type)
```

New emitted fields inside `extract_price_band_ad` (or a helper it calls), matching the existing
`emit.put(name, value, page, check_name, (passed, detail))` idiom already used for every other
field in that function (e.g. line 1040 `emit.put("face_value", ...)`):

- `current_ratio` (numeric, current assets ÷ current liabilities) — check: `> 0`, or `null` with a
  reason if the KPI table has no such row.
- `quick_ratio` (numeric) — check: `> 0` and `≤ current_ratio` when both present (a quick ratio
  cannot exceed the current ratio by definition — this is a check I am adding, not one the design
  states; **fork**: the design does not specify an arithmetic check for these three fields, only
  that they are DOC-only with "no rank 2" — see Appendix A #107–109).
- `inventory_turnover` (numeric) — check: `> 0`.

No new interface is needed for `peer_companies` or `promoter_waca` — `extract_price_band_ad`
already emits `peer_companies` (as a list of `{name, face_value, closing_price, pe}`, line ~1725)
and `promoter_waca` / `waca_last_1y` / `waca_last_3y` / `waca_secondary_transactions` (lines
1619–1672), and `filing-persister.ts` already consumes both (Files table above). **Gap noted, not
closed by this card:** the emitted peer row shape (`name, face_value, closing_price, pe`) does not
carry `eps`, `diluted_eps`, `ronw`, `nav`, or `pbv_ratio`, which `peer_companies` (#124–128) has
columns for. Extending peer-row extraction to those five fields is in scope for whoever reads the
RATIOS document's actual peer table layout against a real fixture (§ below) — the design does not
say whether the ratios filing's peer table prints them; **this is a fork for the two-fixture read**,
not a decision this card makes.

## Feature flag

The design does not name a flag for this item, and per the router table (§7.2) item 8 is
independent and additive — a new doc type an old build never saw is inert until a document of that
type exists and reaches `PENDING`. **Recommendation (mine, not the design's):** gate the new
`run()` branch behind `ENABLE_RATIOS_EXTRACTION` in `scraper/src/config/feature-flags.ts` (pattern
at line 67, `ENABLE_GMP_NAME_MATCH`), default `false` in prod/staging until the two-fixture proof
below passes, `true` in local. Rollback without the flag is "revert the commit" (Rollback below);
the flag exists only to decouple deploy from enable.

## Tests

- **Unit, `scraper/tests/unit/scripts/extract-filing-ratios.test.ts` (NEW).** Feed the two captured
  fixtures (below) through `run(page_texts, "RATIOS_BASIS_ISSUE_PRICE", ...)` and assert: (a)
  `extraction_status` is `OK` or `PARTIAL`, never a crash; (b) `current_ratio` / `quick_ratio` /
  `inventory_turnover` are non-null numbers matching the fixture's printed KPI table; (c)
  `promoter_waca` and `peer_companies` are non-null and match the RHP/PBA-derived expectation where
  the same company also has a PBA fixture. **Must be red before the change** — today, feeding either
  fixture through `run()` returns `{"error": "unknown doc type RATIOS_BASIS_ISSUE_PRICE"}` at
  `main()`'s validation (line 2681-2682) before `run()` is ever reached, so the red state is trivial
  and mechanical, not a subtle miss.
- **Fixtures needed, not yet in the repo.** `docs/design/probes/fixtures/pdf/` (LOCAL — the directory exists only on a machine that has run the probe; .gitignore excludes it on purpose) already gitignores
  raw PDFs; the two documents the probes already fetched —
  `nsearchives.nseindia.com/content/ipo/RATIOS_ARCIL.zip` (asset-reconstruction-company-india-ltd)
  and `RATIOS_VINOD.zip` (vinod-texworld-ltd) — are the two real fixtures to extract from and
  transcribe expected values for, the same way `purple-style-labs-expected.json` was built for WP C
  (`docs/reviews/wp-c-extraction-contract.md` §3). **I have not transcribed these fixtures this
  session** (no PDF tooling was run) — that transcription is the first task of implementation, not
  optional.
- **Integration**: none required beyond the existing `filing-auto-persist` integration suite picking
  up the new doc type automatically once `EXTRACTABLE_DOC_TYPES` includes it — no new integration
  test file; extend the existing doc-type-coverage assertion if one exists (not verified this
  session which integration file, if any, enumerates `EXTRACTABLE_DOC_TYPES` — a fork for the
  implementer to check before assuming none needs updating).
- Tier per `.claude/rules/scraper-test-layout.md`: unit (mocked, isolated, fast) — `scraper/tests/unit/`.

## Detection

**No detection change: touches only the extractor and its own doc-type routing, not a live write
path with an existing audit; the new fields (`current_ratio`/`quick_ratio`/`inventory_turnover`)
have no consumer on the site yet, and `PULL-YIELD`/`PULL-EXCUSED` (design §4) already cover "a
document type's excused set grows" for the general case once the pull loop (item 6) is live.** This
reason is a placeholder judgment call by this card, not the design's — the design does not discuss
detection for item 8 specifically. If a reviewer disagrees, the minimum addition would be one line
in `docs/reviews/detection-checks/` asserting `financial_data.current_ratio` is non-null for every
IPO holding a `COMPLETED` `RATIOS_BASIS_ISSUE_PRICE` row — cheap, and named here as the fallback if
"no detection change" is rejected.

## Staging proof

Run the extractor against both real fixtures (ARCIL and Vinod Texworld) on staging, then read
`documents.extraction_status` for those two rows: healthy value is `COMPLETED` (was `PENDING`
before). Second line: `SELECT current_ratio, quick_ratio, inventory_turnover FROM financial_data
WHERE ipo_id = ...` for both — healthy value is three non-null numbers, not the current all-null
state (verified this session: zero writers touch these columns today). This is not a data-repair
item (no existing rows are rewritten, only previously-`PENDING` rows move forward), so
`assert-repair-held.mjs` does not apply.

## Rollback

Revert the commit. No stored value is rewritten by this change — a `PENDING` document that starts
being processed and produces a wrong value writes into `financial_data`/`peer_companies`/`promoters`
rows that did not previously hold a value (all-null today, verified), so the failure mode is "wrong
data written where there was none," not "correct data overwritten." Reverting stops future writes;
already-written bad rows would need the same per-field correction any other bad extraction gets
(`field_sources` history, per `defect-fix-contract.md` — not a new mechanism this item needs).

## Tier, budget and cost

**Tier B** (per the task brief and design §7.1: "medium, independent" — ordinary app code, no
deploy/auth/migration/deletion). `Budget: 45 min wall-clock, 90 tool calls` for implementation
(fixture transcription + parser + tests + review) — this card itself is Tier C design work.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

None. This item implements no numbered rule of the design — it is scaffolding for
the items that do. Stated explicitly rather than left blank, because an empty list and
a forgotten list look identical.

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
