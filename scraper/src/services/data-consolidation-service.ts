/**
 * Data Consolidation Service
 * Intelligently merges IPO data from multiple scrapers
 *
 * Core Responsibilities:
 * 1. Compare incoming scraper data with existing database values
 * 2. Detect conflicts using normalized comparison
 * 3. Resolve conflicts based on field-specific priority matrix
 * 4. Track which scraper provided each field (audit trail)
 * 5. Log conflicts for admin review
 *
 * Architecture:
 * - Uses field-priority-matrix for source priority
 * - Uses normalization-engine for accurate value comparison
 * - Uses field-sources-repository for audit tracking
 * - Uses data-conflicts-repository for conflict logging
 * - Implements distributed locking to prevent race conditions
 *
 * Performance:
 * - Target: <500ms per IPO consolidation
 * - Batch processing support for multiple fields
 * - Redis caching for frequently accessed data
 */

import type {
  ScraperSource,
  FieldRules,
} from '../config/field-priority-matrix';
import {
  allowsSameSourceRefresh,
  getFieldRules,
  getSourcePriority,
  isTimeBased,
} from '../config/field-priority-matrix';
import {
  normalize,
  areEquivalent,
  getConflictSeverity,
  validateValue,
} from './normalization-engine';
import { FEATURE_FLAGS, shouldUseFeature } from '../config/feature-flags';

/**
 * Result of field consolidation
 */
export interface FieldConsolidationResult {
  fieldName: string;
  finalValue: any;
  chosenSource: ScraperSource;
  hadConflict: boolean;
  conflictSeverity?: 'INFO' | 'WARNING' | 'CRITICAL';
  conflictReason?: string;
  rejectedSources?: Array<{
    source: ScraperSource;
    value: any;
    reason: string;
  }>;
}

/**
 * Result of full IPO data consolidation
 */
export interface ConsolidationResult {
  ipoId: string;
  fieldsProcessed: number;
  fieldsUpdated: number;
  conflictsDetected: number;
  conflictsBySeverity: {
    INFO: number;
    WARNING: number;
    CRITICAL: number;
  };
  fieldResults: FieldConsolidationResult[];
  consolidatedData?: Record<string, any>; // Final merged data
  errors: Array<{
    fieldName: string;
    error: string;
  }>;
  performanceMs: number;
}

/**
 * Input for consolidation
 */
export interface ConsolidateIPODataInput {
  ipoId: string;
  tableName: string;
  incomingData: Record<string, any>;
  source: ScraperSource;
  existingData?: Record<string, any>;
  confidence?: number; // 0-100 confidence score for incoming data
  shadowMode?: boolean; // If true, returns consolidated data without DB writes
  scrapedAt?: Date; // Timestamp when data was scraped (for time-based priority)
}

/**
 * Conflict information for logging
 */
interface ConflictInfo {
  ipoId: string;
  tableName: string;
  fieldName: string;
  existingValue: any;
  existingSource: ScraperSource;
  incomingValue: any;
  incomingSource: ScraperSource;
  normalizedExisting: any;
  normalizedIncoming: any;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  reason: string;
}

const PRICE_BAND_FIELDS = ['priceRangeMin', 'priceRangeMax'] as const;

function toFiniteNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * T-276/T-281: which price-band fields must be rejected because the incoming
 * band is degenerate (min === max) while a real stored range already exists?
 *
 * Returns an empty set unless BOTH incoming band fields are present and equal
 * AND a stored real range (`min < max`) can be found - a zero-width band is a
 * legitimate value for a FIXED_PRICE issue, so it is only rejected when it
 * would destroy a real range on a book-built issue.
 *
 * T-281 (T-280 live finding): the ORIGINAL guard read the stored range only
 * from `existingSourceMap`, which is populated exclusively from tracked
 * `field_sources` rows. A row repaired by a script that wrote straight to the
 * `ipos` table (the T-276/T-280 backfill discipline) has NO tracked
 * `field_sources` entry, so the guard silently no-opped and a degenerate
 * CHITTORGARH scrape collapsed the repaired range on the very next cycle -
 * this is the cross-source collapse T-280's live-effect check caught. The
 * guard now ALSO falls back to `existingData` (the raw `ipos` row passed by
 * the caller) so an untracked-but-real stored range is still protected,
 * regardless of which source last wrote it or whether it was ever tracked.
 *
 * The FIXED_PRICE exemption uses the `issueType` enum column (BOOK_BUILDING |
 * FIXED_PRICE | HYBRID) - the same signal `data-validation.ts` already uses
 * for the `PRICE_BAND_DEGENERATE` warning - never a heuristic on the values.
 */
export function collectDegeneratePriceBandFields(
  incomingData: Record<string, any>,
  existingSourceMap: Map<string, { value: any; source: ScraperSource; updatedAt?: Date }>,
  existingData?: Record<string, any> | null
): Set<string> {
  const empty = new Set<string>();
  if (!PRICE_BAND_FIELDS.every(f => f in incomingData)) return empty;

  const incomingMin = toFiniteNumber(incomingData.priceRangeMin);
  const incomingMax = toFiniteNumber(incomingData.priceRangeMax);
  if (incomingMin === null || incomingMax === null) return empty;
  if (incomingMin !== incomingMax) return empty; // incoming is a real range

  // Fixed-price issues legitimately have min === max — the offering/issue-type
  // signal (same field `data-validation.ts` checks for PRICE_BAND_DEGENERATE),
  // not a heuristic on the incoming/stored values. Checked on both sides: the
  // freshest scrape may carry the classification even when the stored row
  // predates it, or vice versa.
  if (incomingData.issueType === 'FIXED_PRICE' || existingData?.issueType === 'FIXED_PRICE') {
    return empty;
  }

  const existingMin = toFiniteNumber(
    existingSourceMap.get('priceRangeMin')?.value ?? existingData?.priceRangeMin
  );
  const existingMax = toFiniteNumber(
    existingSourceMap.get('priceRangeMax')?.value ?? existingData?.priceRangeMax
  );

  if (existingMin === null || existingMax === null) return empty;
  if (existingMin >= existingMax) return empty;    // nothing real to protect

  return new Set<string>(PRICE_BAND_FIELDS);
}

/**
 * Data Consolidation Service
 * Main orchestrator for intelligent data merging
 */
export class DataConsolidationService {
  private currentShadowMode: boolean = false;

  constructor(
    private fieldSourcesRepository: any, // FieldSourcesRepository from web
    private dataConflictsRepository: any // DataConflictsRepository from web
  ) {}

  /**
   * Consolidate IPO data from multiple sources
   * Main entry point for scrapers
   */
  async consolidateIPOData(
    input: ConsolidateIPODataInput
  ): Promise<ConsolidationResult> {
    const startTime = Date.now();

    // Set shadow mode for this consolidation (defaults to false for production)
    this.currentShadowMode = input.shadowMode ?? false;

    // Check if consolidation is enabled
    if (
      !FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION ||
      !shouldUseFeature('CONSOLIDATION_PERCENTAGE', input.ipoId)
    ) {
      // Fallback: Accept all incoming data without conflict detection
      return this.fallbackConsolidation(input, startTime);
    }

    const result: ConsolidationResult = {
      ipoId: input.ipoId,
      fieldsProcessed: 0,
      fieldsUpdated: 0,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults: [],
      consolidatedData: {},
      errors: [],
      performanceMs: 0,
    };

    try {
      // Get existing field sources for this IPO
      let existingFieldSources;
      try {
        // For new IPOs (ipoId === 'new'), there are no existing field sources
        if (input.ipoId === 'new') {
          existingFieldSources = [];
        } else {
          existingFieldSources = await this.fieldSourcesRepository.findByIPOId(input.ipoId);
        }
      } catch (repoError) {
        // Re-throw repository errors (database connection issues, etc.)
        throw repoError;
      }

      // Convert to map for quick lookup
      const existingSourceMap = new Map<string, { value: any; source: ScraperSource; updatedAt?: Date }>();
      for (const fieldSource of existingFieldSources) {
        if (fieldSource.tableName === input.tableName) {
          const key = fieldSource.fieldName;
          existingSourceMap.set(key, {
            // Use value from field source (stored in DB) or fall back to existingData parameter
            value: input.existingData?.[key] ?? fieldSource.value,
            source: fieldSource.source,
            updatedAt: fieldSource.updatedAt,
          });
        }
      }

      // T-276 no-narrowing guard: a DEGENERATE incoming band (min === max) must
      // never overwrite a stored real range. NSE/BSE report a single `issuePrice`
      // before the band is announced and `parsePriceRange` widens that into a
      // zero-width {min: p, max: p}; with SAME_SOURCE_REFRESH enabled that fake
      // band would now be free to re-collapse a corrected range every cycle.
      // A degenerate band is still accepted when nothing real is stored (genuine
      // fixed-price issues).
      const degenerateBandFields = collectDegeneratePriceBandFields(
        input.incomingData,
        existingSourceMap,
        input.existingData
      );
      for (const fieldName of degenerateBandFields) {
        result.fieldsProcessed++;
        const trackedField = existingSourceMap.get(fieldName);
        // T-281: the field may have a real value in `ipos` with no tracked
        // `field_sources` row (the repair-script scenario) - fall back to the
        // raw stored value/source so the untracked row still reports its true
        // origin instead of throwing on a non-null assertion of `undefined`.
        result.fieldResults.push({
          fieldName,
          finalValue: trackedField?.value ?? input.existingData?.[fieldName],
          chosenSource: trackedField?.source ?? input.source,
          hadConflict: false,
          rejectedSources: [
            {
              source: input.source,
              value: input.incomingData[fieldName],
              reason: 'DEGENERATE_PRICE_BAND',
            },
          ],
        });
      }

      // Process each field in incoming data
      for (const [fieldName, incomingValue] of Object.entries(
        input.incomingData
      )) {
        if (degenerateBandFields.has(fieldName)) continue;
        result.fieldsProcessed++;

        try {
          const fieldResult = await this.consolidateField({
            ipoId: input.ipoId,
            tableName: input.tableName,
            fieldName,
            incomingValue,
            incomingSource: input.source,
            existingValue: existingSourceMap.get(fieldName)?.value,
            existingSource: existingSourceMap.get(fieldName)?.source,
            confidence: input.confidence,
            scrapedAt: input.scrapedAt,
            existingUpdatedAt: existingSourceMap.get(fieldName)?.updatedAt,
          });

          result.fieldResults.push(fieldResult);

          if (fieldResult.hadConflict) {
            result.conflictsDetected++;
            if (fieldResult.conflictSeverity) {
              result.conflictsBySeverity[fieldResult.conflictSeverity]++;
            }
          }

          // Track if field was updated (value actually changed from existing)
          // Field is updated if: (1) no existing value, (2) chose incoming over different source, OR (3) same source but value changed (time-based fields)
          const existingValueFromMap = existingSourceMap.get(fieldResult.fieldName);
          const choseIncoming = fieldResult.chosenSource === input.source;
          const hadDifferentSource = existingValueFromMap && existingValueFromMap.source !== input.source;
          const valueActuallyChanged = existingValueFromMap && fieldResult.finalValue !== existingValueFromMap.value;
          const valueChanged = !existingValueFromMap || (choseIncoming && (hadDifferentSource || valueActuallyChanged));
          if (valueChanged) {
            result.fieldsUpdated++;
          }
        } catch (error) {
          result.errors.push({
            fieldName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Build consolidated data object from field results
      result.consolidatedData = {};
      for (const fieldResult of result.fieldResults) {
        result.consolidatedData[fieldResult.fieldName] = fieldResult.finalValue;
      }
    } catch (error) {
      // Re-throw critical errors (repository/database failures)
      if (error instanceof Error &&
          (error.message.includes('Database') || error.message.includes('connection'))) {
        throw error;
      }

      console.error('[DataConsolidation] Fatal error:', error);
      result.errors.push({
        fieldName: '__global__',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    result.performanceMs = Date.now() - startTime;

    if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
      console.log('[DataConsolidation] Result:', {
        ipoId: input.ipoId,
        source: input.source,
        fieldsProcessed: result.fieldsProcessed,
        fieldsUpdated: result.fieldsUpdated,
        conflictsDetected: result.conflictsDetected,
        performanceMs: result.performanceMs,
      });
    }

    return result;
  }

  /**
   * Consolidate a single field
   * Core conflict detection and resolution logic
   */
  private async consolidateField(params: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    incomingValue: any;
    incomingSource: ScraperSource;
    existingValue?: any;
    existingSource?: ScraperSource;
    confidence?: number;
    scrapedAt?: Date;
    existingUpdatedAt?: Date;
  }): Promise<FieldConsolidationResult> {
    const {
      ipoId,
      tableName,
      fieldName,
      incomingValue,
      incomingSource,
      existingValue,
      existingSource,
      confidence = 100,
    } = params;

    const rules = getFieldRules(fieldName);

    // Normalize both values for comparison
    const normalizedIncoming = normalize(fieldName, incomingValue, rules);
    const normalizedExisting = existingValue
      ? normalize(fieldName, existingValue, rules)
      : null;

    // T-309 (T-305 round-6 P3) — the dominant root cause of the non-converging
    // conflict churn: a MISSING incoming value (the source genuinely has no
    // data for this field this cycle — e.g. chittorgarh-orchestrator-v2.ts
    // unconditionally emits `symbol: ipo.symbol`, which is `undefined` for
    // every IPO Chittorgarh doesn't carry a symbol for) is NOT a disagreement
    // with a stored real value. Before this check it fell through to Case 3
    // and was logged as a genuine conflict against the existing value on
    // EVERY cycle, forever — a field-less source can never produce a
    // non-null value, so it could never converge. Corroborated by a
    // read-only probe against prod `data_conflicts` (2026-08-24, role
    // ipodhan_app, query + output saved at
    // evidence/2026-08-24-T-309/fix2/prod-probe-conflicts.txt): 3,588 open
    // (unresolved) rows total; for allotmentDate/faceValue/symbol/registrar
    // essentially ALL of them (496-542 of ~498-573) have a NULL `value2`
    // (one of the two recorded conflicting sources), and leadManagers is
    // 483/573. `value2` is source2's raw value, not literally "incoming"
    // (the table records source1-vs-source2 pairs, not existing-vs-incoming),
    // so this does not prove every one of these rows hits this exact code
    // path — but it does show a missing-side value dominates the open
    // conflict set for precisely these fields, which is the same shape this
    // fix targets. issueSize/companyName conflicts, by contrast, have 0 null
    // sides — this fix does not address those; they are a different
    // (genuine two-value-disagreement) class. Symmetric with Case 1 below
    // (missing EXISTING accepts incoming) — this is missing INCOMING keeps
    // existing, no conflict logged.
    if (
      (normalizedIncoming === null || normalizedIncoming === undefined) &&
      normalizedExisting !== null &&
      normalizedExisting !== undefined
    ) {
      return {
        fieldName,
        finalValue: existingValue,
        chosenSource: existingSource || incomingSource,
        hadConflict: false,
        rejectedSources: [
          {
            source: incomingSource,
            value: incomingValue,
            reason: 'NO_INCOMING_VALUE',
          },
        ],
      };
    }

    // Validate incoming value
    if (!validateValue(normalizedIncoming, rules)) {
      return {
        fieldName,
        finalValue: existingValue, // Keep existing
        chosenSource: existingSource || incomingSource,
        hadConflict: false,
        rejectedSources: [
          {
            source: incomingSource,
            value: incomingValue,
            reason: 'VALIDATION_FAILED',
          },
        ],
      };
    }

    // Case 1: No existing value - accept incoming
    if (normalizedExisting === null || normalizedExisting === undefined) {
      await this.trackFieldSource({
        ipoId,
        tableName,
        fieldName,
        value: incomingValue, // Track original value, not normalized
        source: incomingSource,
        confidence,
      });

      return {
        fieldName,
        finalValue: incomingValue, // Return original value
        chosenSource: incomingSource,
        hadConflict: false,
      };
    }

    // Case 2: Values are equivalent - no conflict, no update needed
    if (areEquivalent(normalizedIncoming, normalizedExisting)) {
      // T-286: the sources have converged on this field since a prior cycle
      // logged a disagreement -- auto-resolve that open conflict (if any) so
      // it doesn't sit unresolved forever. Best-effort/non-fatal: this is an
      // audit-trail cleanup, never allowed to fail the consolidation itself.
      if (FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION && !this.currentShadowMode) {
        try {
          await this.dataConflictsRepository.autoResolveConverged(
            ipoId,
            tableName,
            fieldName
          );
        } catch (error) {
          console.error(
            '[DataConsolidation] Failed to auto-resolve converged conflict (non-fatal):',
            error
          );
        }
      }

      // Don't track or update - values are identical
      return {
        fieldName,
        finalValue: normalizedExisting, // Keep existing value
        chosenSource: existingSource!, // Keep existing source
        hadConflict: false,
      };
    }

    // Case 3: Conflict detected - resolve based on priority
    const conflict = await this.resolveConflict({
      ipoId,
      tableName,
      fieldName,
      existingValue,
      existingValueNormalized: normalizedExisting,
      existingSource: existingSource!,
      incomingValue,
      incomingValueNormalized: normalizedIncoming,
      incomingSource,
      rules,
      scrapedAt: params.scrapedAt,
      existingUpdatedAt: params.existingUpdatedAt,
    });

    return conflict;
  }

  /**
   * Resolve conflict between two sources
   * Uses priority matrix and time-based rules
   */
  private async resolveConflict(params: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    existingValue: any; // Original value
    existingValueNormalized: any; // Normalized for comparison
    existingSource: ScraperSource;
    incomingValue: any; // Original value
    incomingValueNormalized: any; // Normalized for comparison
    incomingSource: ScraperSource;
    rules: FieldRules;
    scrapedAt?: Date;
    existingUpdatedAt?: Date;
  }): Promise<FieldConsolidationResult> {
    const {
      ipoId,
      tableName,
      fieldName,
      existingValue,
      existingSource,
      incomingValue,
      incomingSource,
      rules,
      scrapedAt,
      existingUpdatedAt,
    } = params;

    let chosenSource: ScraperSource;
    let chosenValue: any;
    let resolutionReason: string;

    // CRITICAL: Check source priority FIRST (before time-based)
    // This ensures ADMIN and other high-priority sources can never be overridden
    // by lower-priority sources, even for time-based fields
    const existingPriority = getSourcePriority(fieldName, existingSource);
    const incomingPriority = getSourcePriority(fieldName, incomingSource);

    // If sources have different priorities, use source priority
    if (existingPriority !== incomingPriority) {
      // Lower index = higher priority
      if (
        incomingPriority !== -1 &&
        (existingPriority === -1 || incomingPriority < existingPriority)
      ) {
        chosenSource = incomingSource;
        chosenValue = incomingValue;
        resolutionReason = 'SOURCE_PRIORITY';
      } else if (existingPriority !== -1) {
        chosenSource = existingSource;
        chosenValue = existingValue;
        resolutionReason = 'SOURCE_PRIORITY';
      } else {
        // No priority defined, keep existing
        chosenSource = existingSource;
        chosenValue = existingValue;
        resolutionReason = 'DEFAULT_KEEP_EXISTING';
      }
    } else if (isTimeBased(fieldName)) {
      // Same source priority - use time-based resolution (newest wins)
      // This allows updates from the SAME source to be time-based
      if (scrapedAt && existingUpdatedAt) {
        if (scrapedAt > existingUpdatedAt) {
          // Incoming data is newer
          chosenSource = incomingSource;
          chosenValue = incomingValue;
          resolutionReason = 'TIME_BASED_PRIORITY';
        } else {
          // Existing data is newer, keep it
          chosenSource = existingSource;
          chosenValue = existingValue;
          resolutionReason = 'TIME_BASED_PRIORITY_EXISTING_NEWER';
        }
      } else {
        // If timestamps not available, accept incoming
        chosenSource = incomingSource;
        chosenValue = incomingValue;
        resolutionReason = 'TIME_BASED_PRIORITY';
      }
    } else if (
      existingSource === incomingSource &&
      allowsSameSourceRefresh(fieldName, incomingSource)
    ) {
      // T-276: the SAME authoritative source has changed its mind. Keeping the
      // stored value here is what made the price-band floor permanent
      // (`NSE 360 vs NSE 342 -> DEFAULT_KEEP_EXISTING`, logged every cycle for
      // two days). Narrower than `timeBased`: it needs the same source AND the
      // field to opt in via `sameSourceRefresh`.
      if (scrapedAt && existingUpdatedAt && scrapedAt <= existingUpdatedAt) {
        chosenSource = existingSource;
        chosenValue = existingValue;
        resolutionReason = 'SAME_SOURCE_REFRESH_EXISTING_NEWER';
      } else {
        chosenSource = incomingSource;
        chosenValue = incomingValue;
        resolutionReason = 'SAME_SOURCE_REFRESH';
      }
    } else {
      // Same source priority, not time-based - keep existing
      chosenSource = existingSource;
      chosenValue = existingValue;
      resolutionReason = 'DEFAULT_KEEP_EXISTING';
    }

    // Calculate conflict severity using normalized values for comparison
    const severity = getConflictSeverity(
      fieldName,
      params.existingValueNormalized,
      params.incomingValueNormalized,
      rules
    );

    // Log conflict if enabled. T-286 (P1-2): a SAME-source refresh (the same
    // scraper source changing its own reported value across cycles, e.g.
    // SAME_SOURCE_REFRESH/TIME_BASED_PRIORITY resolutions where
    // existingSource === incomingSource) is NOT a cross-source disagreement --
    // there is only one source in play, so it must never write a
    // `data_conflicts` row (that write path was the root cause of 9921/11493
    // rows having source1 === source2, which in turn destroyed the alert
    // channel with self-comparisons).
    if (
      FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION &&
      !this.currentShadowMode &&
      existingSource !== incomingSource
    ) {
      await this.logConflict({
        ipoId,
        tableName,
        fieldName,
        existingValue,
        existingSource,
        incomingValue,
        incomingSource,
        normalizedExisting: params.existingValueNormalized,
        normalizedIncoming: params.incomingValueNormalized,
        severity,
        reason: resolutionReason,
      });
    }

    // Track chosen source
    if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING && !this.currentShadowMode) {
      await this.trackFieldSource({
        ipoId,
        tableName,
        fieldName,
        value: chosenValue,
        source: chosenSource,
        previousValue: chosenSource !== existingSource ? existingValue : undefined,
        previousSource: chosenSource !== existingSource ? existingSource : undefined,
      });
    }

    return {
      fieldName,
      finalValue: chosenValue,
      chosenSource,
      hadConflict: true,
      conflictSeverity: severity,
      conflictReason: resolutionReason,
      rejectedSources: [
        {
          source: chosenSource === incomingSource ? existingSource : incomingSource,
          value: chosenSource === incomingSource ? existingValue : incomingValue,
          reason: resolutionReason,
        },
      ],
    };
  }

  /**
   * Track field source for audit trail
   */
  private async trackFieldSource(params: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    value: any;
    source: ScraperSource;
    confidence?: number;
    previousValue?: any;
    previousSource?: ScraperSource;
  }): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
      return;
    }

    if (this.currentShadowMode) {
      console.log('[SHADOW] Track field source:', params);
      return;
    }

    // T-299 (P3-10): match the sibling 'new' guards at line ~230/814 - a new-IPO
    // insert has no row yet, so its ipoId sentinel is the literal string 'new',
    // not a uuid. Without this guard every field on every new-IPO insert threw
    // `invalid input syntax for type uuid: "new"` (132 occurrences in prod logs);
    // caught and logged, but real lineage is written after insert by
    // data-persister.ts, so this write was always a no-op that only burned a
    // failing DB round-trip and flooded the error log.
    if (params.ipoId === 'new') {
      return;
    }

    try {
      await this.fieldSourcesRepository.trackFieldUpdate({
        ipoId: params.ipoId,
        tableName: params.tableName,
        fieldName: params.fieldName,
        value: params.value,
        source: params.source,
        confidence: params.confidence || 100,
        previousValue: params.previousValue !== undefined
          ? String(params.previousValue)
          : undefined,
        previousSource: params.previousSource,
      });
    } catch (error) {
      console.error('[DataConsolidation] Failed to track field source:', error);
    }
  }

  /**
   * Log conflict to database for admin review
   */
  private async logConflict(conflict: ConflictInfo): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION) {
      return;
    }

    if (this.currentShadowMode) {
      console.log('[SHADOW] Log conflict:', conflict);
      return;
    }

    try {
      // T-286 (P2-3): upsert, not insert -- refreshes the existing UNRESOLVED
      // row for this (ipoId, tableName, fieldName) instead of piling up a new
      // row every consolidation cycle (the "re-insert per cycle" growth that
      // left data_conflicts unbounded with resolved_at never set).
      await this.dataConflictsRepository.upsertConflict({
        ipoId: conflict.ipoId,
        tableName: conflict.tableName,
        fieldName: conflict.fieldName,
        source1: conflict.existingSource,
        value1: JSON.stringify(conflict.existingValue),
        source2: conflict.incomingSource,
        value2: JSON.stringify(conflict.incomingValue),
        resolvedSource:
          conflict.reason === 'SOURCE_PRIORITY'
            ? conflict.existingSource
            : conflict.incomingSource,
        resolutionReason: conflict.reason,
        severity: conflict.severity,
      });
    } catch (error) {
      console.error('[DataConsolidation] Failed to log conflict:', error);
    }
  }

  /**
   * Fallback consolidation when features are disabled
   * Simply accepts all incoming data
   */
  private fallbackConsolidation(
    input: ConsolidateIPODataInput,
    startTime: number
  ): ConsolidationResult {
    const fieldResults: FieldConsolidationResult[] = [];

    for (const [fieldName, incomingValue] of Object.entries(
      input.incomingData
    )) {
      fieldResults.push({
        fieldName,
        finalValue: incomingValue,
        chosenSource: input.source,
        hadConflict: false,
      });
    }

    // Build consolidated data from field results
    const consolidatedData: Record<string, any> = {};
    for (const fieldResult of fieldResults) {
      consolidatedData[fieldResult.fieldName] = fieldResult.finalValue;
    }

    return {
      ipoId: input.ipoId,
      fieldsProcessed: fieldResults.length,
      fieldsUpdated: fieldResults.length,
      conflictsDetected: 0,
      conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
      fieldResults,
      consolidatedData,
      errors: [],
      performanceMs: Date.now() - startTime,
    };
  }

  /**
   * Bulk consolidate multiple IPOs
   * Useful for backfill operations
   */
  async bulkConsolidate(
    inputs: ConsolidateIPODataInput[]
  ): Promise<ConsolidationResult[]> {
    const results: ConsolidationResult[] = [];

    for (const input of inputs) {
      const result = await this.consolidateIPOData(input);
      results.push(result);

      // Rate limiting for bulk operations
      if (results.length % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms pause every 10 IPOs
      }
    }

    return results;
  }

  /**
   * Get consolidation statistics for monitoring
   */
  async getConsolidationStats(ipoId: string): Promise<{
    totalFields: number;
    sourceDistribution: Record<ScraperSource, number>;
    unresolvedConflicts: number;
    averageConfidence: number;
  }> {
    // For new IPOs, return empty stats
    if (ipoId === 'new') {
      return {
        totalFields: 0,
        sourceDistribution: {} as Record<ScraperSource, number>,
        unresolvedConflicts: 0,
        averageConfidence: 0,
      };
    }

    const fieldSources = await this.fieldSourcesRepository.findByIPOId(ipoId);
    const unresolvedConflicts =
      await this.dataConflictsRepository.countUnresolved(ipoId);

    const sourceDistribution: Record<string, number> = {};
    let totalConfidence = 0;

    for (const fieldSource of fieldSources) {
      sourceDistribution[fieldSource.source] =
        (sourceDistribution[fieldSource.source] || 0) + 1;
      totalConfidence += fieldSource.confidence || 100;
    }

    return {
      totalFields: fieldSources.length,
      sourceDistribution: sourceDistribution as Record<ScraperSource, number>,
      unresolvedConflicts,
      averageConfidence:
        fieldSources.length > 0 ? totalConfidence / fieldSources.length : 0,
    };
  }
}

/**
 * Export types for external use
 */
export type {
  ConsolidateIPODataInput,
  ConsolidationResult,
  FieldConsolidationResult,
  ConflictInfo,
};
