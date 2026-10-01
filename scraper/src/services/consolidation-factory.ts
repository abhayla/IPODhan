/**
 * #1370 / F-216: the ONE place a production `DataConsolidationService` or `DataConsolidationOrchestrator`
 * is built.
 *
 * Why this exists: OD-21 (spec §5.3) requires every extracted field to be validated before the write,
 * the failing field dropped and recorded with its cause. The gate (`runPreRankChecks`,
 * data-consolidation-service.ts) runs only when the consolidator holds a field-extraction-failures
 * repository, because a gate that cannot record a failure must not drop values. No production
 * construction ever passed one, so the gate was skipped on every real write while its unit tests,
 * which inject the repository, passed.
 *
 * The repository is a REQUIRED member of `ConsolidationServiceDeps`, so a construction that omits it
 * does not type-check, and `scraper/tests/unit/services/consolidation-factory-guard.test.ts` fails when
 * any production file other than this one (and the orchestrator, for its inner service) imports either
 * class as a value. Whether the gate actually runs is still the flag ENABLE_FIELD_EXTRACTION_VALIDATION
 * (feature-flags.ts); this file only makes it able to run everywhere.
 *
 * #1380 / F-220: the trading-holiday calendar is a REQUIRED dependency too. It was optional and no
 * production construction passed it, so the working-day rules (listing_t3 / listing_t6) returned
 * NO_RULE_APPLIES for every date. `createTradingCalendar` is the one production calendar (one uncached
 * market_holidays read per build); a year with no holiday rows still judges nothing.
 */
import { DataConsolidationService } from './data-consolidation-service.js';
import { DataConsolidationOrchestrator } from './data-consolidation-orchestrator.js';
import { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';
import { FieldExtractionFailuresRepository } from '@ipodhan/shared/repositories';
// Deep import, matching filing-persist-deps.ts: the barrel exports only the interface.
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { createTradingCalendar, type TradingCalendar } from './trading-calendar.js';
import type { IPORepository } from '@ipodhan/shared';
import type Redis from 'ioredis';

export interface FieldExtractionFailuresRecorder {
  recordFailure(input: Record<string, any>): Promise<any>;
  markResolved(ipoId: string, tableName: string, fieldName: string, rowKey?: string): Promise<number>;
}

export interface ConsolidationServiceDeps {
  fieldSourcesRepository: any;
  dataConflictsRepository: any;
  /** W-145: strongest evidence tier for the SME single-exchange collapse. Optional, as before. */
  listingPerformanceRepository?: { findByIPO(ipoId: string): Promise<any> };
  /** OD-21 (spec §5.3): REQUIRED. Without it the per-field validation gate cannot run. */
  fieldExtractionFailuresRepository: FieldExtractionFailuresRecorder;
  /** #1380: REQUIRED. A ready-made set (tests) or the lazy production calendar from `createTradingCalendar`. */
  tradingHolidays: ReadonlySet<string> | TradingCalendar;
}

/** The standard production repository set, built against the given database and Redis client. */
export function buildConsolidationDeps(db: any, redis: any): ConsolidationServiceDeps {
  return {
    fieldSourcesRepository: new FieldSourcesRepository(db, redis),
    dataConflictsRepository: new DataConflictsRepository(db, redis),
    listingPerformanceRepository: new ListingPerformanceRepository(db, redis),
    fieldExtractionFailuresRepository: new FieldExtractionFailuresRepository(db, redis),
    tradingHolidays: createTradingCalendar(db, redis),
  };
}

export { createTradingCalendar };

export function createConsolidationService(deps: ConsolidationServiceDeps): DataConsolidationService {
  return new DataConsolidationService(
    deps.fieldSourcesRepository,
    deps.dataConflictsRepository,
    deps.listingPerformanceRepository,
    deps.fieldExtractionFailuresRepository,
    deps.tradingHolidays
  );
}

export function createConsolidationOrchestrator(
  ipoRepository: IPORepository,
  deps: ConsolidationServiceDeps,
  redis: Redis | null
): DataConsolidationOrchestrator {
  return new DataConsolidationOrchestrator(
    ipoRepository,
    deps.fieldSourcesRepository,
    deps.dataConflictsRepository,
    redis,
    deps.listingPerformanceRepository,
    deps.fieldExtractionFailuresRepository,
    deps.tradingHolidays
  );
}
