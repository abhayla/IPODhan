# Purple Style Labs — per-stage walk on ipodhan_test (2026-09-02)

Goal: walk ONE IPO (Purple Style Labs, BSE main board, RHP 24 Aug 2026, PBA 2 Sep,
opened 31 Aug, closes 2 Sep 2026) through pipeline stages 1-4 on `ipodhan_test`
(empty DB, 0 `ipos` rows at start), per `docs/reviews/ipo-pipeline-stage-gap-analysis.md` §6.
Extraction (stage 5) is intentionally out of scope (proven separately in PR #271).

**Bottom line: stage 1 wrote zero rows for Purple Style Labs, and stages 2-4's only
existing runner cannot target it at all.** Both are real gaps, documented below —
neither was patched or worked around (review tier C, evidence only, no `src/` changes).

## Environment

- `scraper/.env` created (gitignored, not committed): `DATABASE_URL` copied from
  `web/.env.local` (ipodhan_test via the SSH tunnel on `localhost:15432`), `NODE_ENV=test`.
  No other keys — `assertRequiredEnvForCycle()` (scraper/src/index.ts:160) only gates
  `--source=all` cycles; single-source runs (`--source=bse`, `--source=nse`) need none
  of those keys.
- Redis: no `REDIS_URL`/`REDIS_HOST` set. `packages/shared/src/cache/redis-client.ts`
  falls back to `localhost:6379` with a console warning and a capped retry (3 attempts,
  then stops) — non-fatal for a single-source discovery run. A local Redis happened to
  answer on 6379 in this environment (`[Redis] Connected successfully`), so no explicit
  skip flag was needed; if none had answered, the documented fallback is: it warns and
  the run still proceeds (cache is best-effort, never required for the discovery path).
- `packages/shared` was rebuilt (`npx tsc`) before running, per CLAUDE.md.
- Live network budget: exactly 2 runs used (`--source=bse` once, `--source=nse` once).

## Stage 1 — Discover (`npx tsx src/index.ts --source=bse` / `--source=nse`)

| Run | Command | Rows written (ipos/subscriptions/gmp_records) | Outcome |
|---|---|---|---|
| 1 | `npx tsx --tsconfig tsx.tsconfig.json src/index.ts --source=bse` | 0 / 0 / 0 | **FAIL** — BSE public-issue list page returned `detailUrlsFound: 0, totalIPOs: 0`. Log shows a page-eval console error `"__name is not defined"` right after page load, before any row parsing — the BSE page did not yield any IPO rows to the orchestrator at all. |
| 2 | `npx tsx --tsconfig tsx.tsconfig.json src/index.ts --source=nse` | 0 / 0 / 0 | **FAIL** — NSE API returned 6 IPOs (`DEEPA`, `MOMSBELIEF`, `PERNIASPOP`, `PRIORITY`, `ESDS`, `QUALIANCE`) — **Purple Style Labs / its symbol is not among them** (NSE's current live list simply doesn't carry it — consistent with PSL being a BSE-only main-board listing per the task brief). Every one of the 6 also failed to upsert: `Failed to fetch IPO by symbol: <SYM>` wrapping a Postgres `Connection terminated due to connection timeout` on the `ipodhan_test` tunnel (`localhost:15432`) — a second, independent failure (DB-tunnel fragility under sustained query load), not a BSE/NSE scraping bug. |

**DB state after both runs** (`stage1-ipos-count.json`, `stage1-subscriptions-count.json`,
`stage1-gmp-records-count.json`, `stage1-ipos-dump.json`): `ipos=0`, `subscriptions=0`,
`gmp_records=0`. No Purple Style Labs row exists — **its key values (segment, status,
dates, price band, lot size, issue size) cannot be captured because the row was never
created.**

Exact errors (verbatim, full logs in `stage1-bse-run.log` / `stage1-nse-run.log`):

- BSE: `WARN Page error (console error) errorType: "object" error: "__name is not defined"`
  then `INFO Found detail page URLs detailUrlsFound: 0 totalIPOs: 0`.
- NSE (x6, one per symbol): `ERROR Failed to process IPO scraperName: "NSE" error: "Failed to fetch IPO by symbol: <SYM>"`,
  root cause in the wrapped `DrizzleQueryError`: `cause: Error: Connection terminated due to connection timeout` /
  `[cause]: Error: Connection terminated unexpectedly` (pg-pool, over the `localhost:15432` tunnel).
- Both runs also failed their own `scraper_logs` audit-trail insert with the same
  connection-timeout error (`[DB] scraper_log.create FAILED`), which is why the CLI
  itself exits 1 even though the scrape phase logged "completed successfully".

## Stages 2-4 — Document discovery / download / state (`scraper/scripts/run-document-discovery.ts --db`)

**Not run against Purple Style Labs — the script cannot target it.** Reading the file:
it is a fixed T-403 acceptance harness hardcoding exactly four IPOs (`Skyways Air
Services Ltd.`, `Madhur Knit Crafts Ltd.`, `ESDS Software Solution Limited`,
`Deepa Jewellers Ltd.` — lines ~80/95/106/125) with no `--ipos` flag, no company-name
filter, and no generic "any IPO by name" mode. In `--db` mode it explicitly refuses to
proceed for any IPO not already seeded as one of those four rows:
`--db: no ipos row for ${ipo.companyName}. Seed the four acceptance rows first.`
Since stage 1 also produced no Purple Style Labs row (above), there is no `ipos.id` to
key stages 2-4 off even if the script were general-purpose. Running it would only
re-prove the existing 4-IPO acceptance fixture (already covered by T-403/PR #271), not
say anything about Purple Style Labs — so it was not run, per the instruction to report
a failing/blocked stage honestly rather than work around it.

**Finding for the record:** the stage-gap-analysis plan (§6) assumes stage 1 hands
stage 2-4 a real `ipos` row for an arbitrary target IPO, and that the stage 2-4 runner
accepts an arbitrary IPO. Neither held for Purple Style Labs today: stage 1 is failing
on both BSE (empty scrape) and NSE (DB-tunnel timeout on write) for this IPO, and the
stage 2-4 runner is not (yet) parameterized beyond its 4 fixture IPOs.

## Files in this directory

- `stage1-bse-run.log`, `stage1-nse-run.log` — full stdout/stderr of both live runs.
- `stage1-ipos-dump.json`, `stage1-ipos-count.json`, `stage1-subscriptions-count.json`,
  `stage1-gmp-records-count.json` — DB state after stage 1 (all empty/zero).
