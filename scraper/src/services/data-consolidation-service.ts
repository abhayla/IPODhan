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
import { confidenceFor } from '../config/source-confidence';
import type { ConflictSeverity } from '../config/source-confidence';
import { FEATURE_FLAGS, shouldUseFeature } from '../config/feature-flags';
import logger from '../utils/logger.js';

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
  // W-48: the source whose VALUE was actually kept/written after all
  // resolution branches ran (priority, untracked replace, set merge, tiebreak
  // etc). MUST be passed by the caller, never re-derived from `reason` here —
  // `reason === 'SOURCE_PRIORITY'` does not imply existingSource won (incoming
  // wins SOURCE_PRIORITY too when it outranks existing), and DEEPA's
  // faceValue/issueSize conflict rows were mislabeled NSE while DRHP's value
  // was the one actually stored.
  chosenSource: ScraperSource;
}

const PRICE_BAND_FIELDS = ['priceRangeMin', 'priceRangeMax'] as const;

/**
 * T-328 (LIFECYCLE-1 step, per docs/architecture/fable-review-2026-08-24.md
 * §5 converged order — no new tables): the fields the cross-source-
 * disagreement monitor already treats as HIGH_VALUE (price band + hard
 * dates). An unresolved cross-source disagreement on one of these, on a
 * live IPO, must never be asserted one-sided by resolveConflict — see HOLD
 * below. Kept in sync with `HIGH_VALUE_FIELDS` in
 * `cross-source-disagreement-monitor.ts` (that module owns detection; this
 * one owns correction — the whole point of this task is coupling the two).
 */
const HIGH_VALUE_LIVE_FIELDS = new Set<string>([
  'priceRangeMin',
  'priceRangeMax',
  'openDate',
  'closeDate',
]);

/** IPO lifecycle states in which a HIGH_VALUE field dispute must HOLD rather than assert one-sided. */
const LIVE_STATUSES = new Set<string>(['UPCOMING', 'OPEN']);

const DATE_FIELDS_WITH_TZ_TIEBREAK = new Set<string>(['openDate', 'closeDate']);

/**
 * T-328 interim tie-break for the known NSE timezone-parsing signature
 * (root cause owned by T-327, `nse-api-client.ts`): when NSE and a non-NSE
 * source disagree on a date field by EXACTLY one calendar day, prefer the
 * non-NSE value rather than falling through to HOLD — this is a resolvable
 * case, not a genuine dispute. Returns null when the delta isn't the 1-day
 * signature (falls through to normal resolution / HOLD).
 *
 * REMOVAL CONDITION: once T-327 fixes nse-api-client.ts's date parsing, this
 * branch should stop triggering (NSE will report the correct date and the
 * two sources will agree, hitting the Case-2 equivalence path upstream
 * instead). Re-run the Lumino-shape RED test in
 * scraper/tests/unit/services/data-consolidation-hold-disputed.test.ts after
 * T-327 lands — it should still pass (this tie-break simply won't fire), and
 * once confidently dead, delete this function and DATE_FIELDS_WITH_TZ_TIEBREAK.
 */
function resolveTzSignatureTiebreak(
  fieldName: string,
  existingValue: any,
  existingSource: ScraperSource,
  incomingValue: any,
  incomingSource: ScraperSource
): { chosenValue: any; chosenSource: ScraperSource } | null {
  if (!DATE_FIELDS_WITH_TZ_TIEBREAK.has(fieldName)) return null;
  if (existingSource !== 'NSE' && incomingSource !== 'NSE') return null;
  if (existingSource === incomingSource) return null;

  const existingDate = new Date(existingValue);
  const incomingDate = new Date(incomingValue);
  if (Number.isNaN(existingDate.getTime()) || Number.isNaN(incomingDate.getTime())) return null;

  const deltaDays = Math.abs(existingDate.getTime() - incomingDate.getTime()) / (24 * 60 * 60 * 1000);
  if (Math.abs(deltaDays - 1) > 1e-6) return null;

  // Prefer whichever side is NOT NSE.
  return existingSource === 'NSE'
    ? { chosenValue: incomingValue, chosenSource: incomingSource }
    : { chosenValue: existingValue, chosenSource: existingSource };
}


/**
 * `field_sources.previous_value` is a text column; `String(['BSE','NSE'])`
 * writes the lossy `BSE,NSE`, so objects/arrays are JSON-encoded (matching how
 * `data_conflicts.value1/value2` are stored).
 */
function serializeFieldValue(value: any): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

/**
 * M-1: may `source` replace a stored value that has NO provenance row? Only if
 * the matrix ranks it for this field AND strictly better than the worst source
 * it lists — an unranked or bottom-ranked source (e.g. API_FALLBACK for
 * `registrar`) can never silently replace a value whose origin is unknown.
 */
function outranksUntrackedValue(fieldName: string, source: ScraperSource): boolean {
  const rank = getSourcePriority(fieldName, source);
  if (rank === -1) return false;
  const worstRank = getFieldRules(fieldName).sources.length - 1;
  return rank < worstRank;
}

/** W-24 helper: normalize a resolved value for the "did anything change?" test. */
function normalizeChosen(fieldName: string, value: any, rules: FieldRules): any {
  return value !== null && value !== undefined ? normalize(fieldName, value, rules) : null;
}

/** Fields whose value is a SET the sources each report a partial view of. */
const SET_VALUED_FIELDS = new Set<string>(['listingExchanges']);

function unionSetValues(existing: any[], incoming: any[]): any[] {
  const key = (v: any) => (typeof v === 'string' ? v.toLowerCase().trim() : JSON.stringify(v));
  const seen = new Set(existing.map(key));
  const merged = [...existing];
  for (const value of incoming) {
    if (!seen.has(key(value))) {
      seen.add(key(value));
      merged.push(value);
    }
  }
  return merged;
}

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
 * T-308 (round-6 P1, 3rd occurrence of this class): widen-aware counterpart
 * to `collectDegeneratePriceBandFields` above.
 *
 * The narrowing guard protects a REAL stored band from being collapsed by an
 * incoming degenerate write. But it does nothing for the opposite direction:
 * once a HIGHER-priority source (e.g. NSE/BSE, which rank above MONEYCONTROL
 * in `FIELD_PRIORITY_MATRIX.priceRangeMin/Max`) has already written a
 * degenerate band - typically at close/listing, when the source starts
 * reporting a single final price instead of the original band - normal
 * `resolveConflict` priority resolution NEVER lets a lower-priority source's
 * CORRECT wide band win, even when that lower-priority source is the only one
 * still reporting the truth. The wrong degenerate value becomes permanent:
 * "the guard only blocks narrowing and never widens" (round-6 review finding).
 *
 * Returns the price-band field names that must bypass normal priority
 * resolution and force-accept the incoming (real, wider) value, because the
 * value CURRENTLY STORED is itself a degenerate collapse on a non-FIXED_PRICE
 * issue. A degenerate stored value is corruption, not a settled fact, so it
 * gets no priority protection regardless of which source wrote it.
 */
export function collectDegenerateBandFieldsToWiden(
  incomingData: Record<string, any>,
  existingSourceMap: Map<string, { value: any; source: ScraperSource; updatedAt?: Date }>,
  existingData?: Record<string, any> | null
): Set<string> {
  const empty = new Set<string>();
  if (!PRICE_BAND_FIELDS.every(f => f in incomingData)) return empty;

  const incomingMin = toFiniteNumber(incomingData.priceRangeMin);
  const incomingMax = toFiniteNumber(incomingData.priceRangeMax);
  if (incomingMin === null || incomingMax === null) return empty;
  if (incomingMin >= incomingMax) return empty; // incoming isn't a real (widening) band

  // A FIXED_PRICE issue's degenerate stored value is legitimate, not corrupt -
  // never force-overwrite it.
  if (incomingData.issueType === 'FIXED_PRICE' || existingData?.issueType === 'FIXED_PRICE') {
    return empty;
  }

  const existingMin = toFiniteNumber(
    existingSourceMap.get('priceRangeMin')?.value ?? existingData?.priceRangeMin
  );
  const existingMax = toFiniteNumber(
    existingSourceMap.get('priceRangeMax')?.value ?? existingData?.priceRangeMax
  );
  if (existingMin === null || existingMax === null) return empty; // nothing stored to widen
  if (existingMin !== existingMax) return empty; // existing is already a real band - normal priority applies

  return new Set<string>(PRICE_BAND_FIELDS);
}

/**
 * T-329 (round-7 P1-3 GUARD) — `issueSize` plausibility floor + shares x band
 * coherence, applied at the record level so BOTH the segment and the price
 * band are visible together (the field-priority-matrix's per-field {min,max}
 * validation has no segment dimension and cannot see `lotSize`/`priceRangeMax`
 * in the same call - see field-priority-matrix.ts `issueSize` entry).
 *
 * Thresholds derived from the live prod distribution (evidence/2026-08-26-
 * T-322/db-queries.txt: segment MAINBOARD 134 rows, SME 167 rows) and the
 * review's plausibility sweep (plausibility.txt SIZE_IMPLAUSIBLE_MAINBOARD/
 * SIZE_IMPLAUSIBLE_SME): every genuine MAINBOARD issue size on record is
 * comfortably above Rs10 Cr and every genuine SME issue size is above Rs1 Cr;
 * the 19 polluted rows (7 MAINBOARD + 12 SME) all sit at Rs0.30-8.97 Cr -
 * strictly below both floors, with a wide margin (smallest genuine SME issue
 * observed is well over 10x the floor). A MAINBOARD IPO below Rs10 Cr or an
 * SME IPO below Rs1 Cr is definitionally impossible under SEBI ICDR sizing
 * norms (SME issues alone require a post-issue paid-up capital of at least
 * Rs3 Cr, mainboard issues are materially larger) - these are floors, not
 * medians, chosen to reject-with-margin rather than flag borderline-real data.
 *
 * The coherence check (`|issueSize - shares*band_max| / issueSize > 0.5`)
 * catches the shape even when a segment floor alone would not (e.g. a small
 * MAINBOARD SHARE COUNT that happens to clear Rs10 Cr as a raw number but
 * disagrees wildly with shares x band).
 *
 * Violations are rejected (never written) and logged to `data_conflicts`
 * with a named reason (`ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR` /
 * `ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND`) via the same reject-in-place
 * pattern as `collectDegeneratePriceBandFields` above.
 */
const MAINBOARD_ISSUE_SIZE_FLOOR = 10_00_00_000; // Rs10 Cr
const SME_ISSUE_SIZE_FLOOR = 1_00_00_000; // Rs1 Cr
const ISSUE_SIZE_COHERENCE_TOLERANCE = 0.25; // 25%

export interface ImplausibleIssueSizeResult {
  fields: Set<string>;
  reason?: 'ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR' | 'ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND';
}

export function collectImplausibleIssueSizeFields(
  incomingData: Record<string, any>,
  existingData?: Record<string, any> | null
): ImplausibleIssueSizeResult {
  const empty: ImplausibleIssueSizeResult = { fields: new Set() };
  if (!('issueSize' in incomingData)) return empty;

  const issueSize = toFiniteNumber(incomingData.issueSize);
  if (issueSize === null || issueSize <= 0) return empty; // NULL/0 is "unknown", handled elsewhere

  const segment = incomingData.segment ?? existingData?.segment;
  const floor =
    segment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : segment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null;

  if (floor !== null && issueSize < floor) {
    return { fields: new Set(['issueSize']), reason: 'ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR' };
  }

  const shares = toFiniteNumber(incomingData.noOfSharesOffered ?? incomingData.sharesOffered);
  const bandMax = toFiniteNumber(incomingData.priceRangeMax ?? existingData?.priceRangeMax);
  if (shares !== null && shares > 0 && bandMax !== null && bandMax > 0) {
    const expected = shares * bandMax;
    const relativeDiff = Math.abs(issueSize - expected) / issueSize;
    if (relativeDiff > ISSUE_SIZE_COHERENCE_TOLERANCE) {
      return { fields: new Set(['issueSize']), reason: 'ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND' };
    }
  }

  return empty;
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

      // T-308 widen-aware guard: an ALREADY-degenerate stored band (min ===
      // max, not FIXED_PRICE) is corruption, not a settled fact - it gets no
      // priority protection. A real (min < max) incoming band force-wins
      // regardless of source rank, so a lower-priority source's correct band
      // can repair a higher-priority source's earlier collapse.
      const widenBandFields = collectDegenerateBandFieldsToWiden(
        input.incomingData,
        existingSourceMap,
        input.existingData
      );
      for (const fieldName of widenBandFields) {
        result.fieldsProcessed++;
        const existingField = existingSourceMap.get(fieldName);
        await this.trackFieldSource({
          ipoId: input.ipoId,
          tableName: input.tableName,
          fieldName,
          value: input.incomingData[fieldName],
          source: input.source,
          previousValue: existingField?.value ?? input.existingData?.[fieldName],
          previousSource: existingField?.source,
        });
        result.fieldResults.push({
          fieldName,
          finalValue: input.incomingData[fieldName],
          chosenSource: input.source,
          hadConflict: true,
          conflictSeverity: 'INFO',
          conflictReason: 'DEGENERATE_BAND_WIDENED',
        });
        result.fieldsUpdated++;
      }

      // T-329 (round-7 P1-3 GUARD): reject an issueSize that fails the
      // segment-floor / shares-x-band plausibility check - never written,
      // logged to data_conflicts with a named reason so admin review can see
      // why a source's issueSize was refused.
      const implausibleIssueSize = collectImplausibleIssueSizeFields(
        input.incomingData,
        input.existingData
      );
      for (const fieldName of implausibleIssueSize.fields) {
        result.fieldsProcessed++;
        const trackedField = existingSourceMap.get(fieldName);
        const existingValue = trackedField?.value ?? input.existingData?.[fieldName];
        const existingSource = trackedField?.source ?? input.source;

        if (
          FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION &&
          !this.currentShadowMode
        ) {
          await this.logConflict({
            ipoId: input.ipoId,
            tableName: input.tableName,
            fieldName,
            existingValue,
            existingSource,
            incomingValue: input.incomingData[fieldName],
            incomingSource: input.source,
            normalizedExisting: existingValue,
            normalizedIncoming: input.incomingData[fieldName],
            severity: 'CRITICAL',
            reason: implausibleIssueSize.reason!,
            // The implausible incoming value is rejected outright — nothing
            // is written, so the existing value/source stands.
            chosenSource: existingSource,
          });
        }

        result.fieldResults.push({
          fieldName,
          finalValue: existingValue,
          chosenSource: existingSource,
          hadConflict: false,
          rejectedSources: [
            {
              source: input.source,
              value: input.incomingData[fieldName],
              reason: implausibleIssueSize.reason!,
            },
          ],
        });
      }

      // Process each field in incoming data
      for (const [fieldName, incomingValue] of Object.entries(
        input.incomingData
      )) {
        if (degenerateBandFields.has(fieldName)) continue;
        if (widenBandFields.has(fieldName)) continue;
        if (implausibleIssueSize.fields.has(fieldName)) continue;
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
            // W-16b (Deepa walk, 2026-09-02): `existingSourceMap` is built ONLY
            // from tracked `field_sources` rows, so a field stored before source
            // tracking existed looked empty here — an incoming `undefined` then
            // hit "no existing value, accept incoming" and nulled a real stored
            // value (observed: NSE update wiped `lead_managers`). The raw stored
            // value travels alongside so the absent-never-overwrites-present
            // guard sees it regardless of provenance state.
            existingRowValue: input.existingData?.[fieldName],
            scrapedAt: input.scrapedAt,
            existingUpdatedAt: existingSourceMap.get(fieldName)?.updatedAt,
            // T-328: threaded so resolveConflict can HOLD a disputed
            // HIGH_VALUE field rather than assert one side while the IPO is
            // live. `ipos.status` is already on the row passed as
            // `existingData` — no new column, no new table.
            ipoStatus: input.existingData?.status,
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
    existingRowValue?: any;
    scrapedAt?: Date;
    existingUpdatedAt?: Date;
    ipoStatus?: string;
  }): Promise<FieldConsolidationResult> {
    const {
      ipoId,
      tableName,
      fieldName,
      incomingValue,
      incomingSource,
      existingValue,
      existingSource,
    } = params;

    const rules = getFieldRules(fieldName);

    // W-16b: the stored value as it exists on the row, whether or not it has a
    // `field_sources` row to prove where it came from.
    const storedValue = existingValue ?? params.existingRowValue;

    // Normalize both values for comparison
    const normalizedIncoming = normalize(fieldName, incomingValue, rules);
    // m-1: a falsy test here read a stored `0` / `''` / `false` as "nothing
    // stored", which is exactly the absent-overwrites-present class this fix
    // exists to close.
    const normalizedExisting =
      existingValue !== null && existingValue !== undefined
        ? normalize(fieldName, existingValue, rules)
        : null;
    const normalizedStored =
      storedValue !== null && storedValue !== undefined
        ? normalize(fieldName, storedValue, rules)
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
      normalizedStored !== null &&
      normalizedStored !== undefined
    ) {
      return {
        fieldName,
        finalValue: storedValue,
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
        finalValue: storedValue, // Keep existing
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

    // M-1 (round-2 review): a stored value with NO `field_sources` row is still
    // a real value. Case 1 used to gate on `normalizedExisting` (provenance
    // only), so a pre-source-tracking row's `registrar='Bigshare'` looked empty
    // and the LOWEST-priority source could replace it with no priority check and
    // no conflict row. The row carries no source column, so the stored value's
    // true origin is unknowable — it is therefore treated as untracked and only
    // a source the matrix ranks STRICTLY better than its worst listed source may
    // replace it. The replacement records the pre-existing value with a NULL
    // previous_source (unknown, never fabricated).
    if (
      normalizedStored !== null &&
      normalizedStored !== undefined &&
      (normalizedExisting === null || normalizedExisting === undefined) &&
      existingSource === undefined &&
      !(
        SET_VALUED_FIELDS.has(fieldName) &&
        Array.isArray(normalizedIncoming) &&
        Array.isArray(normalizedStored)
      )
    ) {
      if (areEquivalent(normalizedIncoming, normalizedStored)) {
        // W-25: a source CONFIRMING an untracked value is how the field earns
        // provenance — without this row the value stays untracked forever and
        // the M-1 keep-rule above can never unfreeze on its own. No previous
        // value/source: nothing changed and the prior origin is unknown.
        await this.trackFieldSource({
          ipoId,
          tableName,
          fieldName,
          value: storedValue,
          source: incomingSource,
        });

        return {
          fieldName,
          finalValue: storedValue,
          chosenSource: incomingSource,
          hadConflict: false,
          conflictReason: 'CONFIRMED_UNTRACKED',
        };
      }

      if (!outranksUntrackedValue(fieldName, incomingSource)) {
        logger.warn(
          { ipoId, tableName, fieldName, incomingSource, storedValue, incomingValue },
          'untracked_existing_value_kept: incoming source does not outrank an untracked stored value'
        );
        return {
          fieldName,
          finalValue: storedValue,
          chosenSource: incomingSource,
          hadConflict: false,
          rejectedSources: [
            {
              source: incomingSource,
              value: incomingValue,
              reason: 'UNTRACKED_EXISTING_VALUE_KEPT',
            },
          ],
        };
      }

      await this.trackFieldSource({
        ipoId,
        tableName,
        fieldName,
        value: incomingValue,
        source: incomingSource,
        previousValue: storedValue,
      });

      return {
        fieldName,
        finalValue: incomingValue,
        chosenSource: incomingSource,
        hadConflict: false,
        conflictReason: 'UNTRACKED_EXISTING_VALUE_REPLACED',
      };
    }

    // Case 2b (W-18(ii), Deepa walk): two array-valued reports of the same
    // field are a MERGE, not a disagreement — `listingExchanges` ['BSE','NSE']
    // vs an NSE scrape's ['NSE'] was written to `data_conflicts` every cycle
    // even though the exchanges are a set the persister merges anyway. A
    // union that adds a member keeps the PRIOR source (there is no 'MERGED'
    // member in the `scraper_source` enum and this task adds no schema
    // change) and records the pre-merge value as provenance history.
    if (Array.isArray(normalizedIncoming) && Array.isArray(normalizedStored)) {
      const merged = unionSetValues(normalizedStored, normalizedIncoming);
      const addsNothing = merged.length === normalizedStored.length;

      // F-3: this keep-stored return used to fire for EVERY array field, so a
      // non-set list (leadManagers) could grow but never shrink — a higher-
      // ranked source reporting a SHORTER, corrected list was discarded every
      // cycle with no conflict row. Only genuinely set-valued fields merge;
      // every other array falls through to normal priority resolution.
      if (SET_VALUED_FIELDS.has(fieldName)) {
        if (addsNothing) {
          // W-25 (round 4): a confirming source also gives an UNTRACKED set its
          // provenance row — otherwise a merged list stays untracked forever,
          // exactly as scalars did before W-25.
          if (existingSource === undefined) {
            await this.trackFieldSource({
              ipoId,
              tableName,
              fieldName,
              value: storedValue,
              source: incomingSource,
            });
          }

          return {
            fieldName,
            finalValue: storedValue,
            chosenSource: existingSource || incomingSource,
            hadConflict: false,
            rejectedSources: [
              { source: incomingSource, value: incomingValue, reason: 'SET_MERGE_NO_NEW_MEMBERS' },
            ],
          };
        }

        await this.trackFieldSource({
          ipoId,
          tableName,
          fieldName,
          value: merged,
          source: existingSource || incomingSource,
          previousValue: storedValue,
          previousSource: existingSource,
        });

        return {
          fieldName,
          finalValue: merged,
          chosenSource: existingSource || incomingSource,
          hadConflict: false,
          rejectedSources: [
            { source: incomingSource, value: incomingValue, reason: 'SET_MERGED' },
          ],
        };
      }
    }

    // Case 1: No existing value - accept incoming
    if (normalizedStored === null || normalizedStored === undefined) {
      await this.trackFieldSource({
        ipoId,
        tableName,
        fieldName,
        value: incomingValue, // Track original value, not normalized
        source: incomingSource,
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

      // F6 (W-37): the VALUE doesn't change, but a SECOND source independently
      // reporting it is real evidence — it raises the stored confidence by one
      // confirmation step (NSE 90 -> 95). Only a DIFFERENT source counts; the
      // same source repeating itself confirms nothing and must not touch the
      // provenance row at all (that is the W-24 losing-write class).
      if (
        FEATURE_FLAGS.ENABLE_SOURCE_TRACKING &&
        !this.currentShadowMode &&
        existingSource !== undefined &&
        existingSource !== incomingSource
      ) {
        await this.trackFieldSource({
          ipoId,
          tableName,
          fieldName,
          value: existingValue,
          source: existingSource,
          confirmations: 1,
          // W-24: previous_value/previous_source are what the row held BEFORE
          // this write — the same value from the same source. Passing them
          // keeps the confirmation from nulling real history.
          previousValue: existingValue,
          previousSource: existingSource,
        });
      }

      // Value and owning source are unchanged - keep existing
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
      ipoStatus: params.ipoStatus,
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
    ipoStatus?: string;
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
      ipoStatus,
    } = params;

    let chosenSource: ScraperSource;
    let chosenValue: any;
    let resolutionReason: string;
    let tiebreakResolved = false;

    // T-328 (LIFECYCLE-1, no new tables): a HIGH_VALUE field disagreement on a
    // live IPO (UPCOMING/OPEN) is never asserted one-sided by plain source
    // priority. ADMIN is exempt — an explicit admin edit is never held (it is
    // never in dispute; field protection already keeps scrapers from
    // reaching a locked field before this point). Checked BEFORE source
    // priority, same precedence tier as ADMIN-always-wins below, because an
    // unresolved dispute must win over "NSE happens to rank higher".
    if (
      HIGH_VALUE_LIVE_FIELDS.has(fieldName) &&
      ipoStatus !== undefined &&
      LIVE_STATUSES.has(ipoStatus) &&
      existingSource !== 'ADMIN' &&
      incomingSource !== 'ADMIN'
    ) {
      const tiebreak = resolveTzSignatureTiebreak(
        fieldName,
        existingValue,
        existingSource,
        incomingValue,
        incomingSource
      );

      if (tiebreak) {
        chosenSource = tiebreak.chosenSource;
        chosenValue = tiebreak.chosenValue;
        resolutionReason = 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE';
        tiebreakResolved = true;
      } else {
        // HOLD: keep the previously-published value, never assert either
        // side. `hold_status_transition` naming mirrors the status-updater's
        // own log line (status-updater-service.ts) so the two halves of this
        // fix are greppable together.
        logger.warn(
          {
            ipoId,
            tableName,
            fieldName,
            ipoStatus,
            existingSource,
            existingValue,
            incomingSource,
            incomingValue,
          },
          'hold_status_transition: HIGH_VALUE field disputed on a live IPO — holding previously-published value'
        );

        if (FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION && !this.currentShadowMode) {
          try {
            await this.dataConflictsRepository.upsertConflict({
              ipoId,
              tableName,
              fieldName,
              source1: existingSource,
              value1: existingValue === null || existingValue === undefined ? null : String(existingValue),
              source2: incomingSource,
              value2: incomingValue === null || incomingValue === undefined ? null : String(incomingValue),
              resolvedSource: existingSource,
              resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
              severity: 'CRITICAL',
            });
          } catch (error) {
            console.error('[DataConsolidation] Failed to record HOLD conflict (non-fatal):', error);
          }
        }

        return {
          fieldName,
          finalValue: existingValue,
          chosenSource: existingSource,
          hadConflict: true,
          conflictSeverity: 'CRITICAL',
          conflictReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
          rejectedSources: [
            {
              source: incomingSource,
              value: incomingValue,
              reason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
            },
          ],
        };
      }
    }

    // CRITICAL: Check source priority FIRST (before time-based)
    // This ensures ADMIN and other high-priority sources can never be overridden
    // by lower-priority sources, even for time-based fields
    //
    // T-328: the TZ-signature tie-break above already decided chosenValue/
    // chosenSource/resolutionReason for this field — skip the normal
    // priority/time-based resolution so it can't be silently overwritten.
    const existingPriority = getSourcePriority(fieldName, existingSource);
    const incomingPriority = getSourcePriority(fieldName, incomingSource);

    if (tiebreakResolved) {
      // tie-break already resolved this field — chosenValue/chosenSource/resolutionReason stand.
    } else if (existingPriority !== incomingPriority) {
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
        // W-48: pass the source actually kept by the resolution above —
        // never re-derive it from `resolutionReason` in logConflict.
        chosenSource,
      });
    }

    // W-24 (live probe, Deepa): a LOSING incoming write changed nothing on the
    // row, yet it still upserted `field_sources` — and because `previousValue`
    // is undefined on this path the repository wrote NULL over the real history
    // (faceValue's previous_value went "2" -> null when BSE re-sent 2 and lost).
    // A write that neither changes the value nor the owning source must not
    // touch the provenance row at all.
    const provenanceUnchanged =
      chosenSource === existingSource && areEquivalent(params.existingValueNormalized, normalizeChosen(fieldName, chosenValue, rules));

    // Track chosen source
    if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING && !this.currentShadowMode && !provenanceUnchanged) {
      await this.trackFieldSource({
        ipoId,
        tableName,
        fieldName,
        value: chosenValue,
        source: chosenSource,
        // F6 (W-37): the chosen value had to win a real disagreement — that
        // costs confidence (CRITICAL -10, WARNING -5, floor 20).
        conflicts: [severity],
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
    /** F6/W-37: severities this value had to win to be chosen (lowers confidence). */
    conflicts?: ConflictSeverity[];
    /** F6/W-37: number of OTHER sources that independently reported an equal value. */
    confirmations?: number;
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
        // F6 (W-37): the written confidence describes the source that actually
        // OWNS the value after resolution, adjusted for how contested it was.
        // It is derived here, never taken from the caller's per-payload hint —
        // that hint describes the INCOMING source, which is frequently the one
        // that just lost. Before this every row was a constant 100.
        confidence: confidenceFor(params.source, {
          conflicts: params.conflicts,
          confirmations: params.confirmations,
        }),
        previousValue: params.previousValue !== undefined
          ? serializeFieldValue(params.previousValue)
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
        // W-48: resolvedSource is the source whose value the caller actually
        // kept/wrote, passed in explicitly — never re-derived from `reason`
        // (that derivation assumed SOURCE_PRIORITY always means the existing
        // source wins, which is false: incoming wins SOURCE_PRIORITY too when
        // it outranks the existing source).
        resolvedSource: conflict.chosenSource,
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
