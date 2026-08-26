# T-330 — round-7 P2-1..P2-5 — STATUS

Branch: `fleet/T-330-api-500s-schema-drift` (worktree `IPODhan-T-330-t330`).

## Resume context

First attempt hit `error_max_turns` at 150/150. Worktree was clean, branch pushed at `6677c4a`.
This run resumes in the SAME worktree/branch with max_turns doubled to 200, continuing P2-2..P2-5.

## DoD audit (5 items)

| # | Item | Status |
|---|---|---|
| 1 | Schema-drift gate (mechanism) | **DONE** (commit `6677c4a`) |
| 2 | P2-1: ipo_scores.algorithm_version varchar(50) migration | **DONE** (commit `6677c4a`) |
| 3 | P2-2: cache round-trip Date rehydration class fix | **DONE** |
| 4 | P2-3 + P2-4: calendar_view matview / /api/metrics column mismatch | PENDING |
| 5 | P2-5: public error-body SQL leak sweep + generic error-handler helper | PENDING |
| 6 | Zero new test failures / tsc clean / PR opened / never merge | PENDING |

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
