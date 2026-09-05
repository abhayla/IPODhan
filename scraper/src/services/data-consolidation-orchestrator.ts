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
import { generateSlug } from '../utils/validators.js';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { resolveOfferingTypeKeepingClassification } from '../utils/detect-offering-type.js';
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
    const slug = generateSlug(scrapedIPO.companyName);

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

      return {
        ipoId,
        isNew,
        consolidation: consolidationResult,
        locked: true,
        skipped: false,
      };
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

    // Ensure required fields have values
    return {
      companyName: consolidated.companyName || originalScraped.companyName,
      segment: consolidated.segment ?? originalScraped.segment ?? null,
      offeringType: consolidated.offeringType || originalScraped.offeringType,
      sector: consolidated.sector,
      // T-329: issueSize is optional on ScrapedIPO (a source may genuinely
      // have no rupee-convertible value) — `?.toString()` on both sides
      // avoids a TypeError when neither side has a value, leaving it
      // undefined so data-persister.ts's coercePositiveOrNull writes NULL.
      issueSize: consolidated.issueSize?.toString() ?? originalScraped.issueSize?.toString(),
      priceRangeMin: consolidated.priceRangeMin,
      priceRangeMax: consolidated.priceRangeMax,
      lotSize: consolidated.lotSize,
      faceValue: consolidated.faceValue,
      status: consolidated.status || originalScraped.status,
      openDate: consolidated.openDate || originalScraped.openDate,
      closeDate: consolidated.closeDate || originalScraped.closeDate,
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
}

/**
 * Export types for external use
 */
export type { ConsolidatedUpsertResult };
