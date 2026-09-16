/**
 * PASS 3's dependency builder — the one door the field-plan walk goes through.
 *
 * Separate from `field-plan-walk.ts` for the same reason
 * `filing-persist-deps.ts` is separate from `filing-persister.ts`: the walk
 * itself is pure scheduling and bookkeeping, fully testable with stubs, and
 * nothing in it should reach for a database handle or a Redis client.
 *
 * WHY THE ORCHESTRATOR IS CONSTRUCTED HERE AND NOT PER IPO. Item 1's
 * consolidated writer opens repositories; rebuilding it per IPO in the cycle
 * loop would be pure waste, and a SECOND Redis client is exactly what
 * `buildFilingPersistDeps` was careful not to open (F-101). PASS 3 builds it
 * once per cycle and hands the same instance to every IPO's walk.
 *
 * THE NAMED GAP — READ THIS BEFORE TURNING THE FLAG ON.
 * `buildFieldPlanWalkFetchers()` returns an EMPTY registry today. That is a
 * deliberate, declared gap, not an oversight:
 *
 *   The walk asks a source for ONE field of ONE row. Every existing scraper
 *   orchestrator is built the other way round — it fetches a whole IPO (or a
 *   whole document) and hands the result to the consolidated writer. There is
 *   no per-(source, table, field) entry point anywhere in `scrapers/` to
 *   adapt, so a fetcher registry cannot be assembled from what exists; each
 *   source needs a real adapter written against its own orchestrator, which
 *   is its own slice of work with its own real-source fixtures.
 *
 * What WOULD happen if the walk ran on an empty registry — measured from the
 * code, not assumed: every rank pushes `NO_FETCHER_REGISTERED` into `failures`
 * and falls through (`field-plan-walk.ts`, the `!fetcher` branch in
 * `attemptOneField`), so the field reaches the all-ranks-failed branch, which
 * records `state: 'EXHAUSTED'` with `writeHappened: true`. `recordOutcome`
 * then charges `attempts = attempts + 1`, stamps `last_attempt_at`, and —
 * because 'EXHAUSTED' is in the repository's `TERMINAL_STATES` — sets
 * `next_due_at = NULL`. The cost is therefore not a wasted cycle: it is EVERY
 * field in the plan permanently retired without one source being asked.
 *
 * THE REFUSAL IS CODE, NOT THIS COMMENT. `fieldPlanWalkHasFetchers()` below is
 * called at PASS 3's entry in `document-cycle.ts` (the
 * `else if (!fieldPlanWalkHasFetchers())` arm), BEFORE the repository is
 * constructed and before any claim is taken — claiming and then failing would
 * still stamp `claimed_at` and burn backoff. The guard is held by
 * `tests/unit/services/document-cycle-pass3-guard.test.ts`, which asserts the
 * observable consequence (no claim is ever taken) rather than the log text,
 * and covers BOTH arms so the guard cannot degrade into a blanket off-switch.
 * The flag being on is not enough; the adapters are the second half.
 */

import { db, getRedisClient } from '@ipodhan/shared';
import {
  IPORepository,
  FieldSourcesRepository,
  DataConflictsRepository,
} from '@ipodhan/shared';
// Deep import, matching `filing-persist-deps.ts`: the barrel exports only the
// INTERFACE (`IListingPerformanceRepository`), not the class.
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { DataConsolidationOrchestrator } from './data-consolidation-orchestrator.js';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from './field-plan-walk.js';

/**
 * Item 1's consolidated writer, the SAME entry points every other write path
 * uses. The walk is a new CALLER above it, never a second write path.
 */
export function buildFieldPlanWalkOrchestrator(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): FieldPlanWalkOrchestrator {
  const ipoRepository = new IPORepository(db as never, redis as never);
  return new DataConsolidationOrchestrator(
    ipoRepository,
    new FieldSourcesRepository(db as never, redis as never),
    new DataConflictsRepository(db as never, redis as never),
    redis as never,
    new ListingPerformanceRepository(db as never, redis as never)
  ) as unknown as FieldPlanWalkOrchestrator;
}

/**
 * One fetcher per rank-eligible source, keyed exactly as the manifest names
 * the source (`NSE`, `BSE`, `CHITTORGARH`, `INVESTORGAIN_GMP`, …).
 *
 * EMPTY until the per-source adapters land — see this module's header. Kept
 * as a function rather than a constant so the adapters can be added one at a
 * time without changing PASS 3's call site.
 */
export function buildFieldPlanWalkFetchers(): Record<string, FieldFetcher> {
  return {};
}

/**
 * Whether PASS 3 has anything it can actually ask. `false` means the walk
 * would mark every field EXHAUSTED without a single source being consulted —
 * which is worse than not running, because EXHAUSTED is terminal.
 */
export function fieldPlanWalkHasFetchers(
  fetchers: Record<string, FieldFetcher> = buildFieldPlanWalkFetchers()
): boolean {
  return Object.keys(fetchers).length > 0;
}
