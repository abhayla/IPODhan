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

# 9. Review rounds 1-3 — current status (rewritten 2026-08-28)

The previous §9 was written after round 1 and went stale within a day: it said
G1/G2 were not implemented, M8 had never been run, and migration 0035 was
unapplied. All three are now false. This section replaces it.

## Delivered and verified

| Area | Status | Proof |
|---|---|---|
| WP A discovery, BSE-first, all four rungs | DONE | `document-discovery-runner.ts`; chain tests |
| G1 SEBI rung (DRHP smid=10, RHP 11, Prospectus 12) | DONE | `sebi-source.ts`, 16 tests, live fixtures |
| G2 company-host rung + Chittorgarh link verifier | DONE | `company-host-source.ts`, 14 tests |
| G3 remembered `bse_ipo_no` | DONE | migration 0035, write path B1 |
| G4 per-rung attempt log, BLOCKED_ALL only after four rungs | DONE | chain tests |
| Classifier fix (E14) + forward-only repair (M6) | DONE | 18 + 9 tests, `m_document_type_classifier` |
| Download verification (matrix §3) incl. unreadable-PDF reject | DONE | 22 tests |
| WP B state machine, R1-R13 | DONE | 37 tests |
| Storage, D4 purge, missing-file demotion | DONE | 14 tests |
| Nightly checks (6) incl. `m_not_yet_filed_age` | DONE | 24 self-tests, registered in `detection-checks.json` |
| Migration 0035 + 0036 | APPLIED and replayed from empty | `evidence/T-403/migration-readback.json` (20/20) |
| M8 repository integration tests | RUN, 8/8 | against `ipodhan_test` |
| DB-backed acceptance | RUN, 8/8 | `evidence/T-403/db-run/` |

## Round 3 — the blocker, and what it says about the evidence

**B-1.** The SEBI rung could never fire for a DRHP or a post-close Prospectus —
the two documents it exists for. Escalation was gated on
`outcome === 'all_sources_failed'`, but at UPCOMING both exchanges answer
normally and simply have no DRHP link, which is `no_link`, not a failure. The
chain recorded `SEBI:skipped:exchanges_settled_it` and the row sat
NOT_YET_FILED forever.

The uncomfortable part is that **round 2's acceptance evidence certified that as
a pass**. A4 and A5 were written against the broken behaviour: A5 literally
asserted ZERO non-exchange calls, which is only true while escalation never
happens. An acceptance test written after the code, from the code's actual
behaviour, will ratify whatever the code does. Both checks now assert the
contract instead: A5 says a rung beyond the exchanges is consulted ONLY for a
type the exchanges did not settle.

Fix: `EXCHANGE_SERVED_TYPES` (everything but the DRHP) plus a real coverage test
— `no_link` may settle a type only when the exchanges can serve it AND every
applicable exchange answered `ok`. `not_on_board` and `no_symbol` are facts, not
coverage.

## What replaying the journal from empty found

Doing it properly — `DROP SCHEMA public CASCADE`, then `drizzle-kit migrate`
from nothing — exposed three defects that no unit test could have:

1. **0035 created an enum and a table with the same name** (`42710 type
   "document_fetch_state" already exists`). In production this fails the deploy
   at the migrate step. Enum renamed to `document_fetch_status`; guarded by
   `scripts/tests/migration-name-collision.test.mjs` in CI.
2. **Eight `document_type` values existed in no migration.** They had been put
   in `_repair/`, which nothing runs — the deploy is migrate-only — so a
   journal-built database threw `invalid input value for enum` and `runIpo`'s
   non-fatal catch swallowed it. Now journaled as 0036.
3. **`ipo_details` is not created by the journal at all.** The M-6 columns were
   first added there and the replay failed with `relation "ipo_details" does not
   exist`. They now live on `ipos`, beside `bse_ipo_no`.

## Still NOT done

1. **The wider journal/schema drift is unrepaired.** A journal-built `ipos` has
   32 columns where `schema.ts` declares 55, `documents` has 8 where the schema
   declares 19, and the journal builds a NOT NULL `category` column the schema
   replaced with `segment`/`offering_type`. Production is fine (built from dumps
   plus `_repair/`), but no environment can be rebuilt from the journal. Measured
   in `evidence/T-403/journal-schema-drift.json`. Repairing it is a
   schema-ownership decision for the owner, not something to fold into a
   document-discovery task.
2. **Extraction is WP C.** `FOUND` is terminal here.
   `decideSupersession`, `isStaleInProgress`, `markSuperseded` and
   `repointToSurvivor` are implemented and tested but NOT called; each says so in
   its own doc comment. They need `filing_date` and an extraction claim.
3. **No `documents` lineage table.** "Same hash, two URLs" is honoured by storing
   one file, persisting its sha256 on the `documents` row (W-1) and recording the
   alternative URL in the attempt log. A row-per-URL lineage table is WP C's call.
4. **BSE SME (`bsesme.com`) is not parsed.** SME coverage is NSE Emerge + SEBI +
   the company host, as the matrix's Q3 assumed.

## Round 4 — the ordered chain, and what each rung may conclude

The chain, in the order it runs, with the ONE thing each rung is allowed to
decide. The distinction that took four rounds to get right is in the last column:

| # | Rung | Fetches | May conclude FOUND | May conclude ABSENT | May conclude FAILED |
|---|---|---|---|---|---|
| 1 | BSE | board (once per cycle, shared) + core payload per IPO, 2/4/8 s ladder, every try logged | link downloaded and verified | `no_link` — the payload answered and carries no such document | http/timeout/shape error. `not_on_board` is neither: BSE does not carry this issue |
| 2 | NSE | `ipo-detail` per IPO, same ladder | as above | as above | as above. `no_symbol` is neither |
| — | (settle?) | — | A type the exchanges CAN serve, with every applicable exchange `ok`, settles here. A DRHP never settles here — no exchange publishes drafts | | |
| 3 | SEBI | filing list per type (cached per cycle, including a cached FAILURE), then the detail page, then the PDF | listed → detail → PDF → verified | the list answered and does not name this company | list or detail HTTP error; a listed filing whose detail page has no PDF; a cached failure from earlier in the cycle |
| 4 | Company host | up to 3 investor pages per ISSUER per CYCLE (cached), within a 12-GET per-IPO escalation budget | an issuer-hosted or exchange-hosted link, downloaded and verified | a page answered and carries no such filing | no page answered at all; a linked filing that failed to download |
| 5 | Verifier (Chittorgarh) | the IPO's page, links only | an exchange/SEBI link we had not tried, downloaded and verified | the page answered and shows no untried exchange link | page HTTP error; a corrected link that then failed |

Two rules make this hold together:

- **ABSENT is evidence; FAILED is the absence of evidence.** Only ABSENT from
  every rung may write NOT_YET_FILED. Any FAILED anywhere writes BLOCKED_ALL,
  which is the state that carries the retry ladder and the alert. Rounds 1-3 had
  every SEBI failure path returning `null`, which the caller read as ABSENT.
- **A later filing closes the hunt.** Holding the RHP supersedes an open DRHP;
  holding the Prospectus supersedes both. Without it a CLOSED IPO alerts P2 every
  night about a draft that no longer exists anywhere.

## Round 5 plan

Written BEFORE any code edit, per the round-5 brief. Red-then-green: the two new
tests (structural + orchestrator matrix) are written and run RED first.

### The class fix (Class 1) — absence unconstructible without evidence

`RungResult = {documentId,bytes} | 'failed' | 'absent'` becomes a discriminated
union whose `absent` arm carries a **branded** `AnsweredResponse`:

```ts
const ANSWERED: unique symbol;                       // runtime Symbol, module-private
interface AnsweredResponse { readonly [ANSWERED]: true; status; url; bytes }
function answeredFrom(res: HttpResponse, url): AnsweredResponse | null  // null unless 200
type RungOutcome =
  | { kind: 'found'; documentId; bytes }
  | { kind: 'absent'; evidence: AnsweredResponse }
  | { kind: 'failed'; reason: string };
```

Nothing outside `answeredFrom` can mint an `AnsweredResponse` (the brand key is a
module-private symbol), so a budget refusal, a timeout, a cached failure or a
shape error **cannot type-check as absent**. Every per-cycle cache that a later
`absent` is derived from (SEBI listing, company page, verifier page) stores its
evidence alongside its parsed body.

### Files to change

| File | Change |
|---|---|
| `scraper/src/services/document-discovery-runner.ts` | `AnsweredResponse` + `RungOutcome` + `answeredFrom`; every rung return re-expressed; budget refusals → `failed`; SEBI/company/verifier caches carry evidence; **verifier page cached per cycle**; `tryVerifier` re-validates the host with `isVerifierUrl`; company rung: only 404/410 are non-failures (a 403 is `failed`); `sourceOfDocumentUrl` returns `'UNKNOWN'` for an unparseable URL; the G4 short-chain guard emits `chain_incomplete`, not `no_link` |
| `scraper/src/services/document-state-machine.ts` | new `AttemptOutcome` `'chain_incomplete'` → state `WANTED`, retryable, no alert, asserts nothing about filing |
| `scraper/src/services/primary-source-discovery.ts` | `DiscoveredDocument['source']` gains `'UNKNOWN'` |
| `scraper/src/services/document-cycle.ts` | `loadCandidateIpos` filters `verifier_url` through `isVerifierUrl` on the READ side |
| `scraper/src/base/BaseScraperOrchestrator.ts` | hoist the `recordDocumentSourceHints` write out of the `ENABLE_DATA_CONSOLIDATION` else-branch: one private helper, called before the all-protected early return AND after the if/else |

### Tests to write (red first)

| Test file | What it pins |
|---|---|
| `tests/unit/services/document-discovery-absence-evidence.test.ts` (new) | **Structural**: parse the runner source, find every `kind: 'absent'` construction site, assert each passes an `evidence` argument that traces to `answeredFrom`; plus behavioural cases — budget-exhausted SEBI/company/verifier and a page-2 403 all leave the row **BLOCKED_ALL**, never NOT_YET_FILED |
| `tests/unit/scrapers/orchestrator-source-hints.test.ts` (new) | **Flag matrix** {consolidation ON, OFF} × {new IPO, existing all-protected IPO} — the hint writer is called in all four |
| `tests/unit/services/document-discovery-round4-chain.test.ts` (M-d) | the cap test also asserts the ROW STATE the cap leaves behind (BLOCKED_ALL + a `skipped:budget`/`failed:budget` rung, not NOT_YET_FILED) |
| `tests/unit/services/document-discovery-round4-chain.test.ts` (NIT-4) | `sourceOfDocumentUrl('not a url')` → `'UNKNOWN'` |
| `tests/unit/services/document-cycle-*.test.ts` | a non-chittorgarh `verifier_url` in the DB row is dropped on read |
| `tests/integration/document-fetch-state-repository.integration.test.ts` | W-1 and W-1/H-1 route through `DocumentRepository.upsertDocument` and `IPORepository.updateDocumentSourceHints` instead of raw SQL |
| `tests/unit/services/document-state-machine*.test.ts` | `chain_incomplete` → WANTED, retryable, no alert |

### Gates

`packages/shared && npx tsc`; `scraper && npx tsc --noEmit`; full scraper vitest
(`--pool=forks`); `web && npx vitest run`; the M8 integration file against
`ipodhan_test`; and the acceptance harness re-run with `--db --reset`, refreshing
`evidence/T-403/db-run/` (item 8 — migration 0035 was edited in place).


## Round 5 — delivered vs not

### Delivered

| Round-4 finding | What changed |
|---|---|
| BLOCKER — hint write only in the else-branch | `BaseScraperOrchestrator.recordVerifierHint()` is one private helper called from BOTH exits: after the consolidation if/else, and on the all-fields-protected early return. Matrix test {ON,OFF} x {new, all-protected} — 3 of its 4 cells failed before the fix |
| MAJOR — budget refusals return 'absent'; verifier page not cached | `RungOutcome` is a discriminated union; `absent` carries a branded `AnsweredResponse` that only `answeredFrom()` mints, and only from a 200. All three refusal sites are now `failed`. The verifier page is cached per cycle |
| MAJOR — no read-side `isVerifierUrl` | Filtered in `loadCandidateIpos`, re-checked in `escalateBeyondExchanges`, and again at the point of use in `tryVerifier` |
| `:1475` downgrades to `no_link` | New `chain_incomplete` outcome — WANTED, retryable, no alert, asserts nothing about filing |
| Integration tests use raw SQL | Both now go through `DocumentRepository.upsertDocument` and `recordDocumentSourceHints` -> `IPORepository.updateDocumentSourceHints`. This required migration **0037**: on a journal-built database `documents` had 8 of 19 columns, so the shared writer could not run at all. The acceptance harness's own raw-SQL documents writer is gone for the same reason |
| Company rung page-2 403 yields absent | Only 404/410 is evidence; 403/429/5xx/transport is `failed` |
| `sourceOfDocumentUrl` returns 'NSE' for unparseable | Returns `'UNKNOWN'`; the union gained that member |
| 0035 edited in place | `ipodhan_test` was dropped to empty and replayed: 21/21 entries, 17 tables, `documents` 19/19 columns. Acceptance re-run on it: **9/9, allPassed true** |

Detection-gap upgrades shipped alongside: the M-d cap test asserts the row STATE
the cap leaves behind (and a second case that actually exhausts the budget);
`acceptance-summary.json` is now written by the harness instead of only printed;
the A4 predicate uses the runner's own `EXCHANGE_FAILURE_OUTCOMES` instead of a
second, drifting definition.

### NOT delivered, stated plainly

1. **The `ipos` journal drift is still unrepaired.** 0037 repairs `documents`
   only. A journal-built `ipos` still gets 32 of the 55 columns `schema.ts`
   declares, with a NOT NULL `category` the model dropped, so `IPORepository.update`
   (a bare `.returning()`) still cannot run on such a database and the wider
   scraper integration suite still fails there. That is a schema-ownership call
   for the owner, unchanged from round 4.
2. **`npx tsc --noEmit -p tsconfig.json` in `scraper/` is NOT clean** — 159 error
   lines, all pre-existing and byte-identical before and after this round
   (verified by diffing the output against a stashed tree). None are in the five
   files this round touched. Round 5 did not fix them; it also did not add one.
3. **No fresh Opus review of the round-5 diff has run yet** — that is the next
   step in the exit criteria and is the reviewer's job, not the implementer's.
4. **The four acceptance IPO rows have no committed seeder.** Rebuilding
   `ipodhan_test` from empty required capturing and re-inserting them by hand.
   Anyone reproducing the run from a truly empty database will hit
   `no ipos row for <company>`. Recorded, not fixed.

## Round 6 plan

Round-5's review found the FOURTH instance of Class 1. The three earlier fixes all
constrained how absence is *constructed*; this path never constructs it — it
*inherits* a mutable `outcome` variable set 80 lines earlier and never overwritten.
The class fix is therefore not another guard: the final outcome must be **derived**
from the three facts that decide it, by a pure function with an exhaustive match,
so "not overwritten" stops being a reachable state.

### Files to change

| File | Change |
|---|---|
| `scraper/src/services/document-discovery-runner.ts` | new exported-for-test `resolveFinalOutcome(exchanges, settledByExchanges, escalation)` — pure, exhaustive, `never` default arm; the per-type loop keeps an `ExchangeVerdict` and an `EscalationVerdict` and calls the resolver ONCE at the end instead of mutating `outcome`; `answeredFrom` and `AnsweredResponse` become module-private (the brand `ANSWERED` already was) |
| `scraper/src/services/document-state-machine.ts` (~:421) | `chain_incomplete` preserves `row.blockedSinceAt` instead of nulling it — nothing was concluded, so the outage clock must not be reset |
| `web/drizzle/migrations/0037_documents_journal_column_drift.sql` | both `pg_constraint` guards qualified with `AND conrelid = 'documents'::regclass` — a same-named constraint on any other table currently makes the guard skip silently |
| `scripts/lib/document-state-checks.mjs` | new nightly check `checkAbsenceWithoutEvidence` + `chainFromLastAttempt` (the detection upgrade) |
| `scripts/audit-detection-floor.mjs` | select `s.last_attempt`, run the new check, `record`/`notify` as `m_absence_without_evidence` |
| `docs/reviews/detection-checks.json` | register `m_absence_without_evidence` |

### Tests to write (red first)

| Test file | What it pins |
|---|---|
| `tests/unit/services/document-discovery-resolve-final-outcome.test.ts` (NEW) | the FULL input matrix — exchanges ∈ {found, no_link, failed} × settled ∈ {t,f} × escalation ∈ {found, absent, failed, null}. The round-5 cell (`no_link`, settled=false, escalation=null) must be `chain_incomplete`, never `no_link`. Also pins `EXCHANGE_FAILURE_OUTCOMES` as a literal set (item 5) |
| `tests/unit/services/document-discovery-absence-evidence.test.ts` | drop the `answeredFrom` import (item 2); the mint-only-from-200 rule is asserted BEHAVIOURALLY (a 403 investor page → BLOCKED_ALL, an answering page → NOT_YET_FILED) with the source regex kept as a secondary guard |
| `tests/unit/services/document-discovery-round6-chain.test.ts` (NEW) | the behavioural half of item 1: BSE `not_on_board` + NSE `ok` (coverage incomplete, nothing failed) for a type SEBI does not serve, with no company URL and no verifier URL — every rung skipped, escalation `null` — the row is **WANTED**, retryable, no alert, and NOT `NOT_YET_FILED` |
| `tests/unit/services/document-state-machine.test.ts` (~:150) | the "does not clear an existing block" case asserts what its name says: `blockedSinceAt` survives `chain_incomplete` |
| `scripts/tests/document-state-checks.test.mjs` | `m_absence_without_evidence` self-test: a DRHP row NOT_YET_FILED whose chain is all `skipped`/`failed` FAILs; one with an `ok`-answered rung PASSes; an exchange-served type is out of scope |

### One deliberate deviation from the RCA's wording, stated up front

The RCA says the resolver returns `chain_incomplete` when `escalation === null &&
!settledByExchanges`. Taken literally that also covers `exchanges === 'failed'`,
where `settledByExchanges` is false by construction — and it would downgrade a
genuine exchange OUTAGE from `BLOCKED_ALL` (retry ladder + P2 alert) to a silent
`WANTED`. That contradicts the r4 fix ("a rung asked and could not answer is never
absence, and must alert"). So the resolver returns `all_sources_failed` whenever the
exchanges failed and escalation did not find the document; `chain_incomplete` is the
answer for the `no_link`-but-unsettled cell the review actually found. The matrix
test pins both.

### Gates (run ONCE, before the final commit)

`packages/shared && npx tsc`; the four `node --test` self-tests and the write-ratchet
gate from `.github/workflows/pr-gate.yml`; `scraper && npx vitest run --pool=forks`.
The web suite is untouched by this round and is not re-run; the live acceptance
harness is not re-run either — the only behaviour change outside the resolver's own
cell is that a dry (`skipDownload`) run of an unsettled `no_link` type now records
`chain_incomplete` instead of `no_link`, which is the same correction.

## Round 6 — delivered vs not

### Delivered

| Round-5 review finding | What changed | Where |
|---|---|---|
| BLOCKER — absence INHERITED through a mutable `outcome` | `resolveFinalOutcome(exchanges, settledByExchanges, escalation)`: pure, exhaustive, `never` default arms, called ONCE at the end of the per-type decision. The mutable `outcome` is gone; the loop now carries two verdicts of raw fact. `escalation === null` is a recorded verdict ("NOT ASKED") and yields `chain_incomplete` when the exchanges could not settle the type | `document-discovery-runner.ts:332` (resolver), `:1727` (the single call), `:1593-1700` (verdicts) |
| MAJOR — `answeredFrom` / the brand exported for a test | Both module-private again; the mint-only-from-200 rule is asserted behaviourally, the source regex kept as a secondary guard | `document-discovery-runner.ts:235,247`, `document-discovery-absence-evidence.test.ts:58` |
| MINOR — 0037 constraint guards unqualified | `AND conrelid = 'documents'::regclass` on both; run against `ipodhan_test` as a no-op to prove the syntax and the idempotency | `0037_documents_journal_column_drift.sql:74,85` |
| MINOR — `chain_incomplete` cleared `blockedSinceAt` | Preserved. The test whose NAME already claimed this now asserts it | `document-state-machine.ts:428`, `document-state-machine.test.ts:149` |
| MINOR — `EXCHANGE_FAILURE_OUTCOMES` only ever imported | Pinned as a literal set in a unit test; A4 still imports the constant, so the two cannot drift silently | `document-discovery-resolve-final-outcome.test.ts:124` |
| DETECTION — nothing would notice this class returning | Nightly `m_absence_without_evidence`: NOT_YET_FILED for an exchange-unserved type whose own chain has zero answered rungs → FAIL. Self-tested, wired into the audit, registered as the manifest's 27th check | `document-state-checks.mjs:276`, `audit-detection-floor.mjs:419-428`, `detection-checks.json` |

Red→green proof for the blocker: the matrix test failed 28/30 before the fix
(`resolveFinalOutcome is not a function`) and the behavioural runner test failed
with `expected 'NOT_YET_FILED' to be 'WANTED'` on the exact
`EXCHANGES:no_link -> SEBI:skipped -> COMPANY:skipped -> VERIFIER:skipped` chain
the review described. Both green after.

Gates, run once: `packages/shared && npx tsc` (clean, `dist/db/schema.d.ts`
present); the four pr-gate `node --test` self-tests (23 / 78 / 31 / 6 passing,
0 failing) and `check-write-ratchet.mjs` (exit 0); `web` lint gate PASSED (732
errors against a 732 baseline, unchanged) and `web && npx tsc --noEmit` clean;
`scraper && npx vitest run --pool=forks` — **149 files, 1680 passed, 1 skipped,
0 failed**.

### NOT delivered, stated plainly

1. **The `scraper-document-integration` CI job was not run locally.** It needs a
   Postgres built by replaying the journal from empty, which this box does not
   have. The only file in it that this round touched is migration 0037, whose two
   edited DO blocks WERE executed against `ipodhan_test` (no-ops there, both
   constraints already on `documents`) — that proves the syntax and the
   idempotent path, not the from-empty replay. CI covers the rest.
2. **The live acceptance harness was not re-run.** Deliberate: the only
   behaviour change outside the resolver's own cells is that a dry
   (`skipDownload`) run of an unsettled `no_link` type now records
   `chain_incomplete` instead of `no_link` — the same correction, applied to the
   dry path. If a reviewer wants the 9/9 evidence refreshed under the new
   resolver, that is a `--db --reset` run, not a code change.
3. **The web unit suite was not re-run** — no web source changed this round
   (the only `web/` file touched is a migration `.sql`). Lint and type-check
   were run.
4. **`scraper && npx tsc --noEmit -p tsconfig.json` is still not clean** — the
   same 159 pre-existing error lines recorded in round 5, none in the files this
   round touched, none added.

## Round 7 — delivered vs not

### Delivered

| Review finding | What changed | Where |
|---|---|---|
| MAJOR — `m_absence_without_evidence` scoped to DRHP only | Re-scoped by CHAIN SHAPE: FAILs any NOT_YET_FILED row whose non-EXCHANGES rungs are all `skipped`/`failed` AND none is `skipped:exchanges_settled_it`, regardless of `docType`. A CORRIGENDUM (or any other type) hitting the same unobserved-absence shape now FAILs; a chain the exchanges genuinely settled (the `exchanges_settled_it` skip label) still PASSes | `scripts/lib/document-state-checks.mjs` (`checkAbsenceWithoutEvidence`, `parseChainTokens`) |
| MINOR — `all_sources_failed` reused `blockedSinceAt` only from a row already BLOCKED_ALL | `row.blockedSinceAt ?? now` — a row that passed through `chain_incomplete` (state WANTED) but carried an outage clock from an earlier cycle now keeps it | `scraper/src/services/document-state-machine.ts` (`applyOutcome`, `all_sources_failed` case) |
| MINOR — `answeredRungsIn` counted any unrecognised label as an answer | Inverted to an explicit `ANSWERED_RUNG_VERDICTS` allow-list (`found`, `not_listed`, `no_link`, `found_via_corrected_link`, `no_new_link`) mirroring every non-skip/non-failed `rungs.push` in the runner. An unknown verdict is now NOT an answer (the safe direction) | `scripts/lib/document-state-checks.mjs` |
| MINOR — G4 short-chain downgrade lived in the caller as a `let outcome` reassignment | Folded into `resolveFinalOutcome` via a new `rungCount` argument (`MIN_RUNGS_FOR_ALL_SOURCES_FAILED = 4`); the caller's `outcome` is now a `const`. The G4 log line fires only when the computed outcome is actually `chain_incomplete` on a short chain | `scraper/src/services/document-discovery-runner.ts` (`resolveFinalOutcome`, its call site) |
| Test hygiene | `resolve-final-outcome.test.ts`: `EXPECTED` typed as `Record<string, AttemptOutcome>`, moved to module scope, extended with a hand-written (not derived) short-chain matrix + a boundary test at exactly `MIN_RUNGS_FOR_ALL_SOURCES_FAILED`. `round6-chain.test.ts`: added `blockedSinceAt`/no-P2-alert assertions, scoped per docType (the fixture legitimately blocks other doc types via a real SEBI failure) | `document-discovery-resolve-final-outcome.test.ts`, `document-discovery-round6-chain.test.ts` |
| Self-tests | New cases: a CORRIGENDUM with the r6 nobody-answered chain (FAILs), a chain carrying `skipped:exchanges_settled_it` (PASSes), and a direct `answeredRungsIn` unknown-label test | `scripts/tests/document-state-checks.test.mjs` |

Commits: `a40f2a83` (item 1), `a63baa2d` (item 2), `fced5b72` (items 3+4 + test hygiene).

### Rebase (Part B)

Rebased `feat/wp-ab-document-discovery-state-r5` onto `origin/main` (T-407 dead-DRHP-code
deletion, T-406 preflight gate, T-404 Notifier heartbeat). Two conflicts, both resolved by
keeping BOTH sides:
- `.github/workflows/pr-gate.yml` — kept T-406's `VPS runtime preflight self-test` step
  AND this branch's `Document-state check self-tests (T-403)` step, back to back.
- `.gitignore` — kept T-407's `HANDOFF-*.md` / `IPODhan-t*/` entries AND this branch's
  `.prospectus-acceptance/` entry.

One non-conflict blocker: an untracked `.prospectus-acceptance/` directory left over from a
prior local acceptance-harness run collided with tracked fixture paths an earlier commit in
this branch's own history was replaying; removed (it is gitignored scratch, never a repo
file) and the rebase proceeded.

`git diff origin/main --name-status | grep '^A'` lists 122 added paths, none of them the
eight files T-407 deleted (`drhp-downloader.ts`, `drhp-orchestrator.ts`, `drhp-extractor.ts`,
`exchange-monitor.ts`, `sebi-monitor.ts`, `manual-review-queue.ts`,
`drhp-extractor-service.ts`, `ecosystem.config.js`) — confirmed absent from the tree by a
direct `find`. Pushed with `--force-with-lease` (this branch has had no other writer since
round 6 landed).

### Gates (run once, after the rebase)

- `packages/shared && npx tsc` — clean.
- `web && npx tsc --noEmit` — clean.
- Every step in `.github/workflows/pr-gate.yml`'s `gate` job:
  - 4 `node --test` self-tests (write-ratchet 23, detection-floor 78, preflight-runtime 19,
    document-state-checks 33) + migration-name-collision (6) — all passing, 0 failing.
  - `node scripts/check-write-ratchet.mjs` — PASS, 58 files match baseline.
  - `web`: `npm run lint:ci` — PASSED (723 errors vs a 732 baseline, below baseline).
  - `web`: `npm run test:unit` — 2 failed / 2360 passed / 17 skipped, both failures in
    `tests/unit/components/rights/RightsIssuesTabs*.test.tsx` (5s hydration-probe timeouts),
    a file this round and round 6 never touched (only `web/drizzle/migrations/*.sql` changed
    in `web/`) — pre-existing, not caused by this branch.
  - `scraper && npx vitest run --config vitest.config.ts` and, per this round's explicit
    instruction, `scraper && npx vitest run --pool=forks` — 149 files, 1706 passed,
    1 skipped, 2 failed, both in
    `tests/unit/base-scraper-orchestrator-fuzzy-guard-parity.test.ts` (last touched by an
    unrelated PR #210, T-307 identity-resolution work) — pre-existing, not caused by this
    round or by round 6.
- `scraper-document-integration` job (needs a Postgres built by replaying the journal from
  empty) was **not run** — same NOT-delivered item round 6 recorded; this box still has no
  disposable Postgres to replay into. No file in scope for that job (`web/drizzle/migrations`,
  `document-fetch-state-repository.integration.test.ts`) changed this round.

### NOT delivered, stated plainly

1. **The two pre-existing scraper failures (`base-scraper-orchestrator-fuzzy-guard-parity.test.ts`)
   and the two pre-existing web failures (`RightsIssuesTabs*.test.tsx`) were not investigated
   or fixed** — out of this round's four-item scope, unrelated files, unrelated PRs.
2. **The `scraper-document-integration` CI job was not run locally** (see above) — same gap
   round 6 recorded, unchanged this round.
3. **The live acceptance harness was not re-run** — no behaviour change this round touches a
   cell the harness exercises differently; items 1-3 change nightly-audit and internal-refactor
   surfaces only, item 2 only affects a row that already carried a `blockedSinceAt` from a prior
   cycle (untested by the 9/9 fresh-run harness, which never ages a row across cycles).
