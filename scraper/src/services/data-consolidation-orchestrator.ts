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
    private redis: Redis | null
  ) {
    this.consolidationService = new DataConsolidationService(
      fieldSourcesRepository,
      dataConflictsRepository
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
      const incomingData = this.mapScrapedIPOToConsolidationInput(scrapedIPO);

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
        scrapedIPO
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
    scrapedIPO: ScrapedIPO
  ): Record<string, any> {
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
      listingExchange: scrapedIPO.listingExchange,
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
    originalScraped: ScrapedIPO
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
      listingExchanges: this.extractListingExchanges(consolidated, originalScraped),
      symbol: consolidated.symbol,
      isin: consolidated.isin,
      lastScrapedAt: new Date(),
    } as Partial<IPOInsert>;
  }

  /**
   * Extract listing exchanges with merge logic
   */
  private extractListingExchanges(
    consolidated: any,
    originalScraped: ScrapedIPO
  ): ('NSE' | 'BSE')[] {
    const incomingExchange = consolidated.listingExchange || originalScraped.listingExchange;

    if (incomingExchange === 'BOTH') {
      return ['NSE', 'BSE'];
    } else {
      return [incomingExchange as 'NSE' | 'BSE'];
    }
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
