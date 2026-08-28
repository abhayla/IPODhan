# T-403 acceptance evidence — WP A+B document discovery + state machine

Produced by `scraper/src/scripts/run-document-discovery.ts`, run twice against the
**live** BSE and NSE APIs on 2026-08-28. Every number below is measured, not asserted
from reading code.

## Honest limits of this run — read first

**The database-backed acceptance run in the contract's DoD was NOT performed.** The dev
database `ipodhan_wpab` (a restored prod dump) was dropped mid-task when its host ran out
of disk — an owner-handled production incident on 2026-08-28. Rather than fabricate it,
this run keeps the four acceptance IPOs as literals (using the values read from that
database at 12:20 IST, before it went down) and substitutes
`InMemoryDocumentFetchStateStore` for Postgres.

| Exercised by this run | NOT exercised |
|---|---|
| BSE board + core API parsing, IPO_NO resolution | `DocumentFetchStateRepository`'s SQL |
| NSE `ipo-detail` (EQ and SME), retry ladder | the `(ipo_id, doc_type)` unique constraint and its `ON CONFLICT` upsert |
| The classifier, on real payloads | migration `0035` applying cleanly |
| Real downloads, verification, zip-member selection | `ipos.bse_ipo_no` / `bse_payload_lead_manager_count` writes |
| The state transitions and the zero-call property | `scraper_logs` `source='DOCUMENTS'` row |
| The network accounting | the nightly audit against a real table |

Everything in the left column is the same code that runs in production, against the same
live hosts. The right column is a real gap and is **pending** — it is closed by re-running
this harness against the database once the host is back.

## Result: 8 / 8 acceptance checks PASS

| # | Check | Result |
|---|---|---|
| A1 | Skyways: >=4 documents typed RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD | PASS — 6 found |
| A2 | Skyways: 3 lead managers from the BSE payload | PASS — Holani, Shannon, Dolat Finserv |
| A3 | Madhur (SME): documents discovered from NSE | PASS — RHP, Ratios, Anchor |
| A4 | ESDS: unfiled types are NOT_YET_FILED, never BLOCKED_ALL (F3) | PASS |
| A5 | ESDS: ZERO fallback (non-exchange) calls | PASS — 0 |
| A6 | Run 2: ZERO network calls for Skyways | PASS — 0, IPO skipped |
| A7 | Run 2: ZERO network calls for Madhur | PASS — 0, IPO skipped |
| A8 | No IPO holds the same bytes on disk under two types (E7/R2) | PASS |

**Run 1: 17 network calls. Run 2: 0.** That is the headline property of WP B — an IPO whose
filings are all accounted for costs nothing on the next cycle. Measured by
`scraper/src/utils/network-counter.ts`, which is the same counter the production code path
uses.

## Documents actually downloaded and stored (87 MB)

```
acc-skyways/   ADDENDUM-971b265a.pdf                  1,625,685
               ANCHOR_ALLOCATION_REPORT-8a68e38b.pdf  2,118,875
               CORRIGENDUM-d3a6094a.pdf               1,391,575
               PRICE_BAND_AD-e8d5d395.pdf             6,585,368
               RHP-b4971a1a.pdf                      46,922,851
acc-madhurknit/ANCHOR_ALLOCATION_REPORT-3ccd79ad.pdf    337,661
               RATIOS_BASIS_ISSUE_PRICE-04a1caf1.pdf  2,389,805
               RHP-69dcb28b.pdf                       3,469,130
acc-esds/      ANCHOR_ALLOCATION_REPORT-4e5a4f9d.pdf    310,858
               RATIOS_BASIS_ISSUE_PRICE-3a4a7b9d.pdf  3,229,058
               RHP-2b1500da.pdf                      21,900,385
```
All start with `%PDF`; zero `.tmp-*` files left behind (the temp-then-rename contract).
`acc-deepa` (upcoming, no NSE symbol, not yet on the BSE core API) has no documents — correct.

## Three defects this run caught that the unit tests did not

These are the reason the run was worth doing; each is fixed and pinned by a test.

**1. The RHP download timed out while everything smaller succeeded.**
`FETCH_TIMEOUT_MS` was one budget for both a 6 KB JSON payload and a 25 MB PDF. Skyways'
RHP failed at exactly 20,018 ms. A single budget guarantees the most important filing is
the one that fails. Fixed: `DOWNLOAD_TIMEOUT_MS = 120_000`, separate from the API budget.

**2. A failed download never tried the other exchange's copy of the same document.**
The runner kept only the FIRST discovered link per type, so when BSE's RHP timed out, the
NSE `RHP_SKYWAYS.zip` — already discovered in the same cycle — was never attempted. That is
matrix F2, unimplemented. Fixed: every candidate link is kept per type and tried in order;
only when all fail is the type BLOCKED_ALL. Visible in the attempt log as
`rejected:http_error` on BSE followed by `downloaded` from `nsearchives`.

**3. Multi-member zips silently yielded the WRONG document.**
`RHP_SKYWAYS.zip` (23 MB) holds three PDFs:

```
RHP_SKYWAYS/CorrigendumofRHPSkyways.pdf    1,391,575
RHP_SKYWAYS/GID_Skyways.pdf                2,744,810
RHP_SKYWAYS/RHP Skyways.pdf               19,866,505   <- the actual RHP
```

The unwrapper took the first `%PDF` member, so the **corrigendum was stored as the RHP**,
and the BSE addendum zip stored the **real RHP as the ADDENDUM**. Every check passed: valid
PDFs, right company, plausible sizes. Nothing was broken; everything was wrong — the
wrong-but-working class. It surfaced only because two document types came out with an
identical sha256. Fixed: `selectZipMemberForType` picks the member whose NAME classifies as
the wanted type, falling back to the largest member, and the chosen member is recorded in
the attempt log (`downloaded (zip member: RHP_SKYWAYS/RHP Skyways.pdf)`).

## Two findings about the sources themselves

**A closed mainboard IPO drops off the BSE board.** `IPO_HomePageDetail` lists only live and
forthcoming issues. Skyways (IPO_NO 7903) was already absent from the board captured the day
after it closed — which is exactly when its final Prospectus becomes due. So the contract's
"IPO_NO resolved from IPO_HomePageDetail by name" works only while we need it least.
Root-cause fix: `ipos.bse_ipo_no` remembers it while the IPO is still on the board.

**BSE's price-band advertisement and NSE's "Ratios / Basis of Issue Price" are the same
PDF** — byte-identical for Skyways (6,585,368 bytes, same sha256). In India the price-band
advertisement IS the document carrying the basis of issue price, and the two exchanges
publish it under different labels. Handled per E7/R2: one stored file, the second URL
recorded as `deduped_by_sha256_to:PRICE_BAND_AD` in the attempt log.

## One expectation in the contract that was factually wrong

The DoD expected ESDS's anchor report to be `NOT_YET_FILED`. It is not: ESDS opens on
28 Aug, so its anchor round was 27 Aug, and NSE was already serving `ANCHOR_ESDS.zip` when
this ran. The behaviour actually under test — F3, "an exchange that answers with no link
yields NOT_YET_FILED and never a failure, with no fall-through to a non-exchange host" — is
verified on the types ESDS genuinely has not filed (DRHP, PRICE_BAND_AD, CORRIGENDUM), with
0 fallback calls. A4 asserts that instead of asserting a fact about the market that is untrue.

## Files

| File | Contents |
|---|---|
| `acceptance-summary.json` | the 8 checks, pass/fail, and the run-1 / run-2 call counts |
| `run-{1,2}-network-calls.json` | every outbound call: host, URL, IPO, status, ms, bytes |
| `run-{1,2}-state-table.json` | the full state table after that run |
| `run-{1,2}-attempts-acc-*.json` | per-IPO result and the ordered attempt log |

Reproduce: `cd scraper && npx tsx src/scripts/run-document-discovery.ts`
(add `--no-download` to check the call counts without fetching 87 MB of PDFs).
