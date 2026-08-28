# T-403 — WP A+B implementation plan (BSE-first document discovery + per-document state machine)

Contract: `T-403-ipodhan-wp-ab-document-discovery-state`. Sources of truth:
`docs/reviews/ipo-document-lifecycle-plan.md` (WP A/B rows, §6 protocol) and
`docs/reviews/ipo-document-source-decision-matrix.md` (§0 hosts, §1 tree, §3 verification,
§4 F1–F20, §7 state machine incl. 7.1–7.6 and R1–R13).

Scope: **discovery + state only.** Extraction is WP C — `FOUND` is the terminal state here.

## 0. Facts re-verified live before writing code (2026-08-28, this PC)

| Fact | Evidence |
|---|---|
| BSE board `IPO_HomePageDetail/w` returns `{Table:[...]}` — 22 rows, 9 of them non-IPO (`Takeover`/`Buyback`/`Debt Issue`/`RI`/`BuyBack`) | `scraper/tests/fixtures/documents/bse-ipo-homepage.json` |
| Board row keys: `Scrip_name, Start_Dt, End_Dt, Status(L/F), IR_flag, IR_FLAG_FULL, IPO_NO, Scrip_cd` | same |
| BSE core `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=7903` returns `{IPONO_0:[row], IPONO_1..4, status}` — the detail row is `IPONO_0[0]`, **not** the top level | `bse-skyways-core.json` |
| Skyways BRLMs = 3: `Book_Running_Lead_Manager` = Holani; `Co_Book_Running_Lead_Manager` = `Shannon...#Dolat Finserv...` (`#`-separated, each `Name^||...|email|contact`) | same |
| Skyways doc links: `Prospectus_GID` (RHP pdf), `Corrigendum` (pdf), `Addendum` (**zip, URL contains literal spaces**), `Price_Band_Advertisement` (pdf); `Anchor_Details` is `""` | same |
| NSE `ipo-detail?symbol=SKYWAYS&series=EQ` returned 200 (12,626 B) with `issueInfo.dataList` titled rows pointing at `nsearchives` zips | `nse-skyways.json` |
| NSE SME `MADHURKNIT&series=SME` returned 200; its row title is **`"Security Parameters "`** (trailing space, no `(Pre Anchor)`) | `nse-madhurknit.json` |
| NSE homepage gave **403** at the same minute the API gave 200 (matrix §0 confirmed) | curl log |
| **BSE wrong URL** gives `HTTP/1.1 302` to `/notfound.htm`, `Content-Type: text/html`, a 164-byte `<h1>Object Moved</h1>` body. A redirect-following client lands on `notfound.htm` at **200 text/html** — the matrix's "200 + Object Moved". The verifier must reject on **content-type + size + HTML sniff**, never on status alone. | curl `-D -` on a mangled `listing.bseindia.com` path |
| Dev DB `ipodhan_wpab`: 309 ipos, 129 documents, 18 applied migrations. All four acceptance IPOs present; **`bse_scrip_code` is NULL for all four**, so IPO_NO must be resolved by normalized name from the board. | node/pg probe |

All fixtures are **real captured payloads**; none are synthetic.

## 1. Root causes being fixed (not one-spot patches)

| # | Root cause | Every call site swept |
|---|---|---|
| RC1 | BSE `Co_Book_Running_Lead_Manager` is `#`-separated and each entry is `Name^|...`; code that splits on `^` and takes `[0]` keeps only the first co-BRLM (F17: Skyways shows 2 of 3) | new `bse-party-parser.ts` becomes the single parser. **CORRECTED after the sweep (T-403 round 1, T3):** exactly ONE file parses BSE packed-party strings — `bse-api-scraper.ts` (`parseLeadManagers` / `parseBSERegistrar`), and it is re-pointed at the new parser. The plan's original claim that four files needed re-pointing was wrong: `bse-detail-scraper.ts` parses **HTML** with `parseCommaSeparatedList` (a different format, no `#`), and `bse-scraper.ts` / `bse-scraper-orchestrator-v2.ts` only pass the already-parsed array along. |
| RC2 | Classifier types a final Prospectus as RHP (`t.includes('prospectus')` returns `'RHP'`), and BSE's `Price_Band_Advertisement` / `Corrigendum` both collapse to `ADDENDUM` | new `document-classifier.ts` becomes the single classifier used by `parseNSEDocuments`, `parseBSEDocuments` and the runner |
| RC3 | Discovery is NSE-only, 15 s cap, no retry, 24 h cadence, and has **no memory** — it re-fetches what it already has and forgets what it failed | state machine + BSE-first runner, per cycle |
| RC4 | A 200 response is trusted as a document | download verifier (matrix §3) |

## 2. State-transition table implemented (matrix §7.1, verbatim)

States: `WANTED`, `NOT_YET_FILED`, `FOUND`, `EXTRACTED`, `EXTRACT_FAILED`, `BLOCKED_ALL`, `SUPERSEDED`, `NOT_APPLICABLE`

| From | Event | To | Side effects |
|---|---|---|---|
| (none) | doc type becomes due at the IPO's stage | `WANTED` | row created, `first_seen_at` |
| `WANTED` / `NOT_YET_FILED` | exchange answered, **field/title empty** | `NOT_YET_FILED` | `next_retry_at = now + 30 min`; **not a failure** |
| `WANTED` / `NOT_YET_FILED` / `BLOCKED_ALL` | link found **and** download verified (§3) | `FOUND` | `documents` row upserted, `document_id`, `filing_date` |
| `WANTED` / `NOT_YET_FILED` | every source failed (timeout/4xx/5xx/bad file) | `BLOCKED_ALL` | P2 alert on entry; retry every cycle for 24 h, then every 6 h |
| `FOUND` | extractor SUCCESS *(WP C)* | `EXTRACTED` | `extracted_at`, `extractor_version` |
| `FOUND` | extractor FAILED x3 *(WP C)* | `EXTRACT_FAILED` | admin flag; no retry until `extractor_version` bumps |
| `FOUND` / `EXTRACTED` | newer superseding filing appears (Corrigendum / Prospectus / Addendum n+1, ordered by **`filing_date`**) | `SUPERSEDED` | old `documents.is_active=false`; new row starts at `WANTED` |
| any | IPO withdrawn, or the type is impossible for this issue (PBA on fixed-price; anchor on SME fixed-price) | `NOT_APPLICABLE` | never retried (R9) |
| `FOUND` stale > 30 min mid-extraction | crash recovery (R6) | `FOUND` | no row is ever left stuck |

Terminal for this WP: `FOUND` (extraction is WP C) — so run 2 of the acceptance run must make **zero** calls for Skyways and Madhur.

Cycle behaviour (§7.2): per IPO compute `due = dueDocTypes(stage) minus {EXTRACTED, SUPERSEDED, NOT_APPLICABLE, FOUND}`; **`due` empty means the IPO is skipped with zero network calls**; otherwise **one** exchange call covers every due type; exchanges are tried first every cycle while anything is missing; fallbacks are only consulted for the types still missing.

Retry policy (§7.3) is encoded in `next_retry_at`: `NOT_YET_FILED` 30 min; `BLOCKED_ALL` 30 min for the first 24 h then 6 h; `EXTRACT_FAILED` stops after 3; Prospectus every cycle until listing day, then alert.

R1–R13 (§7.6) each get a fixture test — see §5.

## 3. Files

**New / edited — `packages/shared`**
- `src/db/schema.ts` (edit): `documentFetchStateEnum`; `documentFetchState` table; `documentTypeEnum` gains `PRICE_BAND_AD`, `CORRIGENDUM`, `BASIS_OF_ALLOTMENT_AD`.
- `src/repositories/document-fetch-state-repository.ts` (new): row CRUD, `listForIpo`, `upsertState`, `markSuperseded`, audit queries. Extends `BaseRepository`.
- `package.json` (edit): exports-map entry for the new repository (per `shared-package-source-imports.md`, the file and the export land together).

**New — `web/drizzle/migrations`**
- `0035_add_document_fetch_state.sql`, hand-authored per `drizzle-migration-gated-ddl.md` (the journal is still blocked by the pre-existing `extraction_status` enum prompt, same as 0032/0033/0034), plus a `meta/_journal.json` entry at idx 18. Non-destructive: `CREATE TABLE IF NOT EXISTS` + `ALTER TYPE ... ADD VALUE IF NOT EXISTS`. It is neither `_gated/` (nothing destructive) nor `_repair/`.

**New — `scraper/src/services`**
- `document-types.ts` — the doc-type vocabulary and `DocSource` union shared by parser, classifier and state machine.
- `document-classifier.ts` — RC2. `classifyByTitle(title)` and `classifyBseField(field, url)`; `PROSPECTUS` only when the title/filename lacks `red herring` / `rhp` / `draft`; a bare `Security Parameters` maps to `SECURITY_PARAMS_PRE_ANCHOR`.
- `bse-party-parser.ts` — RC1. `parseBseParties(row)` returns `{ leadManagers[], registrar, sponsorBanks[] }`; splits on `#` first, then `^`, preserving order (BRLM first, then co-BRLMs).
- `bse-ipo-board.ts` — `parseBseBoard(json)` returns IPO_NO rows filtered to `IR_FLAG_FULL` in `{Book Building, Fixed Price}` (F12); `resolveIpoNo(board, companyName)` uses the shared normalizer plus similarity.
- `document-download-verifier.ts` — matrix §3 steps 1, 2, 5 plus an HTML sniff, the cover-page company-name check (step 4) and size caps (F20).
- `document-store.ts` — `PROSPECTUS_STORE_DIR`, temp-then-rename, zip unpack and removal, `PROSPECTUS_STORE_MAX_GB=5` refusal, `purgeIpoDocuments()` with `PROSPECTUS_RETENTION_DAYS=7`.
- `document-state-machine.ts` — **pure**: `dueDocTypesForStage`, `notApplicableTypes`, `nextState`, `computeNextRetryAt`, `planIpoCycle`, supersession ordered by `filing_date`.
- `document-discovery-runner.ts` — the live orchestrator (network + DB) implementing the §1 decision tree.

**New — `scraper/src/utils`**
- `network-counter.ts` — a process-scoped counter wrapping every outbound call this feature makes, so run 2's "zero calls" is *measured*, not asserted from reading code.

**New — `scraper/src/scripts`**
- `run-document-discovery.ts` — the acceptance-run CLI; writes `evidence/T-403/`.

**Edited**
- `scraper/src/services/primary-source-discovery.ts` — delegates to the classifier; BSE fieldMap yields the correct types; keeps its pure / no-network contract.
- `scraper/src/scheduler/stage-reconciler.ts` — `FetchKind` gains `docDrhp`, `docRhp`, `docPriceBandAd`, `docCorrigendum`, `docAnchorReport`, `docProspectus`; `STAGE_FETCHES` updated; `purgePdfs` added.
- `scraper/src/index.ts` — `triggerPrimarySourceDiscovery` becomes per-cycle and state-driven behind `ENABLE_DOCUMENT_STATE_MACHINE`; a new `documentPurge` step joins `STEP_NAMES`; one `scraper_logs` row with `source='DOCUMENTS'` per cycle.
- `scraper/src/config/feature-flags.ts` — `ENABLE_DOCUMENT_STATE_MACHINE`, default OFF, §GATE.
- `scraper/src/scrapers/bse-*.ts` — BRLM parsing re-pointed at `bse-party-parser.ts` (the RC1 sweep).
- `scripts/lib/document-state-checks.mjs` (new) and `scripts/audit-detection-floor.mjs` (edit) — the five nightly checks.

## 4. Storage and purge

`PROSPECTUS_STORE_DIR` (default `<shared>/prospectus/<slot>`) holds `<ipo_id>/<doc_type>-<sha8>.pdf`.
Files are written to `<name>.tmp-<pid>` and then renamed (atomic). Zips have their first `%PDF` member unpacked; the PDF is stored and the zip deleted. Writes are refused, with an alert, once the store exceeds `PROSPECTUS_STORE_MAX_GB` (5). `PURGE_PDFS` deletes `<ipo_id>/` when `close_date + PROSPECTUS_RETENTION_DAYS (7) < today`, or on withdrawal — **files only, rows stay** — emitting one log line per purged IPO.

## 5. Test list (all under `scraper/tests/unit/` per `scraper-test-layout.md`; fixtures in `tests/fixtures/documents/`)

`document-classifier.test.ts` — 1 RHP vs Prospectus (the Skyways trap); 2 draft to DRHP; 3 BSE `Price_Band_Advertisement` to `PRICE_BAND_AD`; 4 BSE `Corrigendum` to `CORRIGENDUM`; 5 BSE `Addendum` to `ADDENDUM`; 6 bare `Security Parameters ` to `PRE_ANCHOR` (F11, Madhur payload); 7 `(Post Anchor)` to post; 8 `Anchor Allocation Report` to anchor; 9 unknown title to null.

`bse-party-parser.test.ts` — 10 **Skyways real payload yields exactly 3 lead managers, in order** (F17); 11 emails and contacts preserved; 12 single BRLM with no co-BRLM; 13 empty/whitespace fields yield `[]`; 14 registrar single; 15 sponsor banks `#`-split into 2.

`bse-ipo-board.test.ts` — 16 real board drops the 9 non-IPO rows (F12); 17 `resolveIpoNo('Skyways Air Services Ltd.')` gives 7903; 18 `'Deepa Jewellers Ltd.'` gives 7922 (status F); 19 an SME name absent from the board gives null (F13); 20 a shape change (missing `Table`) throws, never a silent null (F18).

`primary-source-discovery.test.ts` (extended) — 21 **Skyways BSE core yields >=4 docs typed RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD**; 22 `Anchor_Details:""` yields no doc (F3); 23 the space-containing Addendum URL is encoded, not dropped; 24 NSE Skyways dataList yields 7 typed docs; 25 NSE Madhur yields PRE_ANCHOR from the bare title.

`document-download-verifier.test.ts` — 26 **BSE `Object Moved` HTML body is rejected** even at 200; 27 wrong content-type rejected; 28 under 50 KB rejected; 29 zip with no PDF rejected; 30 zip with a PDF accepted; 31 sha256 dedup gives one row and two URLs (E7/R2); 32 cover-page company mismatch rejected (F8); 33 over 150 MB refused (F20).

`document-state-machine.test.ts` — 34-46 are R1 through R13, one test each; 47 an empty `due` costs zero calls (§7.2); 48 `NOT_YET_FILED` is not a failure; 49 the `BLOCKED_ALL` retry ladder moves 30 min to 6 h at the 24 h mark; 50 supersession is ordered by `filing_date`, not fetch order (E1/E8); 51 the stage-to-due-type table (UPCOMING / PRE_OPEN / OPEN / CLOSED / LISTED); 52 a fixed-price SME marks PBA `NOT_APPLICABLE` (R9).

`document-store.test.ts` — 53 temp-then-rename leaves no `.tmp` behind; 54 zip unpacked then removed; 55 a store over 5 GB refuses and alerts; 56 purge deletes at close+8 and keeps close+6; 57 purge removes files and keeps rows.

`stage-reconciler.test.ts` (extended) — 58 document FetchKinds appear at the right stages; 59 `purgePdfs` becomes due after close+7.

`scripts/tests/document-audit-checks.test.mjs` — 60 `BLOCKED_ALL` older than 24 h FAILs; 61 `FOUND` unread for over 48 h FAILs; 62 an OPEN IPO with 0 state rows FAILs; 63 `EXTRACT_FAILED` WARNs; 64 a BRLM count below the BSE payload FAILs.

## 6. Acceptance run (`evidence/T-403/`)

`run-document-discovery.ts --ipos SKYWAYS,MADHURKNIT,ESDS,"Deepa Jewellers"` runs twice against `ipodhan_wpab`, writing per run: `state-table.json`, `attempts-<slug>.json`, `network-calls.json`.

Expected — run 1: Skyways gets >=4 docs (RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD) and 3 lead managers; Madhur gets RHP, ratios, params and anchor; **ESDS's anchor is `NOT_YET_FILED` with zero fallback calls** (BSE answered with an empty field, so F3 applies and there is no fall-through); Deepa is upcoming. Run 2: **`networkCalls == 0` for Skyways and Madhur.**

## 7. Order of work (one commit per item)

1. fixtures + this plan. 2. classifier, party parser, board (with tests). 3. schema, migration, repository. 4. verifier and store. 5. state machine (R1-R13). 6. runner and network counter. 7. stage-reconciler, `index.ts` wiring, flag. 8. audit checks. 9. acceptance run and evidence. 10. gates.

---

# 8. What was delivered, and what was NOT (written after the work, 2026-08-28)

## Delivered against the contract's `dod:` list

| DoD item | Status |
|---|---|
| BSE-first discovery: board -> IPO_NO -> core API, `IR_FLAG_FULL` filtered, all BRLM + `#`-separated co-BRLMs, links mapped to typed documents | DONE |
| NSE second with retry x3 backoff 2/4/8 s, `nsearchives` links, SME via `series=SME` | DONE |
| Classifier fix: PROSPECTUS only without "red herring"/"draft"; `PRICE_BAND_AD`, `CORRIGENDUM`, `BASIS_OF_ALLOTMENT_AD`; bare "Security Parameters" to PRE_ANCHOR; fixture tests on the real Skyways and MADHURKNIT payloads | DONE |
| Download verification: status + content-type + >50 KB, zip contains a PDF, sha256 dedup, cover-page company check, BSE "Object Moved" never stored | DONE |
| `document_fetch_state` table + the §7.1 transitions, §7.2 cycle behaviour, §7.3 retry policy, R1-R13 each with a fixture test | DONE |
| Storage: `PROSPECTUS_STORE_DIR/<ipo_id>/<doc_type>-<sha8>.pdf`, temp-then-rename, zips unpacked, `PROSPECTUS_STORE_MAX_GB` refusal, `PURGE_PDFS` at close + 7 days, files-only with a per-IPO log line | DONE |
| Logging: `last_attempt` json, step-ledger rows with counts in `reason`, one `scraper_logs` row per cycle at `source='DOCUMENTS'`, five nightly audit checks | DONE |
| Wiring behind `ENABLE_PRIMARY_SOURCE_DISCOVERY` + new `ENABLE_DOCUMENT_STATE_MACHINE` (default off) | DONE |
| Acceptance run for SKYWAYS / MADHURKNIT / ESDS / Deepa Jewellers with evidence files | DONE against the LIVE exchanges — but with an IN-MEMORY store, see below |
| Suites green, tsc clean | DONE |

## NOT delivered — stated plainly

1. **The database-backed acceptance run.** The dev database `ipodhan_wpab` was dropped mid-task when its host ran out of disk (owner-handled incident, 2026-08-28). The acceptance run therefore exercises every piece of logic against the real exchanges but substitutes `InMemoryDocumentFetchStateStore` for Postgres. **PENDING** until the host returns.
2. **Migration `0035` is authored but NOT APPLIED** anywhere, for the same reason. Nothing has verified that it applies cleanly, that `ON CONFLICT` hits the new unique constraint, or that the `ALTER TYPE ... ADD VALUE` statements run inside drizzle-kit's transaction. **PENDING.**
3. **The SEBI and company-host fallback rungs are not implemented.** Discovery stops at the two exchanges. The decision tree's rungs 3 and 4 (SEBI public-issues listing, the company investor page) and the Chittorgarh link-verifier are declared in the runner's header and left for a later WP. In practice both exchanges answered for all four acceptance IPOs, so nothing needed them — but a genuine `BLOCKED_ALL` today has fewer places to go than the matrix specifies.
4. **`decideSupersession`, `isStaleInProgress`, `markSuperseded` and `repointToSurvivor` are implemented and unit-tested but NOT called.** They need `filing_date` (read off the document) and an extraction claim, neither of which exists until WP C. Each is marked `NOT YET WIRED` in its own doc comment so it does not read as live code.
5. **A `documents` lineage table does not exist.** "Same hash = one row, two URLs" is honoured by storing one file and recording the alternative URL in the attempt log; a second URL column/table is not added.
6. **One residual F2 gap:** NSE is consulted only when BSE left a due type without a link, so in the rare cycle where BSE covers everything due and one of those downloads then fails, there is no second copy in hand. The 30-minute retry ladder covers it; noted in the runner's header.

## Contract expectation that turned out to be factually wrong

The DoD expected ESDS's anchor report to be `NOT_YET_FILED` with zero fallback calls. ESDS opens 28 Aug, so its anchor round was 27 Aug and NSE was already serving `ANCHOR_ESDS.zip`. The underlying behaviour (F3: an exchange answering with no link yields `NOT_YET_FILED`, never a failure, with no fall-through) is verified on the types ESDS genuinely has not filed. See `evidence/T-403/README.md`.

---

# 9. Round-1 review response (2026-08-28)

## Fixed, each with the test that proves it

| Item | Fix | Test |
|---|---|---|
| B1 | `ipos` writes routed through `data-persister.recordBseDiscoveryMetadata`; ratchet baseline NOT widened | `bse-discovery-metadata-write-path.test.ts` (5) — incl. running the REAL ratchet as a subprocess |
| M1 | `pdf-cover-text.ts` wired into the runner; the cover check actually runs; skips are visible | `pdf-cover-text.test.ts` (5), `document-discovery-runner-download.test.ts` M1 (3) |
| M2 | `deriveIssueShape` populates `DiscoveryIpo.issue`, so R9 is reachable | `document-cycle-issue-shape.test.ts` M2 (5) |
| M3 | Withdrawal closes open rows as `NOT_APPLICABLE` once, then skips | `document-cycle-issue-shape.test.ts` M3 (4), F15 cases in `document-state-machine.test.ts` (2) |
| M4 | `DOWNLOAD_TIMEOUT_MS` asserted; F2 fallback + on-demand NSE rescue | `document-discovery-runner-download.test.ts` M4a/M4b/M4c (3) |
| M5 | `toPre0035DocumentType` guards the flag-OFF path; flag and index comments corrected | `pre-0035-document-types.test.ts` (6) |
| M6 | `upsertDocument` re-types along a closed allowlist; re-type script; `m_document_type_classifier` check | `document-retype.test.ts` (9), audit self-tests 65a-e (5) |
| M7 | `decidePurge` three arms + 30-day hard cap; `demoteMissingFiles` | `document-purge-policy.test.ts` (14) |
| M8 | Repository integration tests written | `tests/integration/document-fetch-state-repository.integration.test.ts` (8) — **NOT RUN**, see below |
| V1-V3 | README corrected to the machine numbers, real file names, Deepa's real result | evidence README |
| V4 | `--db` implemented | — (not exercised; no DB) |
| V5 | A8 fails instead of passing vacuously under `--no-download` | harness |
| V6 | Full sha256 in the attempt log | `FetchAttempt.sha256` |
| V7 | `--evidence-dir`, timestamped default | harness |
| V8 | Member/type disagreement recorded, not "corrected" | verifier `memberTypeMismatch` |
| N1-N9, T1-T3 | see the round-1 minors commit | `document-store.test.ts` N5, `bse-api-scraper.test.ts` T2, reconciler tests N6 |

## Two further defects the round-1 re-runs caught

1. **BSE had no retry while NSE had three**, and the **board** call had none even after the core call got one. A single transport failure lost the whole BSE payload for an IPO — every BSE-only type and all three lead managers — or, on the board, the whole cycle's BSE coverage. Both now use the same 2/4/8 s ladder.
2. **A failed exchange was being reported as `NOT_YET_FILED`.** Because NSE had answered, BSE-only types were recorded as "the company has not filed it" — a claim with no evidence, which suppresses both the retry ladder and the alert. `NOT_YET_FILED` now requires that **every** consulted exchange answered; `not_on_board` / `no_symbol` still do not count as failures (F13).

## Still NOT done — unchanged from §8 unless noted

1. **M8 tests are written but have never been run.** The permitted credentials (`ipodhan_app`) are refused DDL on `ipodhan_test`: `permission denied for schema public` for `CREATE TABLE`/`CREATE TYPE`, and `permission denied for database ipodhan_test` for drizzle-kit's `CREATE SCHEMA drizzle`. Neither `push` nor `migrate` can run, so the schema cannot be brought up. Granting `CREATE ON SCHEMA public` (and on the database) to that role unblocks both the tests and `--db`.
2. **Migration 0035 is still unapplied anywhere.** Same cause.
3. **G1 (SEBI rung) and G2 (company-host rung) are NOT implemented.** Discovery still stops at the two exchanges. These are new source integrations — a SEBI public-issues listing parser and a per-company investor-page resolver — not adjustments to existing code, and they were not attempted in this round.
4. **G3 is done**: `ipos.bse_ipo_no` is persisted through the sanctioned write path (B1), so discovery no longer depends on the board still listing a closed IPO.
5. `decideSupersession`, `isStaleInProgress`, `markSuperseded`, `repointToSurvivor` remain implemented, tested and **NOT WIRED** — each is marked as such in its own doc comment. They need `filing_date` and an extraction claim, both of which arrive with WP C.
6. No `documents` lineage table; the alternative URL lives in the attempt log.
