import type { IPORepository, SubscriptionRepository, GMPRepository, FinancialDataRepository, IPOInsert, SubscriptionInsert, GMPRecordInsert, FinancialDataInsert, IPO } from '@ipodhan/shared';
import { normalizeCompanyUrl, isVerifierUrl } from './company-host-source.js';
import logger from '../utils/logger.js';
import { sql as sqlOp } from 'drizzle-orm';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { generateSlug, sanitizeCompanyName, coercePositiveOrNull, sanitizeIpoDates, sanitizeRegistrar, sanitizeLeadManagers, sanitizeIpoWriteFields } from '../utils/validators.js';
import { isDateSequenceCoherent } from './ipo-date-plausibility.js';
import { shouldPersistSubscriptionSnapshot, recordSuppressionOutcome, type SuppressionCounterStore } from './subscription-coverage-registry.js';
import { retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import { validateLotSize } from '../utils/lot-size-validator.js';
// W-14: the SAME per-source rule set, re-run once on the MERGED record at the
// consolidation write door (see the block in upsertIPO for why).
import { validateIPOData } from '../utils/data-validation.js';
import { resolveOfferingTypeKeepingClassification, guardSmeOfferingTypeAgainstFpo } from '../utils/detect-offering-type.js';
import { isAuthoritativeForHardDatesOnCreate } from '../utils/hard-date-source-trust.js';
import type { ScraperSource } from './types.js';
import type { ScrapedFinancialData } from '../scrapers/financial-data-scraper.js';
import type { ScrapedPeerCompany } from '../scrapers/peer-companies-scraper.js';
import { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
// Phase 2: Shadow Mode - Data Consolidation Service
import { DataConsolidationService } from './data-consolidation-service.js';
import { FieldSourcesRepository, DataConflictsRepository, RegistrarRepository, resolveIpoRow } from '@ipodhan/shared/repositories';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { db, getRedisClient } from '@ipodhan/shared';
import { ipoDemandGraph, ipoDetails } from '@ipodhan/shared/db/schema';
import { resolveRegistrarId } from '@ipodhan/shared/utils/registrar-matcher';
import { initStepLedger } from './step-ledger.js';
import {
  recordDiscoverySteps,
  recordLiveStep,
  type DiscoveryStepInput,
} from './step-ledger-recorders.js';

/**
 * Resolve a sanitized registrar name to its `registrars.id` FK (P3-2, T-278).
 * `RegistrarRepository.findAll()` is itself Redis-cached for 7 days, so this
 * is cheap to call on every write; best-effort by design (non-fatal-side-
 * effects.md) — a lookup failure never blocks the primary IPO write, it just
 * leaves `registrarId` unset for this cycle.
 */
async function resolveRegistrarIdSafe(registrarName: string | null | undefined): Promise<string | null> {
  if (!registrarName) return null;
  try {
    const registrarRepo = new RegistrarRepository(db, getRedisClient());
    const allRegistrars = await registrarRepo.findAll(false);
    return resolveRegistrarId(
      registrarName,
      allRegistrars.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName }))
    );
  } catch (error) {
    logger.warn({ error, registrarName }, 'registrarId resolution failed (non-fatal)');
    return null;
  }
}

/**
 * Phase 2: Lazy singleton for Data Consolidation Service
 * Initialized once on first use to avoid overhead
 */
let consolidationServiceInstance: DataConsolidationService | null = null;

/**
 * Module-level singleton for the conflicts repository, shared by the
 * consolidation service and by the merged-record validation pass below, so a
 * write never constructs a second repo (and a second Redis handle) per IPO.
 */
let dataConflictsRepoInstance: DataConflictsRepository | null = null;

function getDataConflictsRepository(): DataConflictsRepository {
  if (!dataConflictsRepoInstance) {
    dataConflictsRepoInstance = new DataConflictsRepository(db, getRedisClient());
  }
  return dataConflictsRepoInstance;
}

/**
 * Module-level singleton for the field-sources repository, shared with the
 * merged-record validation pass below (same reasoning as the conflicts
 * repository above — one repo/Redis handle per process, not per write).
 */
let fieldSourcesRepoInstance: FieldSourcesRepository | null = null;

function getFieldSourcesRepository(): FieldSourcesRepository {
  if (!fieldSourcesRepoInstance) {
    fieldSourcesRepoInstance = new FieldSourcesRepository(db, getRedisClient());
  }
  return fieldSourcesRepoInstance;
}

async function getConsolidationService(): Promise<DataConsolidationService> {
  if (!consolidationServiceInstance) {
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    consolidationServiceInstance = new DataConsolidationService(
      fieldSourcesRepo,
      getDataConflictsRepository()
    );
  }
  return consolidationServiceInstance;
}

/**
 * The rules the merged pass OWNS, and the fields each one refuses to write.
 * Everything else `validateIPOData` can report (offering-type shape guards,
 * required-field, date ordering, lot economics) is already enforced per source
 * and on the create path - re-acting on it here would silently widen this
 * guard's blast radius far past W-14.
 */
const MERGED_RULE_FIELDS: Record<string, string[]> = {
  PRICE_BAND_INVERTED: ['priceRangeMin', 'priceRangeMax'],
  PRICE_BAND_TOO_WIDE_MAINBOARD: ['priceRangeMin', 'priceRangeMax'],
  PRICE_BAND_TOO_WIDE_SME: ['priceRangeMin', 'priceRangeMax'],
  LOT_SIZE_INVALID: ['lotSize'],
  LOT_SIZE_TOO_LOW: ['lotSize'],
};

/**
 * ===== W-14: MERGED-RECORD VALIDATION (Deepa walk, 2026-09-02) =====
 *
 * `validateIPOData` runs PER SOURCE inside each orchestrator, on only the
 * fields that one source happens to carry. Several of its rules are
 * segment-conditional or need two fields at once, so they never fire there:
 * BSE list rows carry no `segment` (undefined by design), so the SEBI
 * band-width rules never evaluate for BSE data; NSE list rows carry no lot
 * size, so the lot-size rules never evaluate for NSE rows. A 25% band on a
 * mainboard IPO arriving from BSE was accepted outright.
 *
 * The MERGED view of `existingIPO` + this scrape has segment + band + lot
 * together, so the SAME rules run once more here - BEFORE either write door
 * (consolidation, and the legacy fallback it falls through to). Running it
 * before the doors is load-bearing, not cosmetic: `consolidateIPOData` is the
 * single writer of `field_sources`, so a field validated only AFTER
 * consolidation would already have been recorded as this source's while `ipos`
 * kept the old value - provenance would claim a value the row does not hold.
 * Dropping the field from the INCOMING payload means consolidation never sees
 * it, writes no provenance for it, and the fallback door (which consumes the
 * same payload) is guarded by construction.
 *
 * Behaviour: an ERROR-severity hit drops the offending fields from the incoming
 * payload (the stored values survive), records a CRITICAL data_conflicts row
 * tagged `MERGED_RECORD_VALIDATION:<rule>`, and logs at warn; the rest of the
 * update proceeds. A WARNING-severity hit (an unusual-but-legal lot) logs only.
 * An ADMIN write is exempt - a manual override is never dropped.
 *
 * Mutates `incomingData` and returns the names of the fields it dropped, so the
 * consolidation door can re-apply the same decision to consolidation's merged
 * output (whose per-field winner may still be a previously-persisted bad value
 * for that field).
 */
async function applyMergedRecordValidation(
  existingIPO: Record<string, any>,
  incomingData: Record<string, any>,
  source: ScraperSource,
  companyName: string
): Promise<string[]> {
  if (source === 'ADMIN') return [];

  // Segment: the STORED classification governs whenever the row has one - an
  // incoming row claiming SME must not relax the band gate for its own band
  // value in the same write. Only a row with no segment at all takes the
  // incoming one.
  const storedSegment = (existingIPO as any).segment ?? null;
  const incomingSegment = ('segment' in incomingData ? incomingData.segment : null) ?? null;
  const mergedSegment = storedSegment !== null ? storedSegment : incomingSegment;

  const mergedValue = (field: string) => incomingData[field] ?? (existingIPO as any)[field] ?? undefined;
  const mergedRecord: Record<string, any> = {
    companyName: incomingData.companyName ?? existingIPO.companyName,
    segment: mergedSegment,
    lotSize: mergedValue('lotSize'),
    priceRangeMin: mergedValue('priceRangeMin'),
    priceRangeMax: mergedValue('priceRangeMax'),
    issueType: mergedValue('issueType'),
  };

  const mergedValidation = validateIPOData(mergedRecord as any, source);

  for (const warning of mergedValidation.warnings) {
    if (warning.field === 'lotSize' || warning.field === 'priceBand') {
      logger.warn({
        ipoId: existingIPO.id,
        companyName,
        source,
        rule: warning.rule,
        segment: mergedSegment,
      }, `[MergedRecordValidation] ${warning.rule} on the merged record (W-14) - written, warning only`);
    }
  }

  const droppedFields: string[] = [];
  for (const error of mergedValidation.errors) {
    const fieldsToDrop = MERGED_RULE_FIELDS[error.rule];
    if (!fieldsToDrop) continue;

    const rejectedValues: Record<string, any> = {};
    const keptValues: Record<string, any> = {};
    for (const field of fieldsToDrop) {
      rejectedValues[field] = mergedRecord[field];
      keptValues[field] = (existingIPO as any)[field] ?? null;
      delete incomingData[field];
      if (!droppedFields.includes(field)) droppedFields.push(field);
    }

    logger.warn({
      ipoId: existingIPO.id,
      companyName,
      source,
      rule: error.rule,
      segment: mergedSegment,
      droppedFields: fieldsToDrop,
      rejectedValues,
      keptValues,
    }, `[MergedRecordValidation] ${error.rule} on the merged record (W-14) - offending fields NOT written`);

    // T-286/P1-2 invariant (data-consolidation-service.ts ~L1358-1369): a
    // data_conflicts row must NEVER have source1 === source2 — that shape
    // once destroyed the alert channel with self-comparisons. `source` here
    // is only the INCOMING scrape; source1 MUST be the STORED value's actual
    // owner, looked up via field_sources (the same provenance consolidation
    // itself reads). No owner row is a data gap, not a conflict — skip the
    // write and log instead of guessing.
    const ownerField = fieldsToDrop[0];
    try {
      const ownerRecord = await getFieldSourcesRepository().findByField(existingIPO.id, 'ipos', ownerField);

      if (!ownerRecord) {
        logger.warn({
          ipoId: existingIPO.id,
          source,
          rule: error.rule,
          field: ownerField,
          reason: 'merged_validation_no_stored_owner',
        }, '[MergedRecordValidation] no field_sources provenance for the stored value - conflict not recorded');
      } else if (ownerRecord.source === source) {
        logger.warn({
          ipoId: existingIPO.id,
          source,
          rule: error.rule,
          field: ownerField,
          reason: 'merged_validation_same_source',
        }, '[MergedRecordValidation] stored owner equals incoming source - conflict not recorded');
      } else {
        // Best-effort provenance for the admin queue (non-fatal-side-effects.md):
        // a failure to record the conflict must never block the primary write.
        await getDataConflictsRepository().upsertConflict({
          ipoId: existingIPO.id,
          tableName: 'ipos',
          fieldName: error.field,
          source1: ownerRecord.source as any,
          value1: JSON.stringify(keptValues),
          source2: source as any,
          value2: JSON.stringify(rejectedValues),
          resolutionReason: `MERGED_RECORD_VALIDATION:${error.rule}`,
          severity: 'CRITICAL',
        });
      }
    } catch (conflictError: any) {
      logger.warn({
        ipoId: existingIPO.id,
        source,
        rule: error.rule,
        error: conflictError?.message,
      }, '[MergedRecordValidation] failed to record merged-record conflict (non-fatal)');
    }
  }

  return droppedFields;
}

/**
 * PostgreSQL error codes (Story 11.2 - Enhanced error logging)
 */
const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',      // Duplicate key (e.g., duplicate slug)
  NOT_NULL_VIOLATION: '23502',    // Missing required field
  NUMERIC_OVERFLOW: '22003',      // Numeric field overflow
  FOREIGN_KEY_VIOLATION: '23503', // Invalid foreign key
  CONNECTION_ERROR: '08000',      // Connection exception (transient)
  CONNECTION_FAILURE: '08006',    // Connection failure (transient)
};

/**
 * Check if PostgreSQL error should skip retry (permanent errors)
 */
function shouldSkipRetry(error: any): boolean {
  const pgCode = error?.code;
  return [
    PG_ERROR_CODES.UNIQUE_VIOLATION,
    PG_ERROR_CODES.NOT_NULL_VIOLATION,
    PG_ERROR_CODES.NUMERIC_OVERFLOW,
    PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
  ].includes(pgCode);
}

/**
 * Retry an async operation with exponential backoff
 * Enhanced with PostgreSQL error code detection (Story 11.2)
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = config.scraper.retryAttempts,
  delays: number[] = config.scraper.retryDelays
): Promise<T> {
  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Enhanced error logging (Story 11.2)
      const pgErrorDetails = {
        message: error?.message,
        code: error?.code,
        constraint: error?.constraint,
        column: error?.column,
        detail: error?.detail,
        hint: error?.hint,
        table: error?.table,
      };

      logger.error(
        {
          ...pgErrorDetails,
          attempt: attempt + 1,
          maxAttempts,
          operation: operationName,
        },
        'Database operation failed - PostgreSQL error details'
      );

      // Skip retry for permanent errors (Story 11.2)
      if (shouldSkipRetry(error)) {
        logger.error(
          {
            code: error?.code,
            constraint: error?.constraint,
            operation: operationName,
          },
          'Permanent database error detected - skipping retry'
        );
        throw error; // Don't retry constraint violations
      }

      if (attempt < maxAttempts - 1) {
        const delay = delays[attempt] || delays[delays.length - 1];
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts,
            delay,
            error: error?.message,
            operation: operationName
          },
          'Transient error - retrying with exponential backoff'
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Merge listing exchanges for dual-listed IPOs
 * Adds new exchange to array if not already present
 * @param existingExchanges - Current listing exchanges
 * @param newExchange - New exchange to add
 * @returns Merged array with deduplicated exchanges
 */
function mergeListingExchanges(
  existingExchanges: ('NSE' | 'BSE')[],
  newExchange: 'NSE' | 'BSE'
): ('NSE' | 'BSE')[] {
  const merged = [...existingExchanges];
  if (!merged.includes(newExchange)) {
    merged.push(newExchange);
  }
  return merged;
}

/**
 * W-16a: the exchange half of the non-destructive fallback — same rule the
 * consolidation path applies (`mergeListingExchanges`), so the safety net can
 * never replace ['BSE'] with ['NSE'] just because NSE scraped the row.
 */
export function mergeListingExchangesForSource(
  existingExchanges: ('NSE' | 'BSE')[] | null | undefined,
  source: ScraperSource,
  scrapedListingExchange: 'NSE' | 'BSE' | 'BOTH' | undefined
): ('NSE' | 'BSE')[] {
  const existing = existingExchanges ?? [];
  if (source !== 'NSE' && source !== 'BSE') {
    return existing.length > 0 ? existing : (scrapedListingExchange === 'BOTH' ? ['NSE', 'BSE'] : scrapedListingExchange ? [scrapedListingExchange] : []);
  }
  const incoming = scrapedListingExchange === 'BOTH' ? source : (scrapedListingExchange ?? source);
  return mergeListingExchanges(existing, incoming);
}

/**
 * W-16a: drop every key whose incoming value would replace a stored value with
 * nothing. `undefined` is always dropped; an explicit `null` is dropped only
 * when the row currently holds a value (a deliberate null on an already-empty
 * column is harmless and keeps RIGHTS/NCD segment semantics intact).
 */
export function buildNonDestructiveUpdate(
  existingRow: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const existingValue = existingRow?.[key];
    const existingIsPresent =
      existingValue !== undefined &&
      existingValue !== null &&
      !(Array.isArray(existingValue) && existingValue.length === 0);
    if (value === null && existingIsPresent) continue;
    patch[key] = value;
  }
  return patch;
}

// The canonical company-name normalizer now lives in the shared package so the
// JS path (here) and the SQL path (ipo-repository) share ONE definition and stay
// in lock-step (A3 / #6 #8 #16). Imported for local use in upsertIPO AND
// re-exported for existing callers (e.g. the GMP orchestrator).
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
export { normalizeCompanyNameForMatching };

/**
 * Upsert IPO data to database with retry logic
 * Handles merge logic for dual-listed IPOs (both NSE and BSE)
 * Enhanced Phase 11 Step 2: Fuzzy company name matching to prevent duplicates
 * @param ipoRepository - IPO repository instance
 * @param scrapedIPO - Validated scraped IPO data
 * @param source - Source exchange ('NSE' | 'BSE') for merge logic
 * @returns IPO ID on success
 */
export async function upsertIPO(
  ipoRepository: IPORepository,
  scrapedIPO: ScrapedIPO,
  source: ScraperSource = 'NSE',
  // T-307 (write-path hardening Phase 1, §2(a) step 1): when the caller has
  // ALREADY resolved identity once for this request (e.g. the protection
  // guard in BaseScraperOrchestrator), pass that SAME resolved row here so
  // this write never re-resolves independently — a second, independently-
  // timed resolution is exactly how the guard and the write diverged before
  // (docs/architecture/write-path-hardening.md §1.4). `undefined` (the
  // default) means "no pre-resolution supplied" — resolve it here, as
  // before, for callers outside the guarded path.
  preResolvedIPO?: IPO | null
): Promise<string> {
  const startTime = Date.now();
  const slug = generateSlug(scrapedIPO.companyName);
  const normalizedName = normalizeCompanyNameForMatching(scrapedIPO.companyName);

  /**
   * S-02 step-ledger facts for this write (B1..B7, F1/F2/F4/F5/F6).
   *
   * Captured inside the retried closure but WRITTEN once, after
   * `retryWithBackoff` returns — so a retried write records one set of ledger
   * rows, not one per attempt, and a write that ultimately threw records none.
   * `upsertIPO` is the only door to `ipos` (`scraper-write-path.md`), which is
   * precisely why the hook belongs here: every source that reaches the database
   * at all reaches this line.
   */
  let ledgerFacts: DiscoveryStepInput | null = null;

  logger.debug({
    companyName: scrapedIPO.companyName,
    normalizedName,
    slug,
    source
  }, 'Upserting IPO (Phase 11: with fuzzy matching)');

  // T-307C Finding 3 (retry-semantics trade-off, accepted): when `preResolvedIPO` is
  // supplied, the SAME resolved row is reused across every retry attempt below instead
  // of being re-resolved per attempt (as it was before T-307). Consequence: if another
  // writer inserts the row between the guard's resolve (Step 2 of processIPO) and this
  // write, a create that loses that race now retries into the same unique-key conflict
  // instead of self-healing into an update on the next attempt. Narrow window, mitigated
  // by the `ipo:{slug}` distributed lock covering the common concurrent-write case — and
  // the correct trade for guard/write parity (§1.4): re-resolving per retry would just
  // reopen the divergence this whole task exists to close.
  const result = await retryWithBackoff(
    async () => {
      // T-307: single source of truth for "which row is this?" — the exact
      // three-tier lookup (normalized-name -> slug -> fuzzy) formerly
      // hand-copied here now lives in resolveIpoRow, shared with the
      // protection guard and the consolidation write path.
      let existingIPO: IPO | null = preResolvedIPO !== undefined
        ? preResolvedIPO
        : await resolveIpoRow(ipoRepository, {
            companyName: scrapedIPO.companyName,
            normalizedName,
            slug,
          }) as IPO | null;

      if (existingIPO && normalizeCompanyNameForMatching(existingIPO.companyName) === normalizedName) {
        logger.info({
          companyName: scrapedIPO.companyName,
          normalizedName,
          existingCompanyName: existingIPO.companyName,
          existingSlug: existingIPO.slug,
          newSlug: slug
        }, '[Phase 11] Found existing IPO via fuzzy name matching - preventing duplicate!');
      }

      // Determine listing exchange(s)
      let listingExchanges: ('NSE' | 'BSE')[];
      if (scrapedIPO.listingExchange === 'BOTH') {
        listingExchanges = ['NSE', 'BSE'];
      } else {
        listingExchanges = [scrapedIPO.listingExchange];
      }

      // Stage A.5 write-path date-plausibility guard (#41/#52): a current scrape must
      // not stomp an old IPO's open/close dates. Anchor on the trustworthy post-IPO
      // dates (this scrape's, else the existing row's allotment/listing) and drop any
      // open/close that contradicts the anchor by years.
      const rawDatesForSanitize = {
        openDate: scrapedIPO.openDate,
        closeDate: scrapedIPO.closeDate,
        allotmentDate: scrapedIPO.allotmentDate || (existingIPO?.allotmentDate ?? null),
        listingDate: scrapedIPO.listingDate || (existingIPO?.listingDate ?? null),
      };
      const safeDates = sanitizeIpoDates(rawDatesForSanitize);
      // T-299 (#P2-7): a violation MUST be loud, not just silently nulled — this is
      // the create/legacy-update path's only date-plausibility log (the
      // consolidation-update path logs via isDateSequenceCoherent above).
      (['openDate', 'closeDate', 'allotmentDate', 'listingDate'] as const).forEach((k) => {
        if (rawDatesForSanitize[k] != null && safeDates[k] == null) {
          logger.warn({
            ipoId: existingIPO?.id,
            companyName: scrapedIPO.companyName,
            source,
            field: k,
            rejectedValue: rawDatesForSanitize[k],
            allDates: rawDatesForSanitize,
          }, `[DatePlausibility] rejected incoherent ${k} at write boundary (#P2-7)`);
        }
      });
      // issue_size: 0 means "unknown", not a real value — store NULL, never 0 (#A.5).
      const safeIssueSize = coercePositiveOrNull(scrapedIPO.issueSize);

      const ipoData: Partial<IPOInsert> = {
        companyName: sanitizeCompanyName(scrapedIPO.companyName),
        slug,
        // Story 11.8: Use segment and offeringType from scraped data
        // segment is nullable for RIGHTS/InvITs/REITs/NCDs (they don't have market segments)
        segment: scrapedIPO.segment || null,
        // offering_type: Determines the type of offering (required NOT NULL field)
        offeringType: scrapedIPO.offeringType,
        // '' sector plants a blank that renders empty AND defeats NULL-based backfills —
        // normalize at the CREATE path too (the consolidation path is covered by
        // sanitizeIpoWriteFields; this covers create + the legacy fallback update).
        sector: scrapedIPO.sector?.trim() || undefined,
        issueSize: safeIssueSize !== null ? safeIssueSize.toString() : undefined,
        // Round price values to integers for INTEGER fields in database
        // Use explicit check to avoid storing 0 (only store positive values or undefined)
        priceRangeMin: scrapedIPO.priceRangeMin !== undefined && scrapedIPO.priceRangeMin > 0
          ? Math.round(scrapedIPO.priceRangeMin)
          : undefined,
        priceRangeMax: scrapedIPO.priceRangeMax !== undefined && scrapedIPO.priceRangeMax > 0
          ? Math.round(scrapedIPO.priceRangeMax)
          : undefined,
        lotSize: validateLotSize(scrapedIPO.lotSize, scrapedIPO.segment, scrapedIPO.companyName) ?? undefined, // Validate and reject lot_size = 1
        faceValue: scrapedIPO.faceValue || undefined,
        status: scrapedIPO.status as any,
        openDate: (safeDates.openDate as Date | undefined) ?? undefined,
        closeDate: (safeDates.closeDate as Date | undefined) ?? undefined,
        // Convert empty strings to undefined for date fields (Story 11.7 - Fix Chittorgarh date handling)
        allotmentDate: scrapedIPO.allotmentDate || undefined,
        listingDate: scrapedIPO.listingDate || undefined,
        companyDescription: scrapedIPO.companyDescription || undefined,
        registrar: sanitizeRegistrar(scrapedIPO.registrar) ?? undefined,
        // P3-2: populate the FK when the sanitized name resolves unambiguously
        // to a reference registrars row; undefined otherwise (never guessed,
        // and never clobbers an existing value with a fresh non-match).
        registrarId: (await resolveRegistrarIdSafe(sanitizeRegistrar(scrapedIPO.registrar))) ?? undefined,
        leadManagers: sanitizeLeadManagers(scrapedIPO.leadManagers),
        listingExchanges,
        lastScrapedAt: new Date(), // Track last successful scrape time (Story 7.4)
        updatedAt: new Date(),
        // Symbol: Only set if scraper explicitly provides it (NSE/BSE have symbols, upcoming IPOs may not)
        symbol: scrapedIPO.symbol || undefined,
        // ISIN: Only set if scraper provides it (NSE API / BSE Detail may have it)
        isin: scrapedIPO.isin || undefined,
        // W-82 round 2: CIN from the filing persister was validated (T-329 fix)
        // but never copied into ipoData, so it never reached the consolidation
        // or non-destructive-fallback write paths — same undefined-when-absent
        // convention as faceValue/isin so it never nulls a stored CIN.
        cin: scrapedIPO.cin || undefined
      } as any;

      // A scraper that returns `undefined` segment (e.g. BSE-API, whose JSON board
      // carries both SME and mainboard IPOs with no segment field) cannot determine
      // the classification and MUST NOT overwrite it. Drop the key entirely so the
      // consolidation/update path never touches segment (otherwise rows with no
      // field_sources hit the "no existing value -> accept incoming" path and get
      // mis-classified). A deliberate `null` (RIGHTS/NCDs) is kept.
      if (scrapedIPO.segment === undefined) {
        delete (ipoData as any).segment;
      }

      // P1-1 (T-292): a lower-trust source (e.g. Moneycontrol) cannot flip an
      // SME-segment row to FPO — SME boards never have genuine FPOs (Mopshop
      // Distribution shape). Applied to the INCOMING payload before both the
      // create path and consolidation, so consolidation's field-priority pick
      // sees the already-corrected value. Falls back to the existing row's
      // segment when this scrape didn't report one (segment key may have just
      // been deleted above).
      if ((ipoData as any).offeringType) {
        const effectiveSegment = 'segment' in ipoData ? (ipoData as any).segment : (existingIPO?.segment ?? null);
        (ipoData as any).offeringType = guardSmeOfferingTypeAgainstFpo(effectiveSegment, (ipoData as any).offeringType);
      }

      // P2-5 (T-292): a brand-new row (no existing row = no corroborating
      // history yet) cannot have its hard dates asserted by a single
      // mid/low-trust source — only the exchanges, DRHP, or an admin override
      // are trusted alone (Priority Jewels shape: Dec-2026 dates rendered as
      // fact from one uncorroborated source). Update-path dates are left to
      // consolidation's existing field-priority/conflict logic, which already
      // has prior field_sources history to arbitrate against.
      if (!existingIPO && !isAuthoritativeForHardDatesOnCreate(source)) {
        delete (ipoData as any).openDate;
        delete (ipoData as any).closeDate;
        delete (ipoData as any).listingDate;
      }

      if (existingIPO) {
        // W-14: run the merged-record rule set ONCE, before EITHER write door, on
        // the merged view of the stored row + this scrape. See
        // `applyMergedRecordValidation` for why it cannot run after consolidation
        // (field_sources provenance) and why the fallback door needs it too.
        const mergedValidationDroppedFields = await applyMergedRecordValidation(
          existingIPO as any,
          ipoData as any,
          source,
          scrapedIPO.companyName
        );

        // ========== PHASE 4: PRODUCTION CONSOLIDATION (100% ROLLOUT) ==========
        // All IPO updates use intelligent data consolidation
        if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
          try {
            const consolidationService = await getConsolidationService();
            const consolidationStartTime = Date.now();

            // Run consolidation service in production mode
            const consolidationResult = await consolidationService.consolidateIPOData({
              ipoId: existingIPO.id,
              tableName: 'ipos',
              incomingData: ipoData,
              source: source,
              existingData: existingIPO as any,
              shadowMode: false, // Production mode - writes to database
              scrapedAt: new Date(),
            });

            const consolidationDuration = Date.now() - consolidationStartTime;

            // Merge exchanges (preserve exchange tracking logic)
            let mergedExchanges = existingIPO.listingExchanges as ('NSE' | 'BSE')[];
            if (source === 'NSE' || source === 'BSE') {
              const currentExchange = scrapedIPO.listingExchange === 'BOTH' ? source : scrapedIPO.listingExchange;
              mergedExchanges = mergeListingExchanges(mergedExchanges, currentExchange);
            }

            // #52 observability: detect an incoherent merged date sequence BEFORE the
            // sanitizer corrects it, so a consolidation mis-merge recurrence is visible
            // in prod logs/alerting (the sanitize below only silently nulls the offender).
            const rawConsolidated = consolidationResult.consolidatedData;
            const dateCoherence = isDateSequenceCoherent({
              openDate: rawConsolidated.openDate,
              closeDate: rawConsolidated.closeDate,
              allotmentDate: rawConsolidated.allotmentDate,
              listingDate: rawConsolidated.listingDate,
            });
            if (!dateCoherence.ok) {
              logger.warn({
                ipoId: existingIPO.id,
                companyName: scrapedIPO.companyName,
                source,
                reason: dateCoherence.reason,
                dates: {
                  openDate: rawConsolidated.openDate,
                  closeDate: rawConsolidated.closeDate,
                  allotmentDate: rawConsolidated.allotmentDate,
                  listingDate: rawConsolidated.listingDate,
                },
              }, '[DataConsolidation] incoherent merged date sequence — sanitizer will null the offender (#52, T-306: sanitizeIpoDates now covers every isDateSequenceCoherent rule)');
            }

            // Use consolidated data with merged exchanges. Re-apply the write-field
            // sanitizers (#42/#45/#52): consolidation picks a winning value PER FIELD
            // from field_sources, which can re-introduce a name status-token, a
            // registrar address block, or a date field merged from a different-vintage
            // source that breaks the open<close<allotment<listing ordering — none of
            // which the incoming-payload sanitize (above) can catch post-merge.
            //
            // KNOWN LIMITATION (review finding, owner-gated #52 correction): the no-listing
            // date disambiguation anchors on allotment and nulls open/close. For a genuine
            // NEW IPO that got a WRONG historical allotment merged and has no listing yet,
            // this nulls the good open/close and keeps the bad allotment. Correctly
            // resolving that needs field_sources provenance (the owner-gated #52 fix) — the
            // guard never ships an absurd value (nulled → "Data Not Available"), it just may
            // drop a recoverable field for that unobserved pre-listing edge.
            const finalData: Record<string, any> = {
              ...sanitizeIpoWriteFields(rawConsolidated),
              listingExchanges: mergedExchanges,
              lastScrapedAt: new Date(),
              updatedAt: new Date(),
            };

            // P3-2: the consolidation path can pick a winning `registrar` value
            // this cycle even when the create path never ran (a name-only
            // update on an existing row) — resolve registrarId here too, same
            // unambiguous-match-only contract as the create path above.
            if ('registrar' in finalData) {
              finalData.registrarId = (await resolveRegistrarIdSafe(finalData.registrar)) ?? undefined;
            }

            // Never let a scraper's generic 'IPO' downgrade an existing specific
            // classification (takeover/buyback/rights/debt) — otherwise the */30 cron
            // re-pollutes the IPO listings every run. (See reclassify-corporate-actions.ts.)
            if ((finalData as any).offeringType) {
              (finalData as any).offeringType = resolveOfferingTypeKeepingClassification(
                (existingIPO as any).offeringType,
                (finalData as any).offeringType
              );
            }

            // W-14: the merged-record pass already ran ONCE, before this door, and
            // removed these fields from the incoming payload (so consolidation never
            // saw them and wrote no `field_sources` provenance for them). Re-apply the
            // SAME decision to consolidation's merged output: its per-field winner for
            // a dropped field can still be a previously-persisted bad value, and this
            // update must leave the stored value alone.
            for (const field of mergedValidationDroppedFields) {
              delete finalData[field];
            }

            // S-02 §5 no-op write suppression: `consolidationResult.fieldsUpdated`
            // now reflects a NORMALIZED comparison (see the `valueActuallyChanged`
            // fix in data-consolidation-service.ts) — a re-scrape that changed
            // nothing (a pg NUMERIC string equal to the incoming number, a Date
            // equal to the incoming date string, etc.) reports 0 here. Skipping the
            // write when nothing changed skips BOTH the `ipos` row write AND the
            // per-row cache invalidation `ipoRepository.update()` performs
            // internally (BaseRepository cache-aside) — exactly the pair the S-02
            // §5 write-suppression design calls out. `lastScrapedAt`/`updatedAt`
            // bumps are deliberately foregone on a true no-op cycle; the next
            // cycle that DOES change a field still refreshes them via `finalData`.
            const isNoopUpdate = (consolidationResult.fieldsUpdated ?? 0) === 0;
            if (isNoopUpdate) {
              logger.debug({
                ipoId: existingIPO.id,
                companyName: scrapedIPO.companyName,
                source,
                noop: true,
              }, '[DataConsolidation] No field actually changed — skipping ipos row update + cache invalidation');
            } else {
              // Update IPO with consolidated data
              await ipoRepository.update(existingIPO.id, finalData);
            }

            // S-02: the consolidation door is also the F4/F5/F6 evidence — it is
            // the thing that compared sources and wrote the conflict + provenance
            // rows, so its own result is what the ledger records.
            ledgerFacts = {
              source,
              created: false,
              fields: Object.keys(finalData),
              offeringType: (finalData as { offeringType?: string }).offeringType ?? null,
              consolidated: true,
              conflictsDetected: consolidationResult.conflictsDetected ?? 0,
              conflictsBySeverity: consolidationResult.conflictsBySeverity ?? {},
              fieldSourcesWritten: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
              companyName: scrapedIPO.companyName,
            };

            // W-17/W-18(i) (Deepa walk, 2026-09-02): the consolidation service is
            // the SINGLE writer of `field_sources` on this path. The re-track that
            // used to run here re-wrote every field whose `chosenSource` equalled
            // this scrape's source — including values it had merely KEPT (the
            // NO_INCOMING_VALUE branch reports `chosenSource = incomingSource`
            // when the field has no provenance row) — with `source = <this
            // scrape>` and `previousValue = fr.existingValue`, a property that
            // does not exist on FieldConsolidationResult and was therefore always
            // null. Result: every provenance row lost its history, and a BSE value
            // got re-badged as NSE, after which resolveConflict's same-source
            // short-circuit dropped the next real cross-source conflict.

            // Log successful consolidation
            logger.info({
              ipoId: existingIPO.id,
              companyName: scrapedIPO.companyName,
              source,
              fieldsUpdated: consolidationResult.fieldsUpdated,
              conflictsDetected: consolidationResult.conflictsDetected,
              performanceMs: consolidationDuration,
            }, '[DataConsolidation] Updated IPO with consolidated data');

            // Log performance warning if slow
            if (consolidationDuration > 500) {
              logger.warn({
                ipoId: existingIPO.id,
                source,
                performanceMs: consolidationDuration,
              }, '[DataConsolidation] Consolidation exceeded 500ms target');
            }

            // Log critical conflicts for review
            if (consolidationResult.conflictsBySeverity.CRITICAL > 0) {
              logger.error({
                ipoId: existingIPO.id,
                companyName: scrapedIPO.companyName,
                source,
                criticalConflicts: consolidationResult.conflictsBySeverity.CRITICAL,
              }, '[DataConsolidation] ⚠️  CRITICAL CONFLICTS - Review priority matrix');
            }

            return existingIPO.id;

          } catch (error: any) {
            // Consolidation failure - fall back to simple update
            logger.error({
              ipoId: existingIPO.id,
              source,
              error: error?.message,
              stack: error?.stack,
            }, '[DataConsolidation] Consolidation failed - falling back to simple update');

            // Fall through to fallback logic below
          }
        }
        // ========== END CONSOLIDATION ==========

        // ========== PHASE 4: LEGACY MERGE REMOVED ==========
        // All IPO updates now handled by consolidation service above.
        // This code should never be reached with CONSOLIDATION_PERCENTAGE=100.
        // If we reach here, consolidation failed and fallback already logged error.
        logger.warn({
          ipoId: existingIPO.id,
          slug,
          source,
        }, '[LEGACY PATH] consolidation did not handle this update - applying the non-destructive fallback');

        // Fallback: non-destructive update (W-16a, Deepa walk 2026-09-02).
        // This safety net used to write the raw incoming payload, so a source
        // that simply has no data for a field (NSE carries no lead managers)
        // nulled it, and `listingExchanges` was replaced rather than merged.
        // It stays reachable by design — it is what runs when consolidation
        // throws — so it is made SAFE rather than declared unreachable.
        const fallbackData: any = {
          ...buildNonDestructiveUpdate(existingIPO as any, ipoData),
          listingExchanges: mergeListingExchangesForSource(
            (existingIPO as any).listingExchanges,
            source,
            scrapedIPO.listingExchange
          ),
          lastScrapedAt: new Date(),
          updatedAt: new Date(),
        };
        // Same classification guard as the consolidation path (above) — only
        // applied when an offering_type is present, so the safety-net update
        // never writes undefined to the NOT NULL offering_type column.
        if (fallbackData.offeringType) {
          fallbackData.offeringType = resolveOfferingTypeKeepingClassification(
            (existingIPO as any).offeringType,
            fallbackData.offeringType
          );
        }
        await ipoRepository.update(existingIPO.id, fallbackData);

        // S-02: the fallback door wrote the row but ran no consolidation, so F4
        // and F5 are deliberately NOT claimed here — nothing compared sources
        // this time. Recording them anyway would make the ledger lie about the
        // one path where cross-verification did not happen.
        ledgerFacts = {
          source,
          created: false,
          fields: Object.keys(fallbackData),
          offeringType: fallbackData.offeringType ?? null,
          consolidated: false,
          fieldSourcesWritten: false,
          companyName: scrapedIPO.companyName,
        };

        return existingIPO.id;
      } else {
        // Create new IPO
        logger.debug({ slug, source }, `Creating new ${source} IPO`);
        const newIPO = await ipoRepository.create({
          ...ipoData,
          createdAt: new Date()
        } as IPOInsert);

        // P3-11 (T-292): lineage was previously written only on the UPDATE path
        // (inside consolidation, above) — a brand-new row had ZERO field_sources
        // rows, which is exactly why P2-5's Priority Jewels row had no provenance
        // to show it was single-sourced. Track every field this scrape actually
        // supplied, at full confidence, with no prior value (there is no prior row).
        if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
          const fieldsToTrack = Object.entries(ipoData)
            .filter(([, value]) => value !== undefined)
            .map(([fieldName]) => ({
              fieldName,
              source,
              confidence: 100,
              previousValue: null,
            }));

          if (fieldsToTrack.length > 0) {
            const fieldSourcesRepo = new FieldSourcesRepository(db, getRedisClient());
            await fieldSourcesRepo.bulkTrackFieldUpdates(newIPO.id, 'ipos', fieldsToTrack);
          }
        }

        ledgerFacts = {
          source,
          created: true,
          fields: Object.keys(ipoData).filter((k) => (ipoData as Record<string, unknown>)[k] !== undefined),
          offeringType: (ipoData as { offeringType?: string }).offeringType ?? null,
          consolidated: false,
          fieldSourcesWritten: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING,
          companyName: scrapedIPO.companyName,
        };

        logger.info({ slug, source }, `New ${source} IPO ${slug} created`);
        return newIPO.id;
      }
    },
    `Upsert IPO: ${scrapedIPO.companyName}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { companyName: scrapedIPO.companyName, ipoId: result, source, duration },
    'IPO upserted successfully'
  );

  // S-02 hook — the step ledger. Best-effort, after the primary write, exactly
  // like every other post-write side effect (`non-fatal-side-effects.md`): the
  // recorders never throw, and the ledger is bookkeeping about the scrape, not
  // part of it. `initStepLedger` runs on the CREATE path so a brand-new IPO has
  // all 52 catalogue rows without anyone running the backfill script.
  if (ledgerFacts) {
    if (ledgerFacts.created) await initStepLedger(result);
    await recordDiscoverySteps(result, ledgerFacts);
  }

  return result;
}

const SUBSCRIPTION_TIMESTAMP_MAX_FUTURE_MS = 5 * 60 * 1000; // 5 minutes
const SUBSCRIPTION_TIMESTAMP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * W-38: resolve the timestamp to persist on a subscription snapshot. The source
 * (NSE/BSE) stamps `scrapedSubscription.timestamp` with the actual observation
 * time; that MUST win over "now" or every re-write of a stale scrape looks fresh
 * and charts plot the wrong x-axis. Falls back to now() only when the source
 * didn't ship a timestamp; a source timestamp that is implausible (garbage guard:
 * >5 min in the future, or >30 days old) is rejected rather than trusted.
 */
export function resolveSubscriptionSnapshotTimestamp(
  rawTimestamp: string | Date | undefined,
  context: { ipoId: string; companyName?: string }
): { timestamp: Date } | { skip: true; reason: string } {
  const now = new Date();

  if (rawTimestamp === undefined || rawTimestamp === null) {
    return { timestamp: now };
  }

  const parsed = rawTimestamp instanceof Date ? rawTimestamp : new Date(rawTimestamp);
  if (isNaN(parsed.getTime())) {
    logger.warn(
      { ipoId: context.ipoId, companyName: context.companyName, rawTimestamp },
      'Subscription source timestamp unparseable — falling back to now() (W-38)'
    );
    return { timestamp: now };
  }

  const deltaMs = parsed.getTime() - now.getTime();
  if (deltaMs > SUBSCRIPTION_TIMESTAMP_MAX_FUTURE_MS) {
    const reason = 'source timestamp more than 5 minutes in the future';
    logger.warn(
      { ipoId: context.ipoId, companyName: context.companyName, sourceTimestamp: parsed.toISOString(), now: now.toISOString() },
      `Subscription snapshot skipped — ${reason} (W-38)`
    );
    return { skip: true, reason };
  }

  if (-deltaMs > SUBSCRIPTION_TIMESTAMP_MAX_AGE_MS) {
    const reason = 'source timestamp older than 30 days';
    logger.warn(
      { ipoId: context.ipoId, companyName: context.companyName, sourceTimestamp: parsed.toISOString(), now: now.toISOString() },
      `Subscription snapshot skipped — ${reason} (W-38)`
    );
    return { skip: true, reason };
  }

  return { timestamp: parsed };
}

/**
 * W-03: derive the market-coverage label to persist on a subscription
 * snapshot. NSE's consolidated payload (`coverage: 'CONSOLIDATED'`) always
 * wins; otherwise fall back to the writing source's own book (BSE/NSE);
 * unrecognized/absent source -> null (old-shape rows stay valid via the
 * nullable column).
 */
export function resolveSubscriptionScope(
  scrapedSubscription: Pick<ScrapedSubscription, 'coverage'>,
  options: { source?: string }
): 'BSE_ONLY' | 'NSE_ONLY' | 'CONSOLIDATED' | null {
  if (scrapedSubscription.coverage === 'CONSOLIDATED') {
    return 'CONSOLIDATED';
  }

  switch (options.source?.toUpperCase()) {
    case 'BSE':
      return 'BSE_ONLY';
    case 'NSE':
      return 'NSE_ONLY';
    default:
      return null;
  }
}

/**
 * Create subscription snapshot with retry logic and validation
 * Enhanced for Story 11.3 - validates subscription data before persistence (AC4, AC6)
 * @param subscriptionRepository - Subscription repository instance
 * @param ipoId - IPO ID to associate subscription with
 * @param scrapedSubscription - Validated scraped subscription data
 * @returns Subscription ID on success
 */
export async function createSubscriptionSnapshot(
  subscriptionRepository: SubscriptionRepository,
  ipoId: string,
  scrapedSubscription: ScrapedSubscription,
  options: { source?: string; redis?: SuppressionCounterStore | null } = {}
): Promise<string | null> {
  const startTime = Date.now();

  // T-266/T-299: never let a snapshot REDUCE the figure already persisted for
  // this IPO, unless it is explicitly whole-market and share-count-backed.
  // Compares against the last PERSISTED row (not in-process memory) so the
  // check is correct on the very first write of a cold process.
  const lastPersisted = await subscriptionRepository.findLatest(ipoId);
  const persistedTotal =
    lastPersisted?.totalSubscription != null
      ? parseFloat(lastPersisted.totalSubscription)
      : null;
  const normalizedPersistedTotal = persistedTotal !== null && !isNaN(persistedTotal) ? persistedTotal : null;

  const allowed = shouldPersistSubscriptionSnapshot(
    ipoId,
    scrapedSubscription.coverage,
    {
      totalSubscription: scrapedSubscription.totalSubscription,
      totalSharesBid: scrapedSubscription.totalSharesBid,
    },
    normalizedPersistedTotal,
    {
      companyName: scrapedSubscription.ipoCompanyName,
      source: options.source,
    }
  );

  // T-306 F4 follow-up: fire-and-forget, non-fatal streak tracking + owner
  // alert (see non-fatal-side-effects.md) — never delays or blocks the write.
  void recordSuppressionOutcome(options.redis, ipoId, !allowed, {
    companyName: scrapedSubscription.ipoCompanyName,
    persistedTotal: normalizedPersistedTotal,
    candidateTotal: scrapedSubscription.totalSubscription,
  }).catch(() => {
    // recordSuppressionOutcome already catches internally; this is a final backstop.
  });

  if (!allowed) {
    return null;
  }

  // W-38: honour the source's own observation time instead of always stamping
  // "now" — a stale re-write must not masquerade as a fresh reading.
  const resolvedTimestamp = resolveSubscriptionSnapshotTimestamp(scrapedSubscription.timestamp, {
    ipoId,
    companyName: scrapedSubscription.ipoCompanyName,
  });
  if ('skip' in resolvedTimestamp) {
    return null;
  }

  logger.debug({
    ipoId,
    companyName: scrapedSubscription.ipoCompanyName,
    qib: scrapedSubscription.qibSubscription,
    nii: scrapedSubscription.niiSubscription,
    retail: scrapedSubscription.retailSubscription,
    total: scrapedSubscription.totalSubscription
  }, 'Creating subscription snapshot (AC4)');

  const result = await retryWithBackoff(
    async () => {
      // Prepare subscription data for database insert (AC4)
      const subscriptionData: SubscriptionInsert = {
        ipoId,
        // W-38: source observation time (falls back to now() only when absent).
        timestamp: resolvedTimestamp.timestamp,
        qibSubscription: scrapedSubscription.qibSubscription.toString(),
        niiSubscription: scrapedSubscription.niiSubscription.toString(),
        retailSubscription: scrapedSubscription.retailSubscription.toString(),
        totalSubscription: scrapedSubscription.totalSubscription.toString(),
        employeeSubscription: scrapedSubscription.employeeSubscription?.toString(),
        anchorInvestorSubscription: scrapedSubscription.anchorInvestorSubscription?.toString(),
        bNIISubscription: scrapedSubscription.bNIISubscription?.toString(),
        sNIISubscription: scrapedSubscription.sNIISubscription?.toString(),
        retailHNISubscription: scrapedSubscription.retailHNISubscription?.toString(),
        retailOthersSubscription: scrapedSubscription.retailOthersSubscription?.toString(),
        // T-266: the share counts behind the multiples, when the source ships them.
        totalSharesBid: scrapedSubscription.totalSharesBid,
        sharesOffered: scrapedSubscription.sharesOffered,
        // W-03: BSE_ONLY | NSE_ONLY | CONSOLIDATED | null.
        scope: resolveSubscriptionScope(scrapedSubscription, { source: options.source })
      };

      // Validate foreign key constraint (IPO must exist) before insert (AC4)
      try {
        const snapshot = await subscriptionRepository.createSnapshot(subscriptionData);
        logger.debug({
          ipoId,
          subscriptionId: snapshot.id,
          timestamp: subscriptionData.timestamp
        }, 'Subscription snapshot persisted successfully (AC4)');
        // S-02 hook — H1. One row per IPO per run; the snapshot's own scope and
        // total are the evidence, so the ledger answers "when did subscription
        // last actually land, and what did it say?" without a second query.
        await recordLiveStep(ipoId, 'H1', {
          source: options.source ?? null,
          evidence: {
            subscriptionId: snapshot.id,
            scope: subscriptionData.scope ?? null,
            total: subscriptionData.totalSubscription ?? null,
            timestamp: subscriptionData.timestamp,
          },
        });
        return snapshot.id;
      } catch (dbError: any) {
        // Enhanced PostgreSQL error logging (Story 11.2, AC4)
        logger.error({
          ipoId,
          companyName: scrapedSubscription.ipoCompanyName,
          error: dbError?.message,
          code: dbError?.code,
          constraint: dbError?.constraint,
          detail: dbError?.detail,
          table: dbError?.table
        }, 'Database insert failed for subscription snapshot (AC4)');
        throw dbError;
      }
    },
    `Create subscription snapshot for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    {
      ipoId,
      subscriptionId: result,
      companyName: scrapedSubscription.ipoCompanyName,
      coverage: scrapedSubscription.coverage ?? 'unlabelled',
      total: scrapedSubscription.totalSubscription,
      duration
    },
    'Subscription snapshot created successfully (AC4, AC6)'
  );

  return result;
}

/**
 * Create GMP (Grey Market Premium) record with retry logic
 * @param gmpRepository - GMP repository instance
 * @param ipoId - IPO ID to associate GMP record with
 * @param gmp - GMP value in rupees
 * @param timestamp - Optional timestamp (defaults to now)
 * @param gmpPercentage - GMP as % of issue price (from the source); stored only
 *   when finite, else null (B1/G11). We persist the source's own figure rather
 *   than recomputing from issue_price — InvestorGain supplies it directly, so it
 *   never diverges from the gmp it reported and needs no extra IPO read.
 * @returns GMP record ID on success
 */
/** A demand-graph data point as produced by extractDemandGraphData() (NSE/BSE). */
export interface ScrapedDemandPoint {
  pricePoint: number | null;
  isCutOff: boolean;
  cumulativeQuantity: number;
  exchange?: 'NSE' | 'BSE' | 'BOTH';
  timestamp?: string | Date;
}

/**
 * Pure mapper: scraped demand points -> ipo_demand_graph insert rows. Drops points
 * with a non-positive/Non-finite cumulative quantity (no real demand to record).
 * Exported for unit testing. `pricePoint` -> string for the numeric column; null for
 * the Cut-Off row. Kept pure (no IO) so it is unit-testable.
 */
export function mapDemandPointsToRows(ipoId: string, points: ScrapedDemandPoint[]): Array<{
  ipoId: string; timestamp: Date; pricePoint: string | null; isCutOff: boolean;
  cumulativeQuantity: number; exchange: 'NSE' | 'BSE' | 'BOTH';
}> {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && Number.isFinite(p.cumulativeQuantity) && p.cumulativeQuantity > 0)
    .map((p) => ({
      ipoId,
      timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
      pricePoint: p.pricePoint != null && Number.isFinite(p.pricePoint) ? p.pricePoint.toString() : null,
      isCutOff: !!p.isCutOff,
      cumulativeQuantity: p.cumulativeQuantity,
      exchange: p.exchange || 'NSE',
    }));
}

/**
 * Persist a demand-graph snapshot for an IPO (Stage D). The NSE ipo-detail demand
 * block was fetched but never stored (NO writer existed → ipo_demand_graph 0% root
 * cause). Inserts the latest fetched price-wise cumulative-demand points. Returns the
 * number of rows written (0 when there is nothing plausible to store). Routed through
 * data-persister per scraper-write-path.md.
 */
export async function createDemandGraphSnapshot(
  ipoId: string,
  points: ScrapedDemandPoint[]
): Promise<number> {
  const rows = mapDemandPointsToRows(ipoId, points);
  if (rows.length === 0) {
    logger.debug({ ipoId }, 'No plausible demand points to persist');
    return 0;
  }
  await db.insert(ipoDemandGraph).values(rows);
  logger.info({ ipoId, points: rows.length, exchange: rows[0].exchange }, 'Demand graph snapshot persisted');
  // S-02 hook — H4.
  await recordLiveStep(ipoId, 'H4', {
    source: rows[0].exchange ?? null,
    evidence: { points: rows.length, exchange: rows[0].exchange ?? null },
  });
  return rows.length;
}

export async function createGMPRecord(
  gmpRepository: GMPRepository,
  ipoId: string,
  gmp: number,
  timestamp: Date = new Date(),
  gmpPercentage?: number | null
): Promise<string> {
  const startTime = Date.now();

  logger.debug({ ipoId, gmp, timestamp }, 'Creating GMP record');

  const result = await retryWithBackoff(
    async () => {
      const pct =
        gmpPercentage != null && Number.isFinite(gmpPercentage)
          ? Math.round(gmpPercentage * 100) / 100 // 2dp number (column is numeric, mode:'number')
          : null;
      const gmpData: GMPRecordInsert = {
        ipoId,
        // gmp_records.gmp is numeric(10,2) (B2 applied to prod) — store the value
        // as-is; Postgres rounds to 2dp. No Math.round (it truncated fractional GMP).
        gmp,
        gmpPercentage: pct,
        timestamp,
        source: 'INVESTORGAIN_GMP',
      };

      const gmpRecord = await gmpRepository.create(gmpData);
      return gmpRecord.id;
    },
    `Create GMP record for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { ipoId, gmpRecordId: result, gmp, duration },
    'GMP record created successfully'
  );

  // S-02 hook — H2 (the GMP write) and F3 (InvestorGain is the only GMP source,
  // so a GMP landing IS the InvestorGain cross-verification touching this IPO).
  await recordLiveStep(ipoId, 'H2', {
    source: 'INVESTORGAIN_GMP',
    evidence: { gmpRecordId: result, gmp, gmpPercentage, timestamp },
  });
  await recordLiveStep(ipoId, 'F3', {
    source: 'INVESTORGAIN_GMP',
    evidence: { matchedBy: 'gmp record', gmp },
  });

  return result;
}

/**
 * Create or update financial data for an IPO with retry logic
 * @param financialDataRepository - Financial data repository instance
 * @param scrapedFinancialData - Scraped financial metrics from DRHP
 * @returns Financial data ID on success
 */
export async function createFinancialData(
  financialDataRepository: FinancialDataRepository,
  scrapedFinancialData: ScrapedFinancialData
): Promise<string> {
  const startTime = Date.now();
  const { ipoId } = scrapedFinancialData;

  logger.debug({ ipoId }, 'Creating/updating financial data');

  const result = await retryWithBackoff(
    async () => {
      // Prepare financial data insert object
      const financialData: FinancialDataInsert = {
        ipoId: scrapedFinancialData.ipoId,
        // Revenue by fiscal year (in INR crores)
        revenueFy2022: scrapedFinancialData.revenueFy2022?.toString(),
        revenueFy2023: scrapedFinancialData.revenueFy2023?.toString(),
        revenueFy2024: scrapedFinancialData.revenueFy2024?.toString(),
        // Profit by fiscal year (in INR crores)
        profitFy2022: scrapedFinancialData.profitFy2022?.toString(),
        profitFy2023: scrapedFinancialData.profitFy2023?.toString(),
        profitFy2024: scrapedFinancialData.profitFy2024?.toString(),
        // EBITDA by fiscal year
        ebitdaFy2022: scrapedFinancialData.ebitdaFy2022?.toString(),
        ebitdaFy2023: scrapedFinancialData.ebitdaFy2023?.toString(),
        ebitdaFy2024: scrapedFinancialData.ebitdaFy2024?.toString(),
        // Total Income by fiscal year
        totalIncomeFy2022: scrapedFinancialData.totalIncomeFy2022?.toString(),
        totalIncomeFy2023: scrapedFinancialData.totalIncomeFy2023?.toString(),
        totalIncomeFy2024: scrapedFinancialData.totalIncomeFy2024?.toString(),
        // Financial ratios and metrics
        netWorth: scrapedFinancialData.netWorth?.toString(),
        peRatio: scrapedFinancialData.peRatio?.toString(),
        eps: scrapedFinancialData.eps?.toString(),
        roe: scrapedFinancialData.roe?.toString(),
        ronw: scrapedFinancialData.ronw?.toString(),
        debtToEquity: scrapedFinancialData.debtToEquity?.toString(),
        reservesAndSurplus: scrapedFinancialData.reservesAndSurplus?.toString(),
        totalAssets: scrapedFinancialData.totalAssets?.toString(),
        totalBorrowing: scrapedFinancialData.totalBorrowing?.toString(),
        // Promoter holding
        promoterHoldingPreIssue: scrapedFinancialData.promoterHoldingPreIssue?.toString(),
        promoterHoldingPostIssue: scrapedFinancialData.promoterHoldingPostIssue?.toString(),
        // Additional metrics
        marketCap: scrapedFinancialData.marketCap?.toString(),
        preIpoEps: scrapedFinancialData.preIpoEps?.toString(),
        postIpoEps: scrapedFinancialData.postIpoEps?.toString(),
      };

      // Upsert financial data (creates new or updates existing)
      const result = await financialDataRepository.upsert(financialData);
      return result.id;
    },
    `Create financial data for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Count how many fields were populated
  const populatedFields = Object.values(scrapedFinancialData).filter(
    (val) => val !== null && val !== undefined
  ).length;

  logger.info(
    {
      ipoId,
      financialDataId: result,
      duration,
      fieldsPopulated: populatedFields,
    },
    'Financial data created/updated successfully'
  );

  return result;
}

/**
 * Create or update peer companies for an IPO with retry logic
 * Deletes existing peer companies and creates fresh data
 *
 * @param peerCompanyRepository - Peer company repository instance
 * @param ipoId - IPO identifier
 * @param scrapedPeers - Array of scraped peer companies
 * @returns Number of peer companies created
 */
export async function createPeerCompanies(
  peerCompanyRepository: PeerCompanyRepository,
  ipoId: string,
  scrapedPeers: ScrapedPeerCompany[]
): Promise<number> {
  const startTime = Date.now();

  logger.debug({ ipoId, peerCount: scrapedPeers.length }, 'Creating peer companies');

  if (scrapedPeers.length === 0) {
    logger.warn({ ipoId }, 'No peer companies to create');
    return 0;
  }

  const result = await retryWithBackoff(
    async () => {
      // Step 1: Delete existing peer companies for this IPO
      const deletedCount = await peerCompanyRepository.deleteByIPOId(ipoId);
      if (deletedCount > 0) {
        logger.debug({ ipoId, deletedCount }, 'Deleted existing peer companies');
      }

      // Step 2: Prepare peer company data
      const peerCompanyData = scrapedPeers.map((peer) => ({
        ipoId,
        companyName: peer.companyName,
        sector: peer.sector || null,
        isListed: peer.isListed,
        peRatio: peer.peRatio?.toString() || null,
        eps: peer.eps?.toString() || null,
        dilutedEps: peer.dilutedEps?.toString() || null,
        ronw: peer.ronw?.toString() || null,
        nav: peer.nav?.toString() || null,
        pbvRatio: peer.pbvRatio?.toString() || null,
        financialStatementType: null, // Not available from Moneycontrol
        dataSource: peer.dataSource || 'MONEYCONTROL',
        lastUpdated: new Date(),
      }));

      // Step 3: Batch insert peer companies
      const createdPeers = await peerCompanyRepository.batchCreate(peerCompanyData);

      return createdPeers.length;
    },
    `Create peer companies for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Calculate metrics
  const peersWithPE = scrapedPeers.filter((p) => p.peRatio !== undefined).length;
  const peersWithEPS = scrapedPeers.filter((p) => p.eps !== undefined).length;
  const peersWithRONW = scrapedPeers.filter((p) => p.ronw !== undefined).length;

  logger.info(
    {
      ipoId,
      peerCount: result,
      duration,
      metrics: {
        withPE: peersWithPE,
        withEPS: peersWithEPS,
        withRONW: peersWithRONW,
      },
    },
    'Peer companies created successfully'
  );

  return result;
}

/**
 * Create anchor investor record with retry logic
 *
 * @param anchorInvestorRepository - Anchor investor repository instance
 * @param ipoId - IPO ID to associate anchor investors with
 * @param anchorData - Scraped anchor investor data
 * @returns Anchor investor record ID on success
 */
export async function createAnchorInvestors(
  anchorInvestorRepository: any, // AnchorInvestorRepository type
  ipoId: string,
  anchorData: {
    bidDate: Date | null;
    totalSharesOffered: number;
    totalAmountRaised: number;
    anchorInvestorsCount: number;
    lockIn50PercentDate: Date | null;
    lockInRemainingDate: Date | null;
    investorList: any[];
  }
): Promise<string> {
  const startTime = Date.now();

  logger.debug({
    ipoId,
    anchorInvestorsCount: anchorData.anchorInvestorsCount,
    totalAmountRaised: anchorData.totalAmountRaised
  }, 'Creating anchor investor record');

  const result = await retryWithBackoff(
    async () => {
      // Check if anchor data already exists
      const existing = await anchorInvestorRepository.findByIPOId(ipoId);

      if (existing) {
        // Update existing record
        await anchorInvestorRepository.update(existing.id, {
          bidDate: anchorData.bidDate,
          totalSharesOffered: anchorData.totalSharesOffered,
          totalAmountRaised: anchorData.totalAmountRaised,
          anchorInvestorsCount: anchorData.anchorInvestorsCount,
          lockIn50PercentDate: anchorData.lockIn50PercentDate,
          lockInRemainingDate: anchorData.lockInRemainingDate,
          investorList: anchorData.investorList
        });

        logger.info({ ipoId, anchorInvestorId: existing.id }, 'Updated anchor investor record');
        return existing.id;
      } else {
        // Create new record
        const anchorInvestor = await anchorInvestorRepository.create({
          ipoId,
          bidDate: anchorData.bidDate,
          totalSharesOffered: anchorData.totalSharesOffered,
          totalAmountRaised: anchorData.totalAmountRaised,
          anchorInvestorsCount: anchorData.anchorInvestorsCount,
          lockIn50PercentDate: anchorData.lockIn50PercentDate,
          lockInRemainingDate: anchorData.lockInRemainingDate,
          investorList: anchorData.investorList
        });

        logger.info({ ipoId, anchorInvestorId: anchorInvestor.id }, 'Created anchor investor record');
        return anchorInvestor.id;
      }
    },
    `Create anchor investors for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  logger.info(
    {
      ipoId,
      anchorInvestorId: result,
      anchorInvestorsCount: anchorData.anchorInvestorsCount,
      totalAmountRaised: anchorData.totalAmountRaised,
      duration
    },
    'Anchor investor record persisted successfully'
  );

  return result;
}

// ==================== IPO REVIEWS ====================

/**
 * Create or update IPO reviews with retry logic
 * @param reviewRepository - Review repository instance
 * @param ipoId - IPO ID to associate reviews with
 * @param segment - IPO segment (MAINBOARD/SME)
 * @param scrapedReviews - Array of scraped reviews
 * @returns Number of reviews created/updated
 */
export async function createIPOReviews(
  reviewRepository: any, // ReviewRepository type
  ipoId: string,
  segment: 'MAINBOARD' | 'SME',
  scrapedReviews: Array<{
    source: string;
    author: string;
    reviewTitle: string;
    recommendation: 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended';
    publishedDate: Date;
    reviewContent: string;
    reviewUrl?: string;
  }>
): Promise<number> {
  const startTime = Date.now();

  if (scrapedReviews.length === 0) {
    logger.info({ ipoId }, 'No reviews to persist (empty array)');
    return 0;
  }

  const result = await retryWithExponentialBackoff(
    async () => {
      let createdCount = 0;
      let updatedCount = 0;

      // Process each review with upsert logic (create or update if exists)
      for (const review of scrapedReviews) {
        const year = review.publishedDate.getFullYear();

        // Check if review already exists (by IPO ID + author)
        const existing = await reviewRepository.findByIPOIdAndAuthor(ipoId, review.author);

        if (existing) {
          // Update existing review
          await reviewRepository.update(existing.id, {
            reviewTitle: review.reviewTitle,
            recommendation: review.recommendation,
            reviewContent: review.reviewContent,
            reviewUrl: review.reviewUrl,
            publishedDate: review.publishedDate,
            year,
            segment,
            isApproved: false, // Reset approval on update
          });
          updatedCount++;
          logger.debug({ ipoId, author: review.author }, 'Updated existing review');
        } else {
          // Create new review
          await reviewRepository.create({
            ipoId,
            reviewTitle: review.reviewTitle,
            author: review.author,
            recommendation: review.recommendation,
            reviewContent: review.reviewContent,
            reviewUrl: review.reviewUrl,
            publishedDate: review.publishedDate,
            year,
            segment,
            isApproved: false, // Requires moderation
          });
          createdCount++;
          logger.debug({ ipoId, author: review.author }, 'Created new review');
        }
      }

      logger.info(
        { ipoId, created: createdCount, updated: updatedCount, total: scrapedReviews.length },
        'IPO reviews persisted successfully'
      );

      return createdCount + updatedCount;
    },
    `Create IPO reviews for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  logger.info(
    {
      ipoId,
      reviewsProcessed: result,
      totalReviews: scrapedReviews.length,
      duration
    },
    'IPO reviews persistence complete'
  );

  return result;
}

// ==================== IPO OBJECTIVES ====================

/**
 * Update IPO objectives (use of funds) with retry logic
 * Updates the objectives field in the ipos table with parsed DRHP data
 *
 * @param ipoRepository - IPO repository instance
 * @param ipoId - IPO ID to update
 * @param objectives - Array of IPO objectives from DRHP
 * @returns void on success
 */
export async function updateIPOObjectives(
  ipoRepository: IPORepository,
  ipoId: string,
  objectives: Array<{
    sno: number;
    description: string;
    amount: number | null;
  }>
): Promise<void> {
  const startTime = Date.now();

  if (objectives.length === 0) {
    logger.warn({ ipoId }, 'No objectives to update (empty array)');
    return;
  }

  logger.debug({
    ipoId,
    objectivesCount: objectives.length,
    totalAmount: objectives.reduce((sum, obj) => sum + (obj.amount || 0), 0)
  }, 'Updating IPO objectives');

  await retryWithBackoff(
    async () => {
      // Update the objectives field (JSONB) in ipos table
      await ipoRepository.update(ipoId, {
        objectives: objectives as any, // Drizzle will serialize to JSONB
        updatedAt: new Date()
      });

      logger.debug({ ipoId, objectivesCount: objectives.length }, 'IPO objectives updated');
    },
    `Update objectives for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Calculate metrics
  const objectivesWithAmount = objectives.filter((obj) => obj.amount !== null).length;
  const totalAmount = objectives.reduce((sum, obj) => sum + (obj.amount || 0), 0);

  logger.info(
    {
      ipoId,
      objectivesCount: objectives.length,
      objectivesWithAmount,
      totalAmount,
      duration
    },
    'IPO objectives updated successfully'
  );
}

/**
 * Record the BSE discovery bookkeeping the document pipeline depends on (T-403).
 *
 * Two columns, neither of them scraped IPO CONTENT — they are not in the field
 * priority matrix and no source competes for them:
 *
 *  - `bseIpoNo`: the key BSE's core document API is addressed by. It has to be
 *    remembered because `IPO_HomePageDetail` lists only LIVE and FORTHCOMING
 *    issues — verified 2026-08-28, Skyways (IPO_NO 7903) had already left the
 *    board the day after it closed, which is exactly when its final Prospectus
 *    becomes due. Written whenever a value arrives; there is no write-once
 *    guard here, and none is needed — the IPO_NO is immutable, so a later write
 *    can only ever set the same number.
 *  - `bsePayloadLeadManagerCount`: how many lead managers the BSE payload
 *    ACTUALLY listed, so the nightly audit can FAIL when fewer were stored.
 *    Refreshed every time, because the payload can gain a co-BRLM.
 *
 * Lives HERE rather than in the document cycle because `scraper-write-path.md`
 * and the R0 write ratchet both require every `ipos` write to go through the
 * shared write path. The first cut of T-403 issued `UPDATE ipos SET ...` as raw
 * SQL from `document-cycle.ts` and `check-write-ratchet.mjs` correctly failed it.
 */
export async function recordBseDiscoveryMetadata(
  ipoRepository: IPORepository,
  ipoId: string,
  metadata: { bseIpoNo?: number | null; bsePayloadLeadManagerCount?: number | null }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (metadata.bseIpoNo !== undefined && metadata.bseIpoNo !== null) {
    patch.bseIpoNo = metadata.bseIpoNo;
  }
  if (
    metadata.bsePayloadLeadManagerCount !== undefined &&
    metadata.bsePayloadLeadManagerCount !== null
  ) {
    patch.bsePayloadLeadManagerCount = metadata.bsePayloadLeadManagerCount;
  }
  if (Object.keys(patch).length === 0) return;

  patch.updatedAt = new Date();
  await ipoRepository.update(ipoId, patch as never);
  logger.debug({ ipoId, ...patch }, 'Recorded BSE discovery metadata');
}

/**
 * Record the document-source hints the discovery chain's later rungs need
 * (T-403 M-6): the issuer's own website and the third-party verifier page.
 *
 * WHY IT EXISTS. Rung 4 (the issuer's investor page) and the Chittorgarh
 * verifier were unreachable in production before this — nothing in the schema
 * held either URL, so the chain could only ever record
 * `COMPANY:skipped:no_company_url` / `VERIFIER:skipped:no_verifier_url`. Two
 * rungs of the decision tree existed only in tests.
 *
 * Neither is scraped CONTENT: no source competes over them and neither is in
 * the field-priority matrix. They are pointers this pipeline uses to find
 * filings. They still go through the shared write path, like
 * `recordBseDiscoveryMetadata` — `scraper-write-path.md` and the R0 ratchet
 * make no exception for bookkeeping.
 *
 * WRITE-ONCE for `companyWebsite`: it is read off a filing cover, and a later
 * cover must not overwrite a value an admin may have corrected. `verifierUrl`
 * refreshes, because the source re-slugs its URLs.
 */
/**
 * The one thing this function needs from a repository (H-1).
 *
 * Narrowed to `updateDocumentSourceHints`, a method that writes exactly these
 * two columns and returns only the id. The wide `update()` cannot be used: it
 * ends in a bare `.returning()`, which asks for all 55 columns `schema.ts`
 * declares, and a journal-built `ipos` has 32 — so a two-column patch fails
 * there on columns it never touched. Narrowing it is also what lets the
 * acceptance harness pass the REAL repository rather than a raw-SQL stand-in,
 * which would have put an `ipos` writer outside the shared write path (the
 * write ratchet catches exactly that, and was right to).
 */
export interface DocumentSourceHintWriter {
  updateDocumentSourceHints(
    id: string,
    hints: { companyWebsite?: string; verifierUrl?: string }
  ): Promise<unknown>;
}

export async function recordDocumentSourceHints(
  ipoRepository: DocumentSourceHintWriter,
  ipoId: string,
  hints: { companyWebsite?: string | null; verifierUrl?: string | null },
  existing?: { companyWebsite?: string | null }
): Promise<void> {
  // M-b: validate the HOST on the way in, not only where it is read. Both of
  // these are fetched later by the discovery runner, and a row written by any
  // other process (a backfill, an admin edit, a future scraper) reaches that
  // fetch through this same column. `normalizeCompanyUrl` also refuses
  // loopback / private / link-local hosts and non-default ports.
  const website = normalizeCompanyUrl(hints.companyWebsite);
  const verifier = isVerifierUrl(hints.verifierUrl) ? (hints.verifierUrl as string).trim() : null;
  if (hints.companyWebsite && !website) {
    logger.warn({ ipoId, value: hints.companyWebsite }, 'Rejected company website hint — unsafe or non-issuer host');
  }
  if (hints.verifierUrl && !verifier) {
    logger.warn({ ipoId, value: hints.verifierUrl }, 'Rejected verifier hint — not a chittorgarh.com https URL');
  }

  const patch: Record<string, unknown> = {};
  // Write-once: only set a website when we do not already hold one.
  if (website && !existing?.companyWebsite) patch.companyWebsite = website.slice(0, 255);
  if (verifier) patch.verifierUrl = verifier.slice(0, 512);
  if (Object.keys(patch).length === 0) return;

  await ipoRepository.updateDocumentSourceHints(ipoId, patch as never);
  logger.debug({ ipoId, website: Boolean(patch.companyWebsite), verifier: Boolean(verifier) }, 'Recorded document source hints');
}
