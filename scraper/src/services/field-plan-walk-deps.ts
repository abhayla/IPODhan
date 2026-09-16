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
 * THE GAP THIS FILE USED TO DECLARE, AND WHAT CLOSES IT (stage 2, ruling 33).
 * `buildFieldPlanWalkFetchers()` used to return an EMPTY registry — a
 * deliberate, declared gap, because the walk asks a source for ONE field of
 * ONE row while every scraper orchestrator is built the other way round
 * (fetch a whole IPO/document, hand it to the consolidated writer). This
 * slice adds the three adapters today's staging plan actually needs — DOC,
 * BSE, CHITTORGARH — each a THIN caller over the existing whole-source entry
 * point (`buildDocFetcher` reads `field_sources` provenance the filing
 * persister already wrote, never re-reading a PDF — OD-33; `buildBseFetcher`
 * / `buildChittorgarhFetcher` call `fetchBSEBoard`/`fetchBSEDetail` and
 * `scrapeChittorgarhIPOs` — the SAME functions `scrapeBSEViaAPI` and the
 * Chittorgarh orchestrator use — at most once per cycle via a per-cycle memo,
 * ruling 33). NSE and INVESTORGAIN_GMP have no adapter yet; see
 * `buildFieldPlanWalkFetchers`'s own doc comment for what that means for a
 * plan row ranking them.
 *
 * F1's fix in `field-plan-walk.ts` (see that file's `sawTransientFailure`
 * comment) means an UNREGISTERED source no longer risks the EXHAUSTED
 * data-destruction this comment used to describe for an EMPTY registry — a
 * missing adapter classifies TRANSIENT and the field stays PENDING on
 * backoff. `fieldPlanWalkHasFetchers()` below still gates PASS 3's entry in
 * `document-cycle.ts` (the `else if (!fieldPlanWalkHasFetchers())` arm): with
 * SOME adapters registered it is a much smaller "don't churn every field for
 * work no source is registered to do" guard, not a data-destruction guard —
 * see that call site's own comment. The guard is held by
 * `tests/unit/services/document-cycle-pass3-guard.test.ts`.
 */

import { db, getRedisClient } from '@ipodhan/shared';
import {
  IPORepository,
  FieldSourcesRepository,
  DataConflictsRepository,
  DocumentRepository,
} from '@ipodhan/shared';
import { eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
// Deep import, matching `filing-persist-deps.ts`: the barrel exports only the
// INTERFACE (`IListingPerformanceRepository`), not the class.
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { DataConsolidationOrchestrator } from './data-consolidation-orchestrator.js';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from './field-plan-walk.js';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { buildDocFetcher, type DocFetcherDeps } from './field-plan-walk-doc-fetcher.js';
import { buildBseFetcher, BseFieldFetcherState } from './field-plan-walk-bse-fetcher.js';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
} from './field-plan-walk-chittorgarh-fetcher.js';

/**
 * Review round 1, m1: `ipo_details` has no shared repository class —
 * `filing-persist-deps.ts`'s `makeIpoDetailsWriter` comment says so verbatim
 * ("ipo_details has no repository - this is the single write path for it").
 * This is the READ-side equivalent, same direct-query convention, so the
 * walk's DOC fetcher can answer for `ipo_details` fields instead of treating
 * every one of them as unreadable.
 */
function makeIpoDetailsReader(): DocFetcherDeps['ipoDetailsReader'] {
  return {
    async findByIpoId(ipoId: string) {
      const rows = await db
        .select()
        .from(schema.ipoDetails)
        .where(eq(schema.ipoDetails.ipoId, ipoId))
        .limit(1);
      return (rows[0] as unknown as Record<string, unknown>) ?? null;
    },
  };
}

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

/** `${tableName}.${fieldName}` -> the manifest entry, built once and reused by every lookup below. */
function manifestFieldEntry(tableName: string, fieldName: string) {
  const manifest = loadFieldManifest();
  return manifest.fields[`${tableName}.${fieldName}`];
}

/**
 * One fetcher per rank-eligible source, keyed exactly as the manifest names
 * the source (`NSE`, `BSE`, `CHITTORGARH`, `INVESTORGAIN_GMP`, …).
 *
 * Stage 2 (this slice) wires DOC, BSE and CHITTORGARH — the three sources
 * every field in today's staging plan actually ranks (`ipos.issue_size`,
 * `ipo_details.fresh_issue`/`.ofs_issue`/`.min_investment`,
 * `financial_statements.revenue`). NSE (subscriptions/listing_performance)
 * and INVESTORGAIN_GMP have no adapter yet — a plan row ranking either one
 * exclusively still answers `NO_FETCHER_REGISTERED` (`field-plan-walk.ts`'s
 * `!fetcher` branch), which is TRANSIENT (F1), not terminal: those rows stay
 * PENDING on backoff until their adapters land, never EXHAUSTED.
 *
 * Called once per cycle (`buildFieldPlanWalkOrchestrator`'s own doc comment:
 * "PASS 3 builds it once per cycle") — the per-source memo state
 * (`BseFieldFetcherState`, `ChittorgarhFieldFetcherState`) is constructed
 * HERE, once, and closed over by the returned fetcher functions, so a
 * whole-source fetch (ruling 33) happens at most once across every IPO's
 * walk in this wake, never once per field or once per IPO.
 */
export function buildFieldPlanWalkFetchers(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): Record<string, FieldFetcher> {
  const ipoRepository = new IPORepository(db as never, redis as never);
  const fieldSources = new FieldSourcesRepository(db as never, redis as never);
  const documentRepository = new DocumentRepository(db as never, redis as never);

  const isCapable = (sourceKey: 'DOC' | 'BSE' | 'CHITTORGARH') => (tableName: string, fieldName: string) => {
    const entry = manifestFieldEntry(tableName, fieldName);
    return entry?.capability?.[sourceKey]?.capable === true;
  };

  const docFetcher = buildDocFetcher({
    fieldSources,
    ipoRepository,
    documentRepository,
    manifestDocumentType: (tableName, fieldName) => manifestFieldEntry(tableName, fieldName)?.documentType,
    isDocCapable: isCapable('DOC'),
    ipoDetailsReader: makeIpoDetailsReader(),
  });

  const bseState = new BseFieldFetcherState();
  const bseFetcher = buildBseFetcher({ ipoRepository, isBseCapable: isCapable('BSE') }, bseState);

  const chittorgarhState = new ChittorgarhFieldFetcherState();
  const chittorgarhFetcher = buildChittorgarhFetcher(
    { ipoRepository, isChittorgarhCapable: isCapable('CHITTORGARH') },
    chittorgarhState
  );

  return {
    DOC: docFetcher,
    BSE: bseFetcher,
    CHITTORGARH: chittorgarhFetcher,
  };
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
