# T-403 acceptance evidence — WP A+B document discovery + state machine

Produced by `scraper/scripts/run-document-discovery.ts`, run twice against the
**live** BSE and NSE APIs on 2026-08-28, after the round-1 review fixes. Every
number below is copied from the machine output in this directory — not from memory.

## Honest limits of this run — read first

**The database-backed acceptance run has NOT been performed.** The dev database
`ipodhan_wpab` was dropped mid-task when its host ran out of disk. The permitted
fallback, the existing `ipodhan_test`, is unusable for this: the only credentials
this task may use (`ipodhan_app`) are refused DDL there —

```
CREATE TABLE / CREATE TYPE  ->  permission denied for schema public
drizzle-kit migrate         ->  permission denied for database ipodhan_test
                                (it cannot create its own `drizzle` schema)
```

so the schema cannot be brought up and neither `drizzle-kit push` nor `migrate`
can run. This run therefore uses `InMemoryDocumentFetchStateStore`.

| Exercised by this run | NOT exercised |
|---|---|
| BSE board + core API parsing, IPO_NO resolution and retry | `DocumentFetchStateRepository`'s SQL |
| NSE `ipo-detail` (EQ and SME), retry ladder | the `(ipo_id, doc_type)` unique constraint and its `ON CONFLICT` upsert |
| The classifier, on real payloads | migration `0035` applying cleanly |
| Real downloads, verification, zip-member selection, cover-page check | `ipos.bse_ipo_no` / `bse_payload_lead_manager_count` writes |
| The state transitions and the zero-call property | `scraper_logs` `source='DOCUMENTS'` row |
| The network accounting | the nightly audit against real tables |

Everything on the left is the same code that runs in production, against the same
live hosts. The right column is a real gap. `scraper/tests/integration/document-fetch-state-repository.integration.test.ts`
covers it and runs unchanged the moment a role with `CREATE ON SCHEMA public` is
available; `--db` runs this harness against a real database the same way.

## Result: 8 / 8 acceptance checks PASS

| # | Check | Result |
|---|---|---|
| A1 | Skyways: >=4 documents typed RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD | PASS — 6 found |
| A2 | Skyways: 3 lead managers from the BSE payload | PASS — Holani, Shannon, Dolat Finserv |
| A3 | Madhur (SME): documents discovered from NSE | PASS — RHP, Ratios, Anchor |
| A4 | ESDS: F3 vs F6 — NOT_YET_FILED only when every consulted exchange answered | PASS |
| A5 | ESDS: ZERO fallback (non-exchange) calls | PASS — 0 |
| A6 | Run 2: ZERO network calls for Skyways | PASS — 0, IPO skipped |
| A7 | Run 2: ZERO network calls for Madhur | PASS — 0, IPO skipped |
| A8 | No IPO holds the same bytes on disk under two types (E7/R2) | PASS |

**Run 1: 21 network calls. Run 2: 0** (`acceptance-summary.json`, `run1Calls` /
`run2Calls`). That zero is the headline property of WP B, measured by
`scraper/src/utils/network-counter.ts` — the same counter the production path uses.

## Documents actually downloaded and stored (63 MB, 11 files)

```
acc-skyways/   ADDENDUM-971b265a.pdf                  1,625,685
               ANCHOR_ALLOCATION_REPORT-8a68e38b.pdf  2,118,875
               CORRIGENDUM-d3a6094a.pdf               1,391,575
               PRICE_BAND_AD-e8d5d395.pdf             6,585,368
               RHP-147c471e.pdf                      19,866,505
acc-madhurknit/ANCHOR_ALLOCATION_REPORT-3ccd79ad.pdf    337,661
               RATIOS_BASIS_ISSUE_PRICE-04a1caf1.pdf  2,389,805
               RHP-69dcb28b.pdf                       3,469,130
acc-esds/      ANCHOR_ALLOCATION_REPORT-4e5a4f9d.pdf    310,858
               PRICE_BAND_AD-3a4a7b9d.pdf             3,229,058
               RHP-2b1500da.pdf                      21,900,385
```

All start with `%PDF`; zero `.tmp-*` files remain (the temp-then-rename contract).
Skyways and ESDS each recorded one `deduped_by_sha256` attempt, so 6 and 4 document
types respectively are backed by 5 and 3 files.

**Deepa Jewellers has no documents, and that is correct.** BSE's core API answered
200 for it (IPO_NO 7922, forthcoming) but carries no filing links yet, and we hold
no NSE symbol for it, so the attempt log reads `BSE ok` then `NSE no_symbol` and
its only due type (DRHP) is `NOT_YET_FILED`. Nothing is BLOCKED_ALL.

## Defects the live runs caught that the unit tests did not

**1. The RHP download timed out while everything smaller succeeded.** One timeout
budget covered a 6 KB JSON payload and a 25 MB PDF; the Skyways RHP failed at
exactly 20,018 ms. Fixed: `DOWNLOAD_TIMEOUT_MS = 120_000`, separate from the API budget.

**2. A failed download never tried the other exchange's copy.** Only the first link
per type was kept, so when BSE's RHP timed out the NSE zip — discovered in the same
cycle — was never attempted (matrix F2). Fixed: all candidates are kept and tried in
order, and NSE is now consulted on demand even when BSE had covered every due type.

**3. Multi-member zips silently yielded the WRONG document.** `RHP_SKYWAYS.zip`
holds `CorrigendumofRHPSkyways.pdf` (1.4 MB), `GID_Skyways.pdf` (2.7 MB) and
`RHP Skyways.pdf` (19.9 MB). Taking the first `%PDF` member stored the **corrigendum
as the RHP**, and the BSE addendum zip stored the **real RHP as the ADDENDUM**. Valid
PDFs, right company, plausible sizes — everything passed and everything was wrong. It
surfaced only because two types came out with the same sha256. Fixed:
`selectZipMemberForType` picks by member name, falling back to the largest member,
and logs the choice.

**4. BSE had no retry, and its failure was mislabelled "not filed yet".** (Round-1
re-run.) A single BSE transport failure lost the whole core payload for Skyways —
every BSE-only type *and* all three lead managers — while a manual request seconds
later returned 200. Worse, because NSE had answered, the BSE-only types were recorded
as `NOT_YET_FILED`: a claim that the company had not filed them, for which there was
no evidence, and which suppresses both the retry ladder and the alert. Fixed: BSE gets
the same 2/4/8 s ladder as NSE, and `NOT_YET_FILED` now requires that **every**
consulted exchange answered. `not_on_board` / `no_symbol` still do not count as
failures — they mean the exchange does not carry the issue at all (F13).

## Two findings about the sources themselves

**A closed mainboard IPO drops off the BSE board.** `IPO_HomePageDetail` lists only
live and forthcoming issues; Skyways (IPO_NO 7903) was already absent the day after
it closed — exactly when its Prospectus becomes due. So resolving IPO_NO by name from
the board works only while we need it least. Fixed by remembering it in
`ipos.bse_ipo_no`, written through the shared write path.

**The same PDF is published under different labels by the two exchanges.** NSE's
`RATIOS_<SYM>.zip` ("Ratios / Basis of Issue Price") contains the price-band newspaper
advertisement, because in India that ad *is* the document carrying the basis of issue
price — while BSE publishes it as `Price_Band_Advertisement`. Both are correctly typed
for their own source, so this is **recorded** (`member classifies as: PRICE_BAND_AD`
in the attempt log) rather than "corrected": rewriting NSE's type to BSE's would
misrepresent what NSE actually served. The sha256 dedup links them when the bytes match.

## BSE is intermittently unreachable, and it cost three acceptance re-runs

Across the round-1 re-runs BSE failed transiently three times — `http 0` on the core
call, then `board_unavailable` on the board — while a manual `curl` returned 200 in
under a second each time. Two real fixes came out of it:

1. BSE now has the same 2/4/8 s retry ladder as NSE, on the **board** call as well as
   the core one. The board was the last un-retried BSE request, and losing it costs
   the whole cycle's BSE coverage for every mainboard IPO at once — strictly worse
   than losing one IPO's core payload.
2. A4 asserts the F3-vs-F6 contract in BOTH directions instead of assuming BSE is up:
   every exchange answered -> missing types must be NOT_YET_FILED and nothing
   BLOCKED_ALL; an exchange FAILED -> nothing may be called NOT_YET_FILED and the
   missing types must be BLOCKED_ALL. Both branches were observed and passed.

The numbers above are from the final run, whose A4 detail reads `exchanges=BSE:ok,NSE:ok`.

## One contract expectation that was factually wrong

The DoD expected ESDS's anchor report to be `NOT_YET_FILED`. It is not: ESDS opened on
28 Aug, so its anchor round was 27 Aug and NSE was already serving `ANCHOR_ESDS.zip`.
A4 therefore asserts the behaviour actually under test — F3, an exchange answering with
no link yields `NOT_YET_FILED` and never a failure, with no fall-through to a
non-exchange host — on the types ESDS genuinely has not filed (DRHP, CORRIGENDUM).

## Files

| File | Contents |
|---|---|
| `acceptance-summary.json` | the 8 checks, pass/fail, and the run-1 / run-2 call counts |
| `run-{1,2}-network-calls.json` | every outbound call: host, URL, IPO, status, ms, bytes |
| `run-{1,2}-state-table.json` | the full state table after that run |
| `run-{1,2}-attempts-acc-*.json` | per-IPO result and the ordered attempt log, with full sha256 |

Reproduce:

```
cd scraper
npx tsx scripts/run-document-discovery.ts                       # timestamped evidence dir
npx tsx scripts/run-document-discovery.ts --evidence-dir=DIR    # explicit dir
npx tsx scripts/run-document-discovery.ts --no-download         # call counts only (A8 then fails by design)
DATABASE_URL=... npx tsx scripts/run-document-discovery.ts --db # real repository
```

The default evidence directory is timestamped, so a run never silently overwrites an
earlier one. `--no-download` deliberately makes A8 FAIL rather than pass vacuously:
with no files on disk it proves nothing, and a vacuous PASS is worse than an honest FAIL.
