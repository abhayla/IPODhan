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
import { FieldSourceOverridesRepository } from '@ipodhan/shared/repositories/field-source-overrides-repository';
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { and, desc, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
// Deep import, matching `filing-persist-deps.ts`: the barrel exports only the
// INTERFACE (`IListingPerformanceRepository`), not the class.
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { DataConsolidationOrchestrator } from './data-consolidation-orchestrator.js';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from './field-plan-walk.js';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { createHash } from 'node:crypto';
import {
  buildFieldPlanIpoGapKeys,
  type FieldPlanGapKeySource,
  type GapKeyDocument,
  type GapKeyProvenance,
  type GapKeyOverride,
} from './field-plan-gap-keys.js';
import { buildDocFetcher, DOC_READABLE_TABLES, type DocFetcherDeps } from './field-plan-walk-doc-fetcher.js';
import { buildBseFetcher, BseFieldFetcherState, BSE_SERVEABLE_FIELDS } from './field-plan-walk-bse-fetcher.js';
import { buildNseFetcher, NseFieldFetcherState, NSE_SERVEABLE_FIELDS } from './field-plan-walk-nse-fetcher.js';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
  CHITTORGARH_SERVEABLE_FIELDS,
} from './field-plan-walk-chittorgarh-fetcher.js';
import {
  buildInvestorgainGmpFetcher,
  INVESTORGAIN_GMP_SERVEABLE_FIELDS,
  type GmpReader,
} from './field-plan-walk-investorgain-gmp-fetcher.js';

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
 * A direct, uncached read of `gmp_records`, filtered to the source the GMP
 * job (`createGMPRecord` in `data-persister.ts`) actually writes. Deliberately
 * NOT `GMPRepository.findLatest` — that method is cached
 * (`CacheTTL.GMP_LATEST`) and PASS 3 can run in the same wake as the GMP job
 * that just wrote a fresh row; see `field-plan-walk-investorgain-gmp-fetcher.ts`'s
 * own doc comment for the full reasoning.
 */
function makeGmpReader(): GmpReader {
  return {
    async findLatestFromInvestorGain(ipoId: string) {
      const rows = await db
        .select({ id: schema.gmpRecords.id, gmp: schema.gmpRecords.gmp, timestamp: schema.gmpRecords.timestamp })
        .from(schema.gmpRecords)
        .where(and(eq(schema.gmpRecords.ipoId, ipoId), eq(schema.gmpRecords.source, 'INVESTORGAIN_GMP')))
        .orderBy(desc(schema.gmpRecords.timestamp))
        .limit(1);
      return rows[0] ?? null;
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

/**
 * S3b-2: the default `trackWitnessVerdict` — the SAME `FieldSourcesRepository.trackFieldUpdate`
 * every other write path calls (field-sources-repository.ts), never a second writer. A fresh
 * `FieldSourcesRepository` here (rather than threading `buildFieldPlanWalkOrchestrator`'s own
 * instance out) matches this file's existing per-builder-function construction style (each
 * `build*` function opens its own repositories against the SAME `db`/`redis` singletons passed
 * in — no new Redis client, no new pool).
 */
export function buildFieldPlanWalkWitnessVerdictWriter(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): (input: {
  ipoId: string;
  tableName: string;
  rowKey: string;
  fieldName: string;
  source: string;
  witnesses: Array<{ source: string; value: unknown; at: string; docType?: string }>;
  verdict: string;
}) => Promise<unknown> {
  const fieldSources = new FieldSourcesRepository(db as never, redis as never);
  return (input) =>
    fieldSources.trackFieldUpdate({
      ipoId: input.ipoId,
      tableName: input.tableName,
      rowKey: input.rowKey,
      fieldName: input.fieldName,
      source: input.source as never,
      witnesses: input.witnesses,
      verdict: input.verdict,
    });
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

  const isCapable = (sourceKey: 'DOC' | 'NSE' | 'BSE' | 'CHITTORGARH' | 'INVESTORGAIN_GMP') => (tableName: string, fieldName: string) => {
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
    // Item 6 (OD-91): per-document receipts, probed (a DB before 0060 has none).
    receiptReader: async (ipoId: string) => {
      const { loadSupersessionInputs } = await import('./plan-supersession.js');
      const { db } = await import('@ipodhan/shared');
      return (await loadSupersessionInputs(db as never, ipoId)).receipts;
    },
  });

  const bseState = new BseFieldFetcherState();
  const bseFetcher = buildBseFetcher({ ipoRepository, isBseCapable: isCapable('BSE') }, bseState);
  const nseState = new NseFieldFetcherState();
  const nseFetcher = buildNseFetcher({ ipoRepository, isNseCapable: isCapable('NSE') }, nseState);

  const chittorgarhState = new ChittorgarhFieldFetcherState();
  const chittorgarhFetcher = buildChittorgarhFetcher(
    { ipoRepository, isChittorgarhCapable: isCapable('CHITTORGARH') },
    chittorgarhState
  );

  const investorgainGmpFetcher = buildInvestorgainGmpFetcher({
    gmpReader: makeGmpReader(),
    isInvestorgainGmpCapable: isCapable('INVESTORGAIN_GMP'),
  });

  return {
    // #705/#759: 57 manifest fields rank NSE, including the six E-1 fields
    // only the exchange may state. Without this entry every one of them
    // answered NO_FETCHER_REGISTERED on every wake.
    NSE: nseFetcher,
    DOC: docFetcher,
    BSE: bseFetcher,
    CHITTORGARH: chittorgarhFetcher,
    // Item 6 (this slice): `gmp_records.gmp` is the manifest's only field
    // ranking this source (rank 1, ahead of CHITTORGARH). Reads the value
    // the GMP job already wrote — no network call. See
    // `field-plan-walk-investorgain-gmp-fetcher.ts` for the full reasoning.
    INVESTORGAIN_GMP: investorgainGmpFetcher,
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

/**
 * #884: the fetcher-coverage part of the gap key — which sources have a
 * fetcher, which fields each exchange/aggregator adapter maps, which tables
 * DOC can read. A new mapping is a code change with no manifest edit, and it
 * must reopen the NO_MAPPING / NO_FETCHER / COLUMN_READ_NOT_IMPLEMENTED rows
 * it fixes.
 */
export function fieldPlanCoverageFingerprint(fetchers: Record<string, FieldFetcher>): string {
  const coverage = [
    `fetchers=${Object.keys(fetchers).sort().join(',')}`,
    `BSE=${[...BSE_SERVEABLE_FIELDS].sort().join(',')}`,
    `NSE=${[...NSE_SERVEABLE_FIELDS.keys()].sort().join(',')}`,
    `CHITTORGARH=${[...CHITTORGARH_SERVEABLE_FIELDS].sort().join(',')}`,
    `DOC=${[...DOC_READABLE_TABLES].sort().join(',')}`,
    `INVESTORGAIN_GMP=${[...INVESTORGAIN_GMP_SERVEABLE_FIELDS].sort().join(',')}`,
  ].join('|');
  return createHash('sha256').update(coverage).digest('hex').slice(0, 12);
}

/**
 * `table.field` (the manifest's own key shape) -> camelCase field name
 * `field_sources.field_name` actually stores — same conversion the DOC
 * fetcher's provenance read uses (its own doc comment: "field_sources.field_name
 * is camelCase ... not the snake_case column name").
 */
function splitFieldKey(fieldKey: string): { tableName: string; fieldName: string } {
  const dot = fieldKey.indexOf('.');
  return { tableName: fieldKey.slice(0, dot), fieldName: fieldKey.slice(dot + 1) };
}

/**
 * #884 review round 2: the live gap-key source, built once per cycle. Per IPO
 * it reads that IPO's documents (the same `DocumentRepository.findByIPO` the
 * DOC fetcher reads) and derives per-field keys from the field's own manifest
 * entry (`buildFieldPlanIpoGapKeys`). Extractor version passed in so this
 * module does not load the extractor.
 *
 * Round 3: also reads, per field, this IPO's `field_sources` provenance row
 * (`FieldSourcesRepository.findByField` — the SAME read the DOC fetcher
 * already does, cached, never a second write or a re-scrape, OD-33/OD-6) and
 * this field's active `field_source_overrides` row
 * (`FieldSourceOverridesRepository.listActiveFor` — the SAME table layer 2
 * of the resolver reads; ipo-scoped beats global, matching the resolver's own
 * precedence in `field-source-policy.ts`). Both are folded into the gap key
 * so a config-gap row reopens when either changes, not only when the
 * manifest, fetcher coverage or extractor version does.
 */
export function buildFieldPlanGapKeySource(params: {
  fetchers: Record<string, FieldFetcher>;
  extractorVersion: string;
  redis?: ReturnType<typeof getRedisClient>;
}): FieldPlanGapKeySource {
  const coverageFingerprint = fieldPlanCoverageFingerprint(params.fetchers);
  const manifestFields = loadFieldManifest().fields;
  const fieldKeys = Object.keys(manifestFields);
  const redis = (params.redis ?? getRedisClient()) as never;
  const documentRepository = new DocumentRepository(db as never, redis);
  const fieldSourcesRepository = new FieldSourcesRepository(db as never, redis);
  const overridesRepository = new FieldSourceOverridesRepository({ db: db as never });
  return {
    async forIpo(ipoId: string) {
      const documents = (await documentRepository.findByIPO(ipoId)) as unknown as GapKeyDocument[];

      const provenanceByField: Record<string, GapKeyProvenance | null> = {};
      const overrideByField: Record<string, GapKeyOverride | null> = {};
      await Promise.all(
        fieldKeys.map(async (fieldKey) => {
          const { tableName, fieldName } = splitFieldKey(fieldKey);
          const camelFieldName = columnToCamelCase(fieldName);

          const [provenance, activeOverrides] = await Promise.all([
            fieldSourcesRepository.findByField(ipoId, tableName, camelFieldName, ''),
            overridesRepository.listActiveFor(tableName, fieldName),
          ]);

          provenanceByField[fieldKey] = provenance
            ? { source: provenance.source, documentId: (provenance.dataLineage as { documentId?: string } | null)?.documentId ?? null }
            : null;

          // Same precedence as the resolver (`field-source-policy.ts`
          // `resolveFieldSourcePolicyAsync`): an ipo-scoped row beats a
          // global one; newest `setAt` (the repository's own DESC order)
          // breaks ties among rows of the same scope.
          const matching = activeOverrides.filter((row) => row.ipoId === null || row.ipoId === ipoId);
          const winner = matching.find((row) => row.ipoId !== null) ?? matching[0];
          overrideByField[fieldKey] = winner ? { id: winner.id } : null;
        })
      );

      return buildFieldPlanIpoGapKeys({
        manifestFields: manifestFields as never,
        coverageFingerprint,
        extractorVersion: params.extractorVersion,
        documents,
        provenanceByField,
        overrideByField,
      });
    },
  };
}
