/**
 * Data Consolidation Orchestrator
 * Wraps the data persister with intelligent consolidation logic
 *
 * This module acts as a bridge between scrapers and the database,
 * integrating the consolidation service to enable smart multi-source merging.
 *
 * Flow:
 * 1. Scraper provides new data
 * 2. Acquire distributed lock for the IPO
 * 3. Fetch existing data from database
 * 4. Use consolidation service to merge
 * 5. Persist consolidated data
 * 6. Track field sources
 * 7. Log conflicts
 * 8. Release lock
 */

import type {
  IPORepository,
  SubscriptionRepository,
  IPOInsert,
  IPO,
} from '@ipodhan/shared';
import { resolveIpoRow } from '@ipodhan/shared/repositories';
import logger from '../utils/logger.js';
import type { ScrapedIPO } from '../utils/validators.js';
import { computeIpoIdentitySlug } from './data-persister.js';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { resolveOfferingTypeKeepingClassification, guardSmeOfferingTypeAgainstFpo } from '../utils/detect-offering-type.js';
import { isAuthoritativeForHardDatesOnCreate } from '../utils/hard-date-source-trust.js';
import type { ScraperSource } from '../config/field-priority-matrix';
import { DataConsolidationService } from './data-consolidation-service.js';
import type { ConsolidationResult } from './data-consolidation-service.js';
import {
  DistributedLock,
  LOCK_DEFAULTS,
} from '../utils/distributed-lock.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import {
  toListingExchangesForSource,
  violatesSmeSingleExchange,
} from './listing-exchange-resolution.js';
import { initStepLedger } from './step-ledger.js';
import { recordDiscoverySteps } from './step-ledger-recorders.js';
import { recordTouchedIfChanged } from './touched-ipos-tracker.js';
import type { Redis } from 'ioredis';

/**
 * Result of consolidated upsert operation
 */
export interface ConsolidatedUpsertResult {
  ipoId: string;
  isNew: boolean;
  consolidation?: ConsolidationResult;
  locked: boolean;
  skipped: boolean;
  skipReason?: string;
}

/**
 * The eight child tables item 1 brings onto the consolidated write path.
 * Slice s5b wires `financial_statements` only; the rest are listed so the
 * type is the card's contract rather than this slice's subset.
 */
export type ChildConsolidationTable =
  | 'ipo_details'
  | 'financial_statements'
  | 'ipo_valuation'
  | 'ipo_risk_factors'
  | 'promoters'
  | 'anchor_investors'
  | 'ipo_intermediaries'
  | 'peer_companies';

/**
 * Tables with structurally ONE row per IPO. Only these may legitimately carry
 * the `''` row key — for any other table `''` means "the caller could not key
 * this row", which is a skip, not a write.
 */
const SINGLETON_ROW_CHILD_TABLES: ReadonlySet<string> = new Set([
  'ipo_details',
  'anchor_investors',
]);

/** One incoming child row, already keyed by the caller. */
export interface ChildRowInput {
  /**
   * The row's natural key, matching that table's own unique constraint (see
   * `child-row-keys.ts`). `''` ONLY for a singleton table.
   */
  rowKey: string;
  /** The row's primary-key id when it already exists (undefined = new row). */
  existingRowId?: string;
  /** The fields THIS source supplies for this row — not the merged row. */
  data: Record<string, any>;
  /** The stored values for this row, when the caller has already read them. */
  existingData?: Record<string, any>;
}

/** Per-row outcome of `consolidatedUpsertChildRows`. */
export interface ChildRowConsolidationResult {
  rowKey: string;
  existingRowId?: string;
  /** Resolved values, field by field. Empty when the row was skipped. */
  consolidatedData: Record<string, any>;
  fieldsProcessed: number;
  fieldsUpdated: number;
  conflictsDetected: number;
  skipped: boolean;
  skipReason?: 'MISSING_ROW_KEY' | 'CHILD_TABLE_CONSOLIDATION_DISABLED';
}

/**
 * Aggregate result. A superset of the item-1 card's
 * `{ rowsProcessed, rowsUpdated, conflictsDetected }`: `rows` carries the
 * resolved values the caller needs in order to write the row, and
 * `rowsSkipped` makes a refused row a counted outcome rather than silence.
 */
export interface ConsolidatedChildRowsResult {
  rowsProcessed: number;
  rowsUpdated: number;
  rowsSkipped: number;
  conflictsDetected: number;
  rows: ChildRowConsolidationResult[];
}

/**
 * Data Consolidation Orchestrator
 * Manages the complete consolidation workflow
 */
export class DataConsolidationOrchestrator {
  private consolidationService: DataConsolidationService;
  private distributedLock: DistributedLock;

  constructor(
    private ipoRepository: IPORepository,
    private fieldSourcesRepository: any, // from web
    private dataConflictsRepository: any, // from web
    private redis: Redis | null,
    // W-145 round 2: OPTIONAL. Supplies the strongest evidence tier for the SME
    // single-exchange collapse (`listing_performance.exchange`). Omitted =>
    // that tier is simply unavailable, the weaker tiers still apply.
    listingPerformanceRepository?: { findByIPO(ipoId: string): Promise<any> }
  ) {
    this.consolidationService = new DataConsolidationService(
      fieldSourcesRepository,
      dataConflictsRepository,
      listingPerformanceRepository
    );
    this.distributedLock = new DistributedLock(redis);
  }

  /**
   * Consolidated upsert for IPO data
   * Integrates distributed locking and data consolidation
   */
  async consolidatedUpsertIPO(
    scrapedIPO: ScrapedIPO,
    source: ScraperSource,
    confidence: number = 100,
    // T-307 (write-path hardening Phase 1, §2(a) step 1): when the caller
    // (BaseScraperOrchestrator's guard) has already resolved identity once
    // for this request, pass that SAME resolved row so this write never
    // re-resolves independently. `undefined` (the default) means "no
    // pre-resolution supplied" — resolve it here, as before, for callers
    // that invoke this method directly.
    preResolvedIPO?: IPO | null
  ): Promise<ConsolidatedUpsertResult> {
    const startTime = Date.now();
    // T-478 round 3 (item 3): OFS-aware slug (see computeIpoIdentitySlug's
    // doc comment) — both the identity-resolution lookup key below AND the
    // create-branch insert slug (line ~237) use this SAME value, so a
    // repeat explicit-OFS scrape can find its own row via tier 4 too.
    const slug = computeIpoIdentitySlug(scrapedIPO as any);

    // Check if consolidation is enabled
    if (!FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
      // Fallback: Use traditional upsert (will be called by orchestrator)
      return {
        ipoId: '',
        isNew: false,
        skipped: true,
        locked: false,
        skipReason: 'CONSOLIDATION_DISABLED',
      };
    }

    // Acquire distributed lock for this IPO
    const lockResult = await this.distributedLock.acquire(slug, {
      ttl: LOCK_DEFAULTS.CONSOLIDATION_TTL,
      retryAttempts: LOCK_DEFAULTS.RETRY_ATTEMPTS,
      retryDelay: LOCK_DEFAULTS.RETRY_DELAY,
      debug: FEATURE_FLAGS.DEBUG_DATA_FLOW,
    });

    if (!lockResult.acquired) {
      logger.warn(
        { slug, source },
        '[DataConsolidation] Could not acquire lock, skipping consolidation'
      );
      return {
        ipoId: '',
        isNew: false,
        skipped: true,
        locked: false,
        skipReason: 'LOCK_NOT_ACQUIRED',
      };
    }

    try {
      // T-307: single source of truth for "which row is this?" — resolveIpoRow
      // runs the same tiered lookup shared with the protection guard and
      // data-persister.upsertIPO, so this path can no longer diverge from
      // either of them. T-318 (IDENT): key-first (isin -> symbol) before
      // name/slug/fuzzy — this is the main consolidated-write path every
      // real-time scrape goes through, so isin/symbol MUST be threaded here
      // (not just in the secondary backfill scripts) for the key-first tiers
      // to actually fire on production writes.
      const normalizedName = normalizeCompanyNameForMatching(scrapedIPO.companyName);
      const existingIPO: IPO | null = preResolvedIPO !== undefined
        ? preResolvedIPO
        : await resolveIpoRow(this.ipoRepository, {
            companyName: scrapedIPO.companyName,
            normalizedName,
            slug,
            isin: scrapedIPO.isin,
            symbol: scrapedIPO.symbol,
            openDate: scrapedIPO.openDate ?? null,
            priceRangeMin: scrapedIPO.priceRangeMin ?? null,
            segment: scrapedIPO.segment ?? null,
            // T-478 round 3: only an EXPLICITLY classified offeringType
            // guards identity — see BaseScraperOrchestrator.ts for the
            // full rationale.
            offeringType: (scrapedIPO as any).offeringTypeExplicit ? scrapedIPO.offeringType : undefined,
          }) as IPO | null;
      const isNew = !existingIPO;

      if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
        logger.debug({
          slug,
          source,
          isNew,
          existingIPO: existingIPO ? existingIPO.id : null,
        }, '[DataConsolidation] Starting consolidation');
      }

      // Prepare incoming data for consolidation
      const incomingData = this.mapScrapedIPOToConsolidationInput(scrapedIPO, source);

      // Consolidate IPO main table data
      const consolidationResult =
        await this.consolidationService.consolidateIPOData({
          ipoId: existingIPO?.id || 'new',
          tableName: 'ipos',
          incomingData,
          source,
          existingData: existingIPO ? this.mapIPOToRecord(existingIPO) : undefined,
          confidence,
        });

      if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
        logger.debug({
          slug,
          fieldsProcessed: consolidationResult.fieldsProcessed,
          fieldsUpdated: consolidationResult.fieldsUpdated,
          conflictsDetected: consolidationResult.conflictsDetected,
          performanceMs: consolidationResult.performanceMs,
        }, '[DataConsolidation] Consolidation complete');
      }

      // Extract consolidated values for database insert/update
      const consolidatedIPOData = this.extractConsolidatedData(
        consolidationResult,
        scrapedIPO,
        source,
        existingIPO
      );

      // Protect an authoritative corporate-action classification from being downgraded to a
      // generic 'IPO' by a scraper that defaults to it (the */30 cron otherwise re-pollutes
      // the IPO listings every run). A specific classification MUST win over a generic IPO.
      const keptType = resolveOfferingTypeKeepingClassification(
        existingIPO?.offeringType,
        consolidatedIPOData.offeringType as string
      );
      if (existingIPO && keptType !== consolidatedIPOData.offeringType) {
        logger.info(
          { slug, source, kept: keptType },
          '[DataConsolidation] Preserved corporate-action classification — scraper IPO downgrade blocked'
        );
        consolidatedIPOData.offeringType = keptType as any;
      }

      // #180 Tier-A round (T-459): this is `consolidatedUpsertIPO` — the LIVE
      // Phase-1 door every scraper actually goes through (BaseScraperOrchestrator
      // Step 5), distinct from `upsertIPO` in data-persister.ts (only reached on
      // a consolidation skip/fallback). It never applied the SME/FPO guard or the
      // hard-date create guard at all — this is Mopshop Distribution's actual
      // write path. Corroboration-gated the same way as data-persister.ts: only
      // flip when the CURRENT stored value's provenance is not the exchange
      // itself (NSE/BSE).
      if (consolidatedIPOData.offeringType) {
        const effectiveSegment = 'segment' in consolidatedIPOData
          ? (consolidatedIPOData as any).segment
          : (existingIPO?.segment ?? null);
        let offeringTypeSource: string | null = null;
        if (existingIPO && this.fieldSourcesRepository?.findByField) {
          try {
            const prov = await this.fieldSourcesRepository.findByField(existingIPO.id, 'ipos', 'offeringType');
            offeringTypeSource = prov?.source ?? null;
          } catch (e) {
            logger.warn({ slug, error: e instanceof Error ? e.message : String(e) }, '[DataConsolidation] #180 F1 provenance lookup failed - guarding without corroboration signal');
          }
        }
        // #180 Tier-A round 5: trust EITHER this scrape's own `source` (the
        // bootstrap shape — no stored provenance yet, exchange asserting now)
        // OR the stored value's provenance (checked above).
        (consolidatedIPOData as any).offeringType = guardSmeOfferingTypeAgainstFpo(
          effectiveSegment,
          consolidatedIPOData.offeringType as string,
          source,
          offeringTypeSource
        );
      }

      // #180 Tier-A round (T-459): same create-only hard-date trust guard as
      // data-persister.ts's upsertIPO — a brand-new row here had NO equivalent
      // protection at all.
      if (isNew && !isAuthoritativeForHardDatesOnCreate(source)) {
        delete (consolidatedIPOData as any).openDate;
        delete (consolidatedIPOData as any).closeDate;
        delete (consolidatedIPOData as any).listingDate;
      }

      let ipoId: string;

      // W-104: `slug` MUST be written only on the create branch below.
      // `consolidatedIPOData` (from `extractConsolidatedData`) never carries a
      // `slug` key — `mapScrapedIPOToConsolidationInput` never puts one into
      // `incomingData` — so the update branch's `ipoRepository.update()` call
      // structurally cannot touch the stored slug. Keep it that way: never add
      // `slug` to `mapScrapedIPOToConsolidationInput`/`extractConsolidatedData`,
      // or a companyName correction from any non-ADMIN source will silently
      // re-slug an existing row (see the parallel guard + incident note in
      // `data-persister.ts` `upsertIPO`).
      if (isNew) {
        // Create new IPO
        const newIPO = await this.ipoRepository.create({
          ...consolidatedIPOData,
          slug,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as IPOInsert);

        ipoId = newIPO.id;

        logger.info(
          { slug, source, ipoId },
          '[DataConsolidation] Created new IPO with consolidated data'
        );
      } else {
        // Update existing IPO
        await this.ipoRepository.update(existingIPO.id, {
          ...consolidatedIPOData,
          updatedAt: new Date(),
        });

        ipoId = existingIPO.id;

        logger.info(
          {
            slug,
            source,
            ipoId,
            fieldsUpdated: consolidationResult.fieldsUpdated,
            conflictsDetected: consolidationResult.conflictsDetected,
          },
          '[DataConsolidation] Updated IPO with consolidated data'
        );
      }

      const duration = Date.now() - startTime;

      if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
        logger.debug({
          slug,
          ipoId,
          duration,
          consolidationMs: consolidationResult.performanceMs,
          totalMs: duration,
        }, '[DataConsolidation] Upsert complete');
      }

      // S-02 hook — the step ledger (B1..B7, F1/F2/F4/F5/F6).
      //
      // THIS is the door the live orchestrators actually use.
      // `BaseScraperOrchestrator` writes through here, NOT through
      // `data-persister.upsertIPO`, so a hook placed only on that function fires
      // for backfill scripts and never for a real scrape — which is exactly what
      // the S-02 proof run caught: after NSE and BSE both wrote Rays of Belief,
      // its ledger still had no B rows. Both doors are hooked, because "the write
      // path" is two functions, not one.
      //
      // Best-effort, after the primary write, like every other post-write side
      // effect (`non-fatal-side-effects.md`).
      try {
        if (isNew) await initStepLedger(ipoId);
        await recordDiscoverySteps(ipoId, {
          source,
          created: isNew,
          fields: Object.keys(consolidatedIPOData),
          offeringType: (consolidatedIPOData as { offeringType?: string }).offeringType ?? null,
          consolidated: true,
          conflictsDetected: consolidationResult.conflictsDetected ?? 0,
          conflictsBySeverity: consolidationResult.conflictsBySeverity ?? {},
          fieldSourcesWritten: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
          companyName: scrapedIPO.companyName,
        });
      } catch (ledgerError) {
        logger.warn(
          {
            ipoId,
            source,
            error: ledgerError instanceof Error ? ledgerError.message : String(ledgerError),
          },
          '[DataConsolidation] step-ledger write failed (non-fatal)'
        );
      }

      const result: ConsolidatedUpsertResult = {
        ipoId,
        isNew,
        consolidation: consolidationResult,
        locked: true,
        skipped: false,
      };

      // Item 21 slice 1 (OD-40). This is the single write choke point CLAUDE.md
      // names, so it is the only honest place to answer "which IPOs did this
      // cycle change?". Recorded from the SAME result the caller receives, so
      // the answer cannot drift from what was actually written, and only when a
      // field really changed - a re-verify that rewrote nothing must not put a
      // page in the refresh list. Deliberately not in a try/catch: it is a
      // Set.add on an in-process Set with no I/O and nothing to fail.
      recordTouchedIfChanged(slug, result);

      return result;
    } catch (error) {
      logger.error(
        {
          slug,
          source,
          error: error instanceof Error ? error.message : String(error),
        },
        '[DataConsolidation] Failed to consolidate and upsert IPO'
      );

      // Return error result
      return {
        ipoId: '',
        isNew: false,
        skipped: true,
        locked: true,
        skipReason: 'ERROR: ' + (error instanceof Error ? error.message : String(error)),
      };
    } finally {
      // Always release lock
      if (lockResult.token) {
        await this.distributedLock.release(slug, lockResult.token);
      }
    }
  }

  /**
   * Map ScrapedIPO to consolidation input format
   */
  private mapScrapedIPOToConsolidationInput(
    scrapedIPO: ScrapedIPO,
    source: ScraperSource
  ): Record<string, any> {
    // W-145: the incoming record used to carry `listingExchange` (SINGULAR)
    // while the stored record carries `listingExchanges` (PLURAL), so the
    // consolidator never compared like with like and the field escaped every
    // priority/merge rule. The singular key is mapped to the canonical array
    // HERE, at the one boundary, and the singular spelling never enters the
    // record shape again. `undefined` (unknown) is OMITTED entirely, so the
    // absent-never-overwrites-present guard keeps the stored value.
    const listingExchanges = toListingExchangesForSource(scrapedIPO.listingExchange, source);

    return {
      companyName: scrapedIPO.companyName,
      segment: scrapedIPO.segment,
      offeringType: scrapedIPO.offeringType,
      sector: scrapedIPO.sector,
      issueSize: scrapedIPO.issueSize,
      priceRangeMin: scrapedIPO.priceRangeMin,
      priceRangeMax: scrapedIPO.priceRangeMax,
      lotSize: scrapedIPO.lotSize,
      faceValue: scrapedIPO.faceValue,
      status: scrapedIPO.status,
      openDate: scrapedIPO.openDate,
      closeDate: scrapedIPO.closeDate,
      allotmentDate: scrapedIPO.allotmentDate,
      listingDate: scrapedIPO.listingDate,
      companyDescription: scrapedIPO.companyDescription,
      registrar: scrapedIPO.registrar,
      leadManagers: scrapedIPO.leadManagers,
      ...(listingExchanges ? { listingExchanges } : {}),
      symbol: scrapedIPO.symbol,
      isin: scrapedIPO.isin,
    };
  }

  /**
   * Map database IPO record to consolidation input format
   */
  private mapIPOToRecord(ipo: any): Record<string, any> {
    return {
      companyName: ipo.companyName,
      segment: ipo.segment,
      offeringType: ipo.offeringType,
      sector: ipo.sector,
      issueSize: ipo.issueSize,
      priceRangeMin: ipo.priceRangeMin,
      priceRangeMax: ipo.priceRangeMax,
      lotSize: ipo.lotSize,
      faceValue: ipo.faceValue,
      status: ipo.status,
      openDate: ipo.openDate,
      closeDate: ipo.closeDate,
      allotmentDate: ipo.allotmentDate,
      listingDate: ipo.listingDate,
      companyDescription: ipo.companyDescription,
      registrar: ipo.registrar,
      leadManagers: ipo.leadManagers,
      listingExchanges: ipo.listingExchanges,
      symbol: ipo.symbol,
      isin: ipo.isin,
    };
  }

  /**
   * Extract consolidated values from consolidation result
   */
  private extractConsolidatedData(
    result: ConsolidationResult,
    originalScraped: ScrapedIPO,
    source: ScraperSource,
    existingIPO?: IPO | null
  ): Partial<IPOInsert> {
    const consolidated: any = {};

    // Extract final values from consolidation result
    for (const fieldResult of result.fieldResults) {
      consolidated[fieldResult.fieldName] = fieldResult.finalValue;
    }

    // W-177 round 2 (CRITICAL-1): a field can be missing from `consolidated`
    // for two entirely different reasons, and only ONE of them may fall back
    // to the raw scrape:
    //   (a) consolidation never evaluated the field a value for (honest gap —
    //       e.g. this source's incoming value is genuinely undefined and
    //       there is no stored value either) -> falling back to
    //       `originalScraped.<field>` is a no-op (it's the same undefined).
    //   (b) consolidation evaluated the incoming value and REJECTED it
    //       (T-329 implausible issueSize, DEGENERATE_PRICE_BAND,
    //       VALIDATION_FAILED, TERMINAL_STATUS_KEPT, a lost priority
    //       resolution, ...) -> `finalValue` is the correct answer (often
    //       `undefined`/NULL on a brand-new row with nothing stored yet) and
    //       falling back to `originalScraped.<field>` re-admits the EXACT
    //       value the guard just refused. This was the door Shanti's raw
    //       share count (5,691,200) walked through as `issueSize`.
    // `rejectedSources` always names the incoming source when the incoming
    // value itself was refused (see data-consolidation-service.ts), so any
    // field with a rejectedSources entry naming THIS call's `source` is case
    // (b) — never fall back to the raw scrape for it.
    const rejectedFields = new Set<string>();
    for (const fieldResult of result.fieldResults) {
      if (fieldResult.rejectedSources?.some((r) => r.source === source)) {
        rejectedFields.add(fieldResult.fieldName);
      }
    }
    const fallback = <T>(fieldName: string, value: T): T | undefined =>
      rejectedFields.has(fieldName) ? undefined : value;

    // Ensure required fields have values
    return {
      companyName: consolidated.companyName || fallback('companyName', originalScraped.companyName),
      segment: consolidated.segment ?? fallback('segment', originalScraped.segment) ?? null,
      offeringType: consolidated.offeringType || fallback('offeringType', originalScraped.offeringType),
      sector: consolidated.sector,
      // T-329: issueSize is optional on ScrapedIPO (a source may genuinely
      // have no rupee-convertible value) — `?.toString()` on both sides
      // avoids a TypeError when neither side has a value, leaving it
      // undefined so data-persister.ts's coercePositiveOrNull writes NULL.
      // W-177 round 2: a REJECTED issueSize never falls back to the raw
      // scrape — see `rejectedFields` above.
      issueSize: consolidated.issueSize?.toString() ?? fallback('issueSize', originalScraped.issueSize)?.toString(),
      priceRangeMin: consolidated.priceRangeMin,
      priceRangeMax: consolidated.priceRangeMax,
      lotSize: consolidated.lotSize,
      faceValue: consolidated.faceValue,
      status: consolidated.status || fallback('status', originalScraped.status),
      openDate: consolidated.openDate || fallback('openDate', originalScraped.openDate),
      closeDate: consolidated.closeDate || fallback('closeDate', originalScraped.closeDate),
      allotmentDate: consolidated.allotmentDate,
      listingDate: consolidated.listingDate,
      companyDescription: consolidated.companyDescription,
      registrar: consolidated.registrar,
      leadManagers: consolidated.leadManagers,
      listingExchanges: this.extractListingExchanges(consolidated, originalScraped, source, existingIPO),
      symbol: consolidated.symbol,
      isin: consolidated.isin,
      lastScrapedAt: new Date(),
    } as Partial<IPOInsert>;
  }

  /**
   * W-145: the consolidated `listingExchanges` (union of exchange
   * self-assertions, resolved by the matrix) is the value; this only decides
   * what to write when consolidation produced nothing for the field.
   *
   * The old body read the SINGULAR key off the consolidated record — a key the
   * consolidator never produced — so it always fell back to the raw scrape and
   * wrote `['NSE','BSE']` for any source that hard-coded 'BOTH', overwriting a
   * correct single-board value on every cycle.
   *
   * `undefined` is returned (not `[]`) when nothing is known, so
   * `buildNonDestructiveUpdate` / the repository leave the stored column alone.
   */
  private extractListingExchanges(
    consolidated: any,
    originalScraped: ScrapedIPO,
    source: ScraperSource,
    existingIPO?: IPO | null
  ): ('NSE' | 'BSE')[] | undefined {
    const stored = (existingIPO?.listingExchanges as ('NSE' | 'BSE')[] | null | undefined) ?? undefined;
    const resolved: ('NSE' | 'BSE')[] | undefined =
      (Array.isArray(consolidated.listingExchanges) && consolidated.listingExchanges.length > 0
        ? consolidated.listingExchanges
        : undefined) ??
      toListingExchangesForSource(originalScraped.listingExchange, source) ??
      stored;

    if (resolved === undefined) return undefined;

    // SME invariant, last line of defence on the write itself: an SME issue
    // lists on exactly one board. The consolidator already refuses to MERGE a
    // second exchange onto an SME row (and logs the conflict); if a two-board
    // value still reaches here, keep the stored single board rather than write
    // the violation.
    const segment = (consolidated.segment ?? originalScraped.segment ?? existingIPO?.segment) as
      | string
      | null
      | undefined;
    if (violatesSmeSingleExchange(segment, resolved)) {
      logger.warn(
        { source, segment, resolved, stored },
        '[DataConsolidation] W-145 SME single-exchange invariant — refusing to write two exchanges'
      );
      return stored && stored.length === 1 ? stored : undefined;
    }

    return resolved;
  }

  /**
   * Get consolidation statistics for an IPO
   */
  async getIPOConsolidationStats(ipoId: string) {
    return this.consolidationService.getConsolidationStats(ipoId);
  }

  /**
   * Item 1 slice s5b — the consolidated CHILD-row writer.
   *
   * `consolidatedUpsertIPO` above resolves one field set for one `ipos` row.
   * A child table holds MANY rows per IPO, so resolution has to run once per
   * (row, field) pair, scoped by the row's natural key — otherwise FY2023's
   * stored revenue is read as FY2024's "existing value" and one year's number
   * is kept against a value it never held.
   *
   * This method DECIDES values and writes provenance; it does NOT write the
   * child row itself. The caller already holds that table's repository and its
   * unit/protection rules, and keeping the row write there is what lets the
   * flag-off path stay byte-identical to the pre-slice code.
   *
   * Currently wired for `financial_statements` only (slice scope). The other
   * tables on the item-1 card still take their old path.
   */
  async consolidatedUpsertChildRows(
    ipoId: string,
    tableName: ChildConsolidationTable,
    rows: ChildRowInput[],
    source: ScraperSource,
    docType?: string,
    confidence: number = 100
  ): Promise<ConsolidatedChildRowsResult> {
    const result: ConsolidatedChildRowsResult = {
      rowsProcessed: 0,
      rowsUpdated: 0,
      rowsSkipped: 0,
      conflictsDetected: 0,
      rows: [],
    };

    // Defence in depth. The call site branches on this flag too (that is what
    // keeps the OFF path byte-identical); this second check means a future
    // caller that forgets the branch cannot silently start writing provenance
    // under a flag its operator believes is off.
    if (!FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION) {
      for (const row of rows) {
        result.rowsSkipped += 1;
        result.rows.push({
          rowKey: row.rowKey,
          existingRowId: row.existingRowId,
          consolidatedData: {},
          fieldsProcessed: 0,
          fieldsUpdated: 0,
          conflictsDetected: 0,
          skipped: true,
          skipReason: 'CHILD_TABLE_CONSOLIDATION_DISABLED',
        });
      }
      return result;
    }

    for (const row of rows) {
      const rowKey = typeof row.rowKey === 'string' ? row.rowKey.trim() : '';

      // A keyless row must never be written under `''`: that is the reserved
      // sentinel for one-row-per-IPO tables, so every keyless row of a
      // multi-row table would collide there and overwrite the others'
      // provenance under the widened unique key. Skip it, count it, and say
      // why — a throw here would abort the whole IPO's persistence for one
      // malformed row, which loses strictly more data than skipping one row.
      if (rowKey === '' && !SINGLETON_ROW_CHILD_TABLES.has(tableName)) {
        result.rowsSkipped += 1;
        result.rows.push({
          rowKey: '',
          existingRowId: row.existingRowId,
          consolidatedData: {},
          fieldsProcessed: 0,
          fieldsUpdated: 0,
          conflictsDetected: 0,
          skipped: true,
          skipReason: 'MISSING_ROW_KEY',
        });
        logger.error(
          { ipoId, tableName, source, docType, fields: Object.keys(row.data ?? {}) },
          '[DataConsolidation] child row has no natural key — refusing to file it under the singleton sentinel'
        );
        continue;
      }

      const consolidation = await this.consolidationService.consolidateIPOData({
        ipoId,
        tableName,
        rowKey,
        incomingData: row.data ?? {},
        source,
        existingData: row.existingData,
        confidence,
        docType,
      });

      result.rowsProcessed += 1;
      result.conflictsDetected += consolidation.conflictsDetected;
      if (consolidation.fieldsUpdated > 0) result.rowsUpdated += 1;
      result.rows.push({
        rowKey,
        existingRowId: row.existingRowId,
        consolidatedData: consolidation.consolidatedData ?? {},
        fieldsProcessed: consolidation.fieldsProcessed,
        fieldsUpdated: consolidation.fieldsUpdated,
        conflictsDetected: consolidation.conflictsDetected,
        skipped: false,
      });
    }

    return result;
  }
}

/**
 * Export types for external use
 */
export type { ConsolidatedUpsertResult };
