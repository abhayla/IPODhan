# Purple Style Labs — per-stage walk, round 2 (T-433, 2026-09-02)

Round 1 (PR #273) found two real gaps and did NOT work around either:
(a) BSE HTML-list path errored (`__name is not defined`, 0 IPOs found) — but
that path is not what prod runs (prod runs `ENABLE_BSE_API=true`, the BSE
JSON API); (b) every DB write over the `ipodhan_test` SSH tunnel
(`localhost:15432`) timed out (`Connection terminated due to connection
timeout`) because the shared pg pool hardcodes `connectionTimeoutMillis: 2000`;
(c) `scripts/run-document-discovery.ts` had no way to target an arbitrary IPO
— only a fixed 4-IPO acceptance fixture.

This round fixes all three, at the root cause, and re-walks Purple Style Labs
(BSE mainboard, symbol `PERNIASPOP`, band 546/575, lot 26) through stages 1-4
on `ipodhan_test`.

## What changed (code)

1. **`packages/shared/src/db/index.ts`** — the pg pool's
   `connectionTimeoutMillis` (was hardcoded `2000`) and `keepAlive` (was pg's
   default `false`) are now overridable via `PG_CONNECTION_TIMEOUT_MS` /
   `PG_KEEPALIVE`, defaulting to the exact same values as before — **prod's
   pool config is unchanged unless it sets those env vars**, which it does not.
2. **`scraper/scripts/run-document-discovery.ts`** — new `--ipos
   <symbol|name,...>` flag (T-433 dod #1): when given (with `--db`), the IPO
   list is loaded from the target DB's `ipos` table (`symbol = selector OR
   company_name ILIKE '%selector%'`) instead of the hardcoded 4-IPO
   `ACCEPTANCE_IPOS` fixture. Default behavior (no `--ipos`) is byte-for-byte
   unchanged — same fixture, same A1-A9 checks. New exported
   `resolveIposFromSelectors()` is unit-tested with a mocked DB query
   (`scraper/tests/unit/scripts/run-document-discovery-ipos-selector.test.ts`,
   6 tests, all green) — no live DB needed for the test.
3. **`scraper/.env`** (gitignored, created not committed): `DATABASE_URL`
   from `web/.env.local` (the `ipodhan_test` tunnel), `NODE_ENV=test`,
   `ENABLE_BSE_API=true` (prod's value — round 1's BSE failure was the HTML
   path, which prod does not run), `PG_CONNECTION_TIMEOUT_MS=30000`,
   `PG_KEEPALIVE=true`.

## Stage 1 — Discover (`npx tsx src/index.ts --source=nse` / `--source=bse`)

| Run | Command | Rows written | Outcome |
|---|---|---|---|
| 1 | `--source=nse` | ipos: 6 inserted (`iposInserted: 6`), subscriptions: 3 created | **PASS**, exit 0. No connection-timeout errors this run (30s timeout + keepAlive held under the tunnel). |
| 2 | `--source=bse` (with `ENABLE_BSE_API=true`) | ipos: 1 inserted + 3 updated, subscriptions: 1 created | **PASS**, exit 0. The BSE JSON API path ran clean — no `__name is not defined` (that error was the disabled HTML-list path, confirmed not exercised). |

DB state after both runs (`stage1-counts.json`): `ipos=7`, `subscriptions=4`,
`gmp_records=0`. The Purple Style Labs row (`stage1-ipos-row.json`, full dump)
now exists:

| Field | Value |
|---|---|
| `id` | `06549215-abe2-46fd-b1e0-629e27db38e7` |
| `company_name` | Purple Style Labs Limited |
| `symbol` | PERNIASPOP |
| `segment` | MAINBOARD |
| `status` | OPEN |
| `price_range_min` / `max` | 546 / 575 |
| `lot_size` | 26 |
| `issue_size` | 3938644200.00 |
| `open_date` | 2026-08-30T18:30Z (= 31 Aug IST) |
| `close_date` | 2026-09-01T18:30Z (= 2 Sep IST) |
| `registrar` | KFin Technologies Limited |
| `listing_exchanges` | ["BSE"] |

All key values match the task brief exactly (band, lot, segment, dates).

## Stages 2-4 — Document discovery / download / state

`--ipos=PERNIASPOP --db`, downloads on, store =
`.prospectus-acceptance/psl-walk` (gitignored), evidence dir =
`evidence/psl-walk/stage2-4-run/`.

| Run | Command | Result |
|---|---|---|
| 1 (discovery) | (harness runs 1/2/3 internally) | 7 network calls, 5 document types **FOUND**: DRHP, RHP, PRICE_BAND_AD, RATIOS_BASIS_ISSUE_PRICE, ANCHOR_ALLOCATION_REPORT. ADDENDUM and CORRIGENDUM = NOT_YET_FILED (not published for this IPO yet). |
| 2 | same process, run 2 | **0 network calls** (`run-2-network-calls.json`: `total: 0`) — everything already FOUND/settled from run 1, matching `document_fetch_state`. |
| 3 | same process, run 3 | 0 network calls — pure skip, convergence. |

`documents` rows written for this `ipo_id` (`stage2-4-documents-and-state.json`):
4 rows (DRHP/RHP share one stored file, deduped by sha256 — same bytes, both
fetch kinds mark FOUND against it): DRHP, PRICE_BAND_AD, RATIOS_BASIS_ISSUE_PRICE,
ANCHOR_ALLOCATION_REPORT — each `is_active: true`, `media_type: PDF`, real
`sha256` + `file_size`, real BSE/NSE source `url`.

`document_fetch_state` rows for this `ipo_id`: 7 total — DRHP/RHP/PRICE_BAND_AD/
RATIOS_BASIS_ISSUE_PRICE/ANCHOR_ALLOCATION_REPORT all `FOUND` (1 attempt each),
ADDENDUM/CORRIGENDUM both `NOT_YET_FILED`.

The generic per-IPO check the harness prints for `--ipos` mode (see the
script's `else` branch, T-433 — the fixed A1-A9 checks are literal to the
4-IPO fixture and do not apply to an arbitrary `--ipos` target):

```
[PASS] IPOS-PERNIASPOP Purple Style Labs Limited: run 2 costs ZERO network calls —
  run1 found=[DRHP, RHP, PRICE_BAND_AD, RATIOS_BASIS_ISSUE_PRICE, ANCHOR_ALLOCATION_REPORT]
  run1 calls=7 run2 calls=0 skipped=true
```

`allPassed: true` (`acceptance-summary.json`).

## Failures (verbatim) — none this round

No command failed. Both prior round-1 failures did not reproduce:
- BSE: no `__name is not defined` page error (BSE_API path, not the HTML-list path).
- DB writes: no `Connection terminated due to connection timeout` on any of
  the stage 1 / stage 2-4 runs, with `PG_CONNECTION_TIMEOUT_MS=30000` +
  `PG_KEEPALIVE=true` set in `scraper/.env`.

## Gates

- New unit test: 6/6 passing (`run-document-discovery-ipos-selector.test.ts`).
- `packages/shared`: `npx tsc` clean (0 errors).
- `scraper`: `npx tsc --noEmit -p tsconfig.json` — **96 errors** (down from the
  round-1-reported 127 baseline; none in `run-document-discovery.ts` or
  `packages/shared/src/db/index.ts` — all 96 are pre-existing, unrelated to
  this change, e.g. `data-consolidation-service.ts` export conflicts,
  `verify-nse-bse-data.ts` missing `category` field, `web/lib/db` unresolved
  from `scraper/../web`).

## Files in this directory

- `stage1-nse-run.log`, `stage1-bse-run.log` — full stdout/stderr of both live Stage 1 runs.
- `stage1-psl-dump-round2.json`, `stage1-ipos-row.json`, `stage1-counts.json` — DB state after Stage 1.
- `stage2-4-run.log` — full stdout/stderr of the Stage 2-4 harness.
- `stage2-4-run/` — the harness's own evidence dir (network calls per run, state tables, attempts, `acceptance-summary.json`, SQL readback).
- `stage2-4-documents-and-state.json` — `documents` + `document_fetch_state` rows for the Purple Style Labs `ipo_id`.
