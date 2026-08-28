# T-403 acceptance evidence — WP A+B document discovery + state machine

**One current evidence set.** Everything here was produced on 2026-08-28 after
review round 3, against `ipodhan_test` rebuilt from nothing. Earlier generations
are under `archive/` and are superseded — do not read them as current.

Reproduce:

```
cd scraper
DATABASE_URL=postgresql://…/…_test npx tsx scripts/run-document-discovery.ts --db --reset
```

## How this database was built

`DROP SCHEMA public CASCADE` + `DROP SCHEMA drizzle CASCADE`, then
`npx drizzle-kit migrate` from empty. **Exit 0, 20 of 20 journal entries applied**
(`migration-readback.json`): 17 tables, `document_type` carrying all 15 declared
values, `document_fetch_state` with `state` typed `document_fetch_status`, and
`ipos` carrying `bse_ipo_no`, `bse_payload_lead_manager_count`,
`company_website`, `verifier_url`. Zero rows in `ipos` before seeding — the
verifier's four `bv-*` rows are gone with the schema.

## Result: 8 / 8, run 1 = 21 calls, run 2 = 0

| # | Check | Result |
|---|---|---|
| A1 | Skyways: >=4 documents typed RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD | PASS — 6 found |
| A2 | Skyways: 3 lead managers from the BSE payload | PASS |
| A3 | Madhur (SME): documents discovered from NSE | PASS |
| A4 | ESDS: F3 vs F6 — NOT_YET_FILED only when every consulted exchange answered | PASS |
| A5 | Fallback rungs consulted ONLY for types the exchanges did not settle | PASS |
| A6 | Run 2: ZERO network calls for Skyways | PASS |
| A7 | Run 2: ZERO network calls for Madhur | PASS |
| A8 | No IPO holds the same bytes on disk under two types (E7/R2) | PASS |

### Call accounting (NIT-3)

Run 1 made **21 calls in total**. The per-IPO figures below do **not** sum to 21:
the BSE board is a whole-market payload fetched once per cycle and is attributed
to the shared key `(shared:bse-board)`, not to whichever IPO happened to trigger it.

```
by IPO      Skyways 9 · ESDS 6 · Madhur 4 · Deepa 1 · (shared:bse-board) 1   = 21
by host     nsearchives.nseindia.com 7 · listing.bseindia.com 5 ·
            api.bseindia.com 4 · www.nseindia.com 3 ·
            www.bseindia.com 1 · www.sebi.gov.in 1                          = 21
```

Run 2 made **0** calls in total.

## The state, read back out of Postgres

`db-run/state-table-from-postgres.json` — taken with SQL, including the full
`last_attempt` json per row and each document's sha256 joined from `documents`:

```
25 document_fetch_state rows · 11 documents rows
by state: FOUND = 13, NOT_YET_FILED = 12   (nothing BLOCKED_ALL)
12 rows carry a document sha256
e.g. ESDS / RHP  sha256 2b1500da163d971da74e…  21,900,385 bytes
```

Every row also carries its rung chain, e.g.

```
rungs[DRHP]: EXCHANGES:no_link -> SEBI:not_listed
             -> COMPANY:skipped:no_company_url -> VERIFIER:skipped:no_verifier_url
```

That line is the point of round 3: SEBI is now **consulted** for a DRHP. It never
was before — see below.

## What round 3 found, and what it says about the earlier evidence

**The SEBI rung could never fire for a DRHP or a post-close Prospectus** — the two
documents it exists for. Escalation was gated on `all_sources_failed`, but at
UPCOMING both exchanges answer normally and simply have no DRHP link, which is
`no_link`, not a failure. The chain recorded `SEBI:skipped:exchanges_settled_it`
and the row sat NOT_YET_FILED forever.

**Round 2's evidence certified that as a pass.** A5 asserted ZERO non-exchange
calls — true only while escalation never happens. An acceptance check written
after the code, from the code's observed behaviour, ratifies whatever the code
does. A4 and A5 now assert the contract instead of the behaviour.

Replaying the journal from empty also found three defects no unit test could:

1. **0035 created an enum and a table with the same name** — `42710 type
   "document_fetch_state" already exists`. In production that fails the deploy at
   the migrate step. Enum renamed to `document_fetch_status`; a CI gate
   (`migration-name-collision.test.mjs`) now parses every journaled migration.
2. **Eight `document_type` values were in no migration.** They had been put in
   `_repair/`, which nothing runs — the deploy is migrate-only — so a
   journal-built database threw `invalid input value for enum` and the cycle's
   non-fatal catch swallowed it. Now journaled as 0036;
   `document-type-enum-drift.json` shows **0 missing**.
3. **`ipo_details` is not created by the journal at all** — the M-6 columns were
   first added there and the replay failed with `relation "ipo_details" does not
   exist`. They now live on `ipos`.

## Known limit, unrepaired

The journal still cannot rebuild the schema: `ipos` gets 32 of the 52 columns
`schema.ts` declares (including a NOT NULL `category` the schema replaced with
`segment`/`offering_type`), and `documents` gets 7 of ~18. Production is fine —
it was built from dumps plus `_repair/` — but no environment can be rebuilt from
the journal. Measured in `journal-schema-drift.json`. Repairing it is a
schema-ownership decision for the owner, not something to fold into this task.

**This has a cost you should know about.** `ipodhan_test` used to be built from a
dump, and the pre-existing scraper integration suite passed against it. Rebuilt
from the journal for V-1, that suite now runs 98 passed / 15 failed across 9
files — every failure is the missing columns above (`expected undefined to be
'MAINBOARD'` is `ipos.segment` not existing; `expected +0 to be 3` is a
`documents` insert with nowhere to put its columns), plus Redis not listening on
6399. None of them touch T-403 code. T-403's own integration test
(`document-fetch-state-repository.integration.test.ts`) is **8/8** on this
database, because `document_fetch_state` is fully journaled by 0035. Restoring
that suite means either repairing the journal or rebuilding `ipodhan_test` from a
dump — the owner's call, either way.

## Files

| File | Contents |
|---|---|
| `migration-readback.json` | the journal replay from empty: 20/20, schema shape, enum values |
| `document-type-enum-drift.json` | enum values on a journal-built DB vs `schema.ts` — now 0 missing |
| `journal-schema-drift.json` | the wider, unrepaired column drift |
| `db-run/acceptance-summary.json` | the 8 checks and the run-1 / run-2 call counts |
| `db-run/state-table-from-postgres.json` | the state read back with SQL: full `last_attempt`, sha256, rung chains |
| `db-run/run-{1,2}-network-calls.json` | every outbound call: host, URL, IPO, status, ms, bytes |
| `db-run/run-{1,2}-attempts-*.json` | per-IPO result and ordered attempt log |
| `archive/` | superseded round-2 generations, kept for history only |
