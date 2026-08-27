---
name: non-fatal-side-effects
description: >
  Every auxiliary operation that runs AFTER the primary scraped-data write
  (status update, log pruning, alert email, cache invalidation, calendar
  refresh) MUST be isolated in its own try/catch, logged as "(non-fatal)", and
  MUST NEVER throw into or fail the core scrape result.
paths: ["scraper/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Non-Fatal Side Effects (best-effort post-write operations)

## The primary write decides success; everything after it is best-effort

In the scraper, the only thing that determines whether a run succeeded is the
primary IPO write (`upsertIPO()` via the consolidation pipeline — see the
`scraper-write-path` rule). Every operation that fires AFTER that write is an
auxiliary side effect: it improves freshness/observability but its failure MUST
NOT corrupt `combinedResult.success`, throw out of the run, or crash the
process/scheduler. This is a confirmed, repeated idiom across the codebase —
match it for every new post-write step.

Each aux op MUST be wrapped in its OWN `try/catch` (not share one with the
primary write), log its failure at `error`/`warn` level with the message
explicitly tagged `(non-fatal)`, and then RETURN/CONTINUE rather than rethrow.

## Confirmed instances — copy these patterns

- `scraper/src/index.ts` — after the `source === 'all'` run, `triggerStatusUpdate()`
  (~line 222) and `pruneScraperLogs()` (~223) are awaited as best-effort. Both
  are `async` functions whose bodies are fully wrapped: `triggerStatusUpdate()`
  catches and logs `"IPO status update trigger failed (non-fatal)"` (~line 291);
  `pruneScraperLogs()` (30-day window, `SCRAPER_LOG_RETENTION_DAYS = 30`) catches
  and logs `"scraper_logs prune failed (non-fatal)"` (~line 310). Neither calls
  `process.exit` or rethrows.
- `scraper/src/services/alerting-service.ts` (~line 112) — the alert email send
  swallows its error with the comment `"Don't throw - email failure shouldn't
  crash the alerting system"`.
- `scraper/src/scheduler/cache-invalidator.ts` (~line 72) — `invalidateAfterScrape()`
  catches and logs `"Cache invalidation failed"` with `"Don't throw - cache miss
  is acceptable"`; every per-type helper (`invalidateIPOListings`, `invalidateSubscriptions`,
  `deleteKeysByPattern`, …) independently returns `0`/void on error.
- `scraper/src/jobs/refresh-calendar.ts` (~line 59) — `refreshCalendarView()`
  catches the refresh failure with `"Don't throw - let the scheduler continue"`,
  and even its failure-logging INSERT is nested in its own inner try/catch.
- `scraper/src/services/base-scraper-orchestrator.ts` (~line 310) — the blocked-update
  notification logger ends with `"Non-fatal - don't throw"`.

## Why

The scraper crash-loop that produced the 515k-row / 115 MB `scraper_logs` bloat
(GitHub #15) is the cautionary tale: a side effect that throws can take down the
whole run or the scheduler, blocking real data writes. Best-effort isolation
keeps one flaky downstream (SMTP, Redis, the web status API, the materialized
view) from poisoning a successful scrape.

## Alternatives, not just prohibitions

- If a post-write step is genuinely REQUIRED for correctness, it is not an aux op —
  fold it INTO `upsertIPO()`/the consolidation path so it shares the primary
  write's transaction and error semantics, instead of bolting it on afterward.
- Need retry/visibility? Log the failure (tagged `(non-fatal)`) and, where it
  matters, record to `scraper_logs` (as `refresh-calendar.ts` does) or surface via
  `alerting-service.ts` — never by rethrowing into the scrape result.

## CRITICAL RULES

- MUST wrap every post-write auxiliary operation (status update, log prune, alert
  email, cache invalidation, calendar refresh, blocked-update logging) in its own
  try/catch.
- MUST log such failures with the literal `(non-fatal)` tag and then continue —
  MUST NOT rethrow, set the run to failed, or call `process.exit` from an aux op.
- MUST NOT let an aux op's failure mutate `combinedResult.success` or abort the
  scrape; only the primary `upsertIPO()` write determines success.
- If an operation MUST succeed for data correctness, fold it into the primary
  write path instead of treating it as a non-fatal side effect.
