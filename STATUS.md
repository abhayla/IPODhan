# T-330 — round-7 P2-1..P2-5 — STATUS

Branch: `fleet/T-330-api-500s-schema-drift` (worktree `IPODhan-T-330-t330`).

## Resume context (3rd and FINAL lifetime resume — 2026-08-27)

Run 1 hit `error_max_turns` at 150/150 (P2-1 landed). Run 2 hit `error_max_turns` at
200/200 (P2-2, P2-3+P2-4 committed clean with tests; P2-5 work existed uncommitted at
death — an automatic rescue captured it as autosave commit `69cf93d`, merged onto this
branch by the dispatcher and pushed). This run (3rd/final): verified the autosave
commit's content, finished the remaining P2-5 sweep, ran the full test suite + tsc
across both workspaces, wrote evidence, and opens the PR.

## DoD audit (5 items) — ALL DONE

| # | Item | Status |
|---|---|---|
| 1 | Schema-drift gate (mechanism) | **DONE** (commit `6677c4a`) |
| 2 | P2-1: ipo_scores.algorithm_version varchar(50) migration | **DONE** (commit `6677c4a`) |
| 3 | P2-2: cache round-trip Date rehydration class fix | **DONE** (commit `fe2cfeb`) |
| 4 | P2-3 + P2-4: calendar_view matview / /api/metrics column mismatch | **DONE** (commit `d05003a`) |
| 5 | P2-5: public error-body SQL leak sweep + generic error-handler helper | **DONE** (autosave `69cf93d` + this run's finishing sweep) |
| 6 | Zero new test failures / tsc clean / PR opened / never merge | **DONE this run** |

## P2-5 evidence (this run)

Verified the autosave commit (`69cf93d`) was sound: read `web/lib/errors/api-error-response.ts`
in full, confirmed its 6-test unit suite passes in isolation, and spot-checked several
of its 24 route edits (`admin/gmp/[ipoId]`, `admin/cache/clear`, `admin/conflicts`,
`health`) — all correct, no half-edited handlers, no dead imports.

Finished the sweep: grepped all of `web/app/api/**/*.ts` for `.message` usage (32
files matched), individually inspected each to separate real unconditional leaks
from false positives (server-side-logger-only usage, `EntityNotFoundError`'s
controlled-safe message, or the pre-existing `NODE_ENV==='development'`-gated
`details` pattern). Found and fixed **5 more files / 6 more sites** that
unconditionally leaked `error.message` into a public response body:
- `admin/scraper/status` (migrated to `apiErrorResponse`)
- `admin/dynamic/[table]` POST, `admin/dynamic/[table]/list` GET,
  `admin/dynamic/[table]/[id]` GET/PATCH/DELETE (5 sites) — these are the
  fable-review-flagged "write any table by name" admin endpoint (P1-D); kept the
  existing `{success, error: string}` response shape (not `apiErrorResponse`'s
  object shape) because `web/app/admin/dynamic/[table]/[id]/page.tsx` does
  `throw new Error(response.error || ...)` and would have shown `[object Object]`
  to the admin user otherwise — verified by reading the caller before choosing the fix.
- `admin/conflicts/resolve` — a second site missed by the autosave: the inner
  per-conflict catch inside the resolution loop, pushing raw `.message` into the
  `failed[]` array of an otherwise-200 response.

Full sweep detail + the 26 files inspected and confirmed already-safe:
`C:\Abhay\GetWorkDone\evidence\2026-08-26-T-330\p2-5-error-leak-sweep.md`.

**Verification (both workspaces, full suite):**
- `npx tsc --noEmit --project web/tsconfig.json` -> clean.
- `npx tsc --noEmit` (packages/shared) -> clean.
- `npm run test:unit` (web, full suite) -> **164 files / 2350 tests pass, 17 skipped, 0 failed**.
- scraper `npx vitest run tests/unit` (full suite) -> **123 files / 1353 tests pass, 1 skipped, 0 failed**.

Zero new failures vs origin/main (both suites fully green, no skips added by this run).

## P2-3 + P2-4 evidence

**P2-3** — `/api/calendar/materialized/[category]` queried a `calendar_view` matview that
migration `0001_add_calendar_materialized_view.sql` creates but which was never added to
`meta/_journal.json` — so `drizzle-kit migrate` never ran it and the matview has never existed
in any real database (confirmed: `assert-schema-drift.ts`'s own header/comments, landed in the
prior P2-1 commit, already documented this exact class and explicitly deferred the calendar_view
decision to "T-330 P2-3"). The scraper-side refresh job (`scraper/src/jobs/refresh-calendar.ts`)
that was meant to keep it fresh is dead code — never wired into the scheduler tree — and its own
header comment records this as a pre-existing, already-triaged gap (T-241/T-242 H3) with an
explicit prior decision NOT to build the matview SQL out.

Decision: retire the route honestly (contract's own wording) rather than build unused
infrastructure — the route has zero frontend consumers (grepped; only self-referenced), and the
live, JOIN-based `/api/calendar/[category]` already serves this data. Route now returns
`410 Gone` with `{error: {code: 'ENDPOINT_RETIRED', message: '...use GET /api/calendar/[category]
instead'}}` instead of a public 500 that can never succeed. This matches
`EXPECTED_MATVIEWS` in `assert-schema-drift.ts`, which already excludes `calendar_view` with a
comment anticipating this exact retirement.

**P2-4** — `web/lib/services/metrics-service.ts` had two broken raw-SQL queries against
`scraper_logs`/`ipos`:
- `collectBusinessMetrics()`'s scraper-health query referenced `started_at`/`completed_at`
  (schema SSOT: only `created_at` + `duration_ms` exist) and filtered `status = 'FAILED'`
  (real enum value is `'FAILURE'`). Fixed to use `created_at`, `duration_ms` directly (already
  milliseconds, matching `scraper-log-repository.ts`'s own `avgDuration` convention), and the
  correct `'FAILURE'` value.
- `getDataQualityMetrics()` referenced `price_range_lower`/`price_range_upper` (real:
  `price_range_min`/`price_range_max`) and `total_shares`, which does not exist on `ipos` at
  all (share counts live on `subscriptions.totalSharesBid` / `ipoDetails.totalSharesOffered`,
  not a per-IPO column) — this query would also 500. Fixed the column names; removed the
  `totalShares` completeness dimension since no real ipos-level column backs it (grepped: zero
  downstream consumers of `completeness.totalShares`).

New tests: `web/tests/unit/api/calendar-materialized/route.test.ts` (410 regression),
`web/tests/unit/lib/services/metrics-service.test.ts` (4 tests asserting the corrected SQL
never references the broken column names/enum value, plus shape assertions).

Verification: `npx vitest run tests/unit/lib/services tests/unit/api --testTimeout=20000` ->
20 files / 267 tests pass. `npx tsc --noEmit --project web/tsconfig.json` -> clean.

## P2-2 evidence

Root cause: `BaseRepository.getFromCache` (both `packages/shared/src/repositories/base-repository.ts`
and the near-duplicate `web/lib/repositories/base-repository.ts`) did `JSON.parse(cached) as T` with
no reviver on a cache HIT. A Drizzle DB read returns real `Date` instances; a Redis cache hit only
ever returns the `JSON.stringify`'d wire form, so `timestamp`/`createdAt`/etc. silently became
`string` on every cache hit. `subscriptions/latest/route.ts:163` and
`ipos/[slug]/gmp/latest/route.ts:175` call `.toISOString()` on that field and throw
`TypeError: ...timestamp.toISOString is not a function` — a 500 on every cache-warm request (i.e.
after the first request per IPO in each 5/10-min TTL window).

Fix (repository-level, the whole class — not the two call sites): both `BaseRepository`s now parse
cache hits with a `reviveDates` JSON.parse reviver that turns `JSON.stringify(Date)`-shaped strings
(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`) back into real `Date` instances.

Sibling sweep (grepped every `.toISOString()`/`.getTime()` call site + every repository test
asserting the pre-fix stringified behavior): fixed 5 more repository tests that asserted the BUG as
correct behavior (`ipo-repository.test.ts`, `registrar-repository.test.ts` x3, `review-repository.test.ts`)
— none needed route changes, only test corrections, since the routes already expected real Dates.
`ipo-score-realtime-repository.ts`'s cache path was checked and is NOT affected — `ScoreComponents`
has no Date fields.

RED->GREEN proven: reverted the fix, re-ran the new `subscription-repository.test.ts` regression
test -> failed with `expected '2024-01-15T00:00:00.000Z' to be an instance of Date`; restored the
fix -> passed.

Verification: `npx vitest run tests/unit/lib/repositories --testTimeout=20000` -> 13 files / 168
tests, all pass. `npx tsc --noEmit --project web/tsconfig.json` -> clean. `cd packages/shared &&
npx tsc` -> clean.

## Notes

- `docs/architecture/fable-review-2026-08-24.md` read — background context on write-path
  architecture issues; not directly related to these 5 API-500 bugs but establishes the
  project's root-cause-not-special-case discipline this task follows.
- Evidence dir `evidence/2026-08-26-T-322/REVIEW-VERDICT.md` referenced in the contract is on
  a different machine's fleet bus, not present in this worktree — proceeding from the
  contract's inline P2-1..P2-5 summary, which is fully specified.
