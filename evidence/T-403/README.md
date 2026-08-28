# T-403 acceptance evidence — WP A+B document discovery + state machine

**One current evidence set.** Everything here was produced on 2026-08-28 after
review round 4, against `ipodhan_test` rebuilt from nothing. Earlier generations
are under `archive/` and are superseded — do not read them as current.

Reproduce:

```
cd scraper
DATABASE_URL=postgresql://…/…_test npx tsx scripts/run-document-discovery.ts --db --reset
```

The SQL readback at the end of that run is a committed script —
`scraper/scripts/readback-document-state.ts` — and can be run on its own:

```
DATABASE_URL=… npx tsx scripts/readback-document-state.ts --out=state.json
```

## How this database was built

`DROP SCHEMA public CASCADE` + `DROP SCHEMA drizzle CASCADE`, then
`npx drizzle-kit migrate` from empty. **Exit 0, 20 of 20 journal entries applied**:
17 tables, `document_type` carrying all 15 declared values, `document_fetch_state`
with `state` typed `document_fetch_status`, `documents` carrying `sha256` with its
index, and `ipos` carrying `bse_ipo_no`, `bse_payload_lead_manager_count`,
`company_website`, `verifier_url`. Zero rows in `ipos` before seeding.

CI does the same thing on every PR: the `scraper-document-integration` job in
`pr-gate.yml` replays the journal into a fresh `postgres:16` container and runs
the document integration test against it. It lived in `test.yml` until round 4,
which is `workflow_dispatch`-only — so the check ran when someone remembered to
click it.

## What the run PROVES — the invariants

These hold on every run, and are what the checks assert. They are the contract:

| Invariant | Why it is the thing worth asserting |
|---|---|
| One state row per (IPO, due type), created by the plan and by nothing else | The state table is the memory; a missing row is an un-tracked filing |
| Every state row carries a `last_attempt`, and exactly ONE rung chain — its own | Without this the audit trail is either empty or is nine types' chains stapled to nine rows (F-4) |
| Every FOUND row names a document, and that document carries a sha256 | The dedup rule (E7/R2) is only real if the hash is persisted (W-1) |
| No IPO holds the same bytes under two document types | Two exchanges publish one filing under two labels; that is one document |
| A type the exchanges SETTLED shows only skips after the exchange rung; a type they did not settle went on to the later rungs | The B-1 blocker was exactly this, inverted |
| Run 2 costs zero network calls; run 3 is a pure skip | Convergence — the state machine must stop, not churn |
| Lead managers are captured from whichever exchange answered | One exchange being down must not lose data the other supplied (F-2) |

## This run: 9 / 9, run 1 = 23 calls, run 2 = 0, run 3 = 0

The numbers below describe THIS run against live exchanges on 2026-08-28. They
are not the contract — the invariants above are. A different day, or one
exchange timing out, moves them: Fable's run hours earlier saw a BSE transport
failure for Skyways and recorded 14 FOUND / 8 NOT_YET_FILED / 3 BLOCKED_ALL where
this run recorded 13 / 9 / 3-superseded. Both runs satisfy every invariant. A
review that treats the counts as the specification will keep "failing" on the
weather.

| Check | Result |
|---|---|
| A1 Skyways ≥ 4 typed documents | PASS — RHP, PRICE_BAND_AD, CORRIGENDUM, RATIOS_BASIS_ISSUE_PRICE, ANCHOR_ALLOCATION_REPORT, ADDENDUM |
| A2 all three book running lead managers | PASS — Holani, Shannon, Dolat (source: BSE) |
| A3 SME discovered from NSE | PASS — Madhur: RHP, RATIOS, ANCHOR |
| A4 F3 vs F6 | PASS — ESDS: not_yet=[DRHP, CORRIGENDUM] blocked=[] exchanges=BSE:ok,NSE:ok |
| A5 escalation only for unsettled types | PASS — settled 21, escalated 4, non-exchange hosts=[sebi.gov.in, chittorgarh.com] |
| A6 run 2, Skyways | PASS — 0 calls |
| A7 run 2, Madhur | PASS — 0 calls |
| A8 no duplicate bytes under two types | PASS — 5 files / 1 deduped, 3 / 0, 3 / 1, 0 / 0 |
| A9 run 3 is a pure skip | PASS — all four IPOs, 0 calls, skipped |

**A6/A7 assert zero CALLS, not `skipped`** — deliberately. After run 1 finds an
RHP, run 2 still has one piece of bookkeeping: marking the now-superseded DRHP
(F-3). That is not a skip and it touches no network. A9 asserts the convergence
that `skipped` was standing in for.

### Network accounting (NIT-3)

Run 1 total: **23 calls**. Per-IPO: Skyways 9, ESDS 7, Madhur 4, Deepa 2, plus
**1 shared BSE board fetch** charged to `(shared:bse-board)` rather than to
whichever IPO triggered it — the board is a whole-market payload fetched once per
cycle, and charging it to one IPO would misreport that IPO's cost. Per-IPO
figures therefore do not sum to the total; the total is the number to quote.

By host: `nsearchives.nseindia.com` 7, `listing.bseindia.com` 5,
`api.bseindia.com` 4, `www.nseindia.com` 3, `www.chittorgarh.com` 2,
`www.sebi.gov.in` 1, `www.bseindia.com` 1.

## The state, read back out of Postgres

`db-run/state-table-from-postgres.json`, produced by
`scripts/readback-document-state.ts` — a SELECT joining `document_fetch_state` →
`ipos` → `documents`. This run:

- **25 state rows**, 4 IPOs × their due types.
- **13 FOUND / 9 NOT_YET_FILED / 3 SUPERSEDED**, 0 BLOCKED_ALL.
- **25 of 25 carry a `last_attempt`**, each with exactly one rung chain, and that
  chain is its own type's — checked, not assumed.
- **13 of 13 FOUND rows carry a sha256**, joined from `documents`; **11 of 11**
  document rows carry one.
- **3 of 4 IPOs carry a source hint** written through the real
  `recordDocumentSourceHints` → `IPORepository.updateDocumentSourceHints`:
  Skyways `company_website = https://www.skyways-air.in` (read off a filing
  cover), ESDS and Deepa `verifier_url` (their Chittorgarh pages). Madhur has
  neither — no cover carried a website and no Chittorgarh URL is known for it.
  That is the honest state, not a gap being papered over.

### The SEBI store path

SEBI was consulted in this run (one listing fetch, four DRHP escalations) and
listed none of the four drafts, so nothing was STORED from SEBI here. That path
is proven two other ways:

1. **Fixtures** — `document-discovery-b1-chain.test.ts` drives SEBI end to end:
   listing → row match → detail page → PDF → stored, for both a DRHP and an
   off-board Prospectus.
2. **Fable's live run** on 2026-08-28 18:03 IST, where BSE was down for Skyways
   and **SEBI served its final Prospectus** —
   `www.sebi.gov.in/sebi_data/attachdocs/aug-2026/1787916423171.pdf`, 14,527 ms,
   cover check passed. That run's evidence is at
   `D:/Abhay/Ventures/IPODhan-backups/evidence-fable/`.

Whether SEBI stores anything on a given day depends on whether the exchanges
covered the IPO first — which is the chain working as designed, not a gap.

## What rounds 3 and 4 found, and what it says about the earlier evidence

Every one of these passed the previous round's checks while the defect was live.
That is the pattern worth naming: the checks were written from what the code did,
not from what the contract says.

| Round 4 | The defect |
|---|---|
| H-1 | `verifierUrl` sat outside the zod schema, so `parse()` deleted it on every row. `ipos.verifier_url` was NULL for every IPO in production and the verifier rung could never run. |
| H-2 | Every SEBI failure path returned null, indistinguishable from "not listed" — so a 503 on a DRHP was written NOT_YET_FILED: "the company has not filed it", concluded from an outage. |
| H-3 | One SEBI HTTP error was cached as an empty list, so every later IPO in the cycle recorded `SEBI:not_listed` about a request never made. |
| M-a | The website read off a PDF cover was returned raw and then fetched — the SSRF guard existed but sat at one of three call sites. |
| M-b | The verifier URL was accepted from any `http`-prefixed href and never re-validated on read. |
| M-d | The company rung re-fetched the same investor page once per due type — up to 27 GETs for one IPO. |
| F-1 | The retry ladder ran and logged nothing, so three requests and two sleeps read as one 6,762 ms hang. A reviewer concluded the retry was not wired. |
| F-2 | Lead managers came from BSE only, so one BSE timeout lost all three — while NSE's payload, already in memory, listed them. |
| F-3 | A CLOSED IPO with its RHP found alerted P2 nightly on its DRHP, which no one could ever fetch. |
| F-4 | Every row's `last_attempt` carried every other document type's rung chain. |
| W-1 | The dedup hash was computed per run and never persisted — the rule could not survive a restart. |
| W-2 | The readback json had no committed producer. |

| Round 3 | The defect |
|---|---|
| B-1 | Escalation was gated on `all_sources_failed`, so a clean `no_link` from exchanges that cannot serve a DRHP settled the row forever. The SEBI rung could never fire. |
| M-1 | `host.includes(h)` made the download allowlist meaningless. |
| M-2 | Eight `document_type` values existed only in an unapplied `_repair/` file. |
| M-3 | The persisted attempt log dropped every SEBI/COMPANY/VERIFIER attempt. |

Two more were found by running the thing rather than reading it: the migration
journal built an enum and a table with the same name (`42710`, a failed deploy),
and `loadCandidateIpos` referenced an alias that did not exist — the production
cycle's own candidate query would have thrown on first use.

## Known limit, unrepaired

The journal does not build the current schema. Measured, in
`journal-schema-drift.json`: `ipos` gets 32 of the 55 columns `schema.ts`
declares (no `segment`, no `offering_type`, a NOT NULL `category` that the model
dropped), and `documents` 8 of 19. Production was built from dumps plus the
hand-applied `_repair/` files, so it has been carrying that difference invisibly.
T-403 does not repair it — that is a schema-ownership decision for the owner, not
something to fold into this task.

**This has a cost you should know about.** `ipodhan_test` used to be built from a
dump, and the pre-existing scraper integration suite passed against it. Rebuilt
from the journal, that suite runs 98 passed / 15 failed across 9 files — every
failure is the missing columns above (`expected undefined to be 'MAINBOARD'` is
`ipos.segment` not existing; `expected +0 to be 3` is a `documents` insert with
nowhere to put its columns), plus Redis not listening on 6399. None of them touch
T-403 code. T-403's own integration test is **10/10** on this database, because
`document_fetch_state` and the columns 0035 adds are fully journaled. Restoring
that suite means either repairing the journal or rebuilding `ipodhan_test` from a
dump — the owner's call, either way.

It also shaped one design decision: `IPORepository.update` ends in a bare
`.returning()`, which asks for all 55 columns, so it cannot run on a
journal-built database. That is why the hint write goes through the narrow
`updateDocumentSourceHints` instead — which also let the acceptance harness use
the REAL repository rather than a raw-SQL stand-in. The first attempt did use raw
SQL, and the write ratchet caught it immediately and correctly: it was a new
`ipos` writer outside the shared write path.

## Files

| File | What it is |
|---|---|
| `db-run/acceptance-summary.json` | The nine checks, their verdicts, and the call totals |
| `db-run/run-{1,2,3}-network-calls.json` | Every request: host, status, ms, bytes, attributed IPO |
| `db-run/run-{1,2,3}-state-table.json` | The state table as the store returned it |
| `db-run/run-{1,2,3}-attempts-*.json` | Per-IPO result: due, found, blocked, superseded, the full attempt log |
| `db-run/state-table-from-postgres.json` | The SQL readback, by `scripts/readback-document-state.ts` |
| `migration-readback.json` | The journal replay: entries applied, tables, enum values |
| `journal-schema-drift.json` | What the journal builds vs what `schema.ts` declares |
| `document-type-enum-drift.json` | Enum values declared vs present — 0 missing |
| `archive/` | Superseded round-2 and round-3 generations. Not current. |
