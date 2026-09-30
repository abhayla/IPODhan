import type { IPORepository, SubscriptionRepository, GMPRepository, FinancialDataRepository, IPOInsert, SubscriptionInsert, GMPRecordInsert, FinancialDataInsert, IPO } from '@ipodhan/shared';
import { filterPatchUnderHold, type HoldExecutor } from '@ipodhan/shared/services/field-hold';
import { recordListSuggestion } from '@ipodhan/shared/services/admin-list-hold';
import { normalizeCompanyUrl, isVerifierUrl } from './company-host-source.js';
import logger from '../utils/logger.js';
import { sql as sqlOp } from 'drizzle-orm';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { generateSlug, sanitizeCompanyName, coercePositiveOrNull, sanitizeIpoDates, sanitizeRegistrar, sanitizeLeadManagers, sanitizeIpoWriteFields, mergedDateSet } from '../utils/validators.js';
import { isDateSequenceCoherent } from './ipo-date-plausibility.js';
import { shouldPersistSubscriptionSnapshot, recordSuppressionOutcome, type SuppressionCounterStore } from './subscription-coverage-registry.js';
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
import { DataConsolidationService, type DeferredProvenanceWrite, TERMINAL_IPO_STATUSES, collectImplausibleIssueSizeFields, collectDegeneratePriceBandFields, fallbackDoorMayReplaceStoredValue, MAINBOARD_ISSUE_SIZE_FLOOR, SME_ISSUE_SIZE_FLOOR } from './data-consolidation-service.js';
import { FieldSourcesRepository, DataConflictsRepository, RegistrarRepository, resolveIpoRow, SOURCE_KEY_NO_WRITE_ERROR_NAMES, findSourceKeysForIpo, withSourceKeyLineage, sourceKeyLineageFor, E1_EXCHANGE_STATED_FIELDS, DOCUMENT_PATH_SOURCES } from '@ipodhan/shared/repositories';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { db, getRedisClient } from '@ipodhan/shared';
import { ipoDemandGraph, ipoDetails, ipos as iposTable, fieldSources as fieldSourcesTable } from '@ipodhan/shared/db/schema';
import { eq as eqOp, and as andOp, or as orOp, isNull as isNullOp } from 'drizzle-orm';
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
 * Round-3 C1/C2/M3 (Tier-A review of round 1): fields whose only job is
 * bookkeeping. They change on EVERY cycle by construction, so including them
 * in the write diff would make every cycle a "change" and suppress nothing.
 * They ride along on a write that happens for a real reason.
 */
const WRITE_DIFF_IGNORED_FIELDS = new Set(['lastScrapedAt', 'updatedAt', 'scrapedAt', 'createdAt', 'id']);

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'string') {
    // Only treat date-SHAPED strings as dates; a plain "12" must stay a number.
    if (!/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Round-4 L3: pg `date` columns (openDate/closeDate/allotmentDate/listingDate)
 * come back as bare 'YYYY-MM-DD' strings, while the incoming scraped value can
 * be a full `Date` at some other clock time on the SAME calendar day. Compared
 * as epoch timestamps those never match, so the field looks "changed" every
 * cycle and the no-op write skip (`diffFieldsForWrite`) never fires. When
 * EITHER side is a date-only string, or the field is a known pg `date` column,
 * compare by calendar day (UTC, matching the codebase's UTC-naive timestamp
 * convention — see `.claude/rules/utc-naive-timestamp-normalization.md`)
 * instead of by exact epoch.
 */
const DATE_ONLY_FIELDS = new Set([
  'openDate',
  'closeDate',
  'allotmentDate',
  'listingDate',
  'listingDateHistorical',
]);

function isDateOnlyString(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function toCalendarDayUTC(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
    if (!match) return null;
    // Validate it actually parses as a real date (rejects e.g. "2026-13-40").
    const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed);
    return Number.isNaN(parsed.getTime()) ? null : match[0];
  }
  return null;
}

/**
 * Round-3 M3: the WRITE gate's equality test. Deliberately STRICTER than
 * `normalization-engine.areEquivalent` (which tolerates 0.01 on numbers and
 * compares dates by calendar day only, both correct for provenance/conflict
 * reporting): for deciding whether the `ipos` row must be written,
 * 100.00 vs 100.01 IS a change and 09:00 vs 14:00 on the same date IS a
 * change. What is NOT a change is a pure representation difference — the pg
 * NUMERIC string "6800000000.00" against the JS number 6800000000, or a Date
 * against its own ISO string.
 */
export function valuesEqualForWrite(a: unknown, b: unknown, fieldName?: string): boolean {
  if (a === b) return true;
  if (isBlank(a) && isBlank(b)) return true;
  if (isBlank(a) !== isBlank(b)) return false;

  const isDateOnlyField =
    isDateOnlyString(a) || isDateOnlyString(b) || (fieldName !== undefined && DATE_ONLY_FIELDS.has(fieldName));
  if (isDateOnlyField) {
    const aDay = toCalendarDayUTC(a);
    const bDay = toCalendarDayUTC(b);
    if (aDay !== null || bDay !== null) {
      if (aDay === null || bDay === null) return false;
      return aDay === bDay;
    }
  }

  const aTime = toTimestamp(a);
  const bTime = toTimestamp(b);
  if (aTime !== null || bTime !== null) {
    if (aTime === null || bTime === null) return false;
    return aTime === bTime;
  }

  const aNum = toFiniteNumber(a);
  const bNum = toFiniteNumber(b);
  if (aNum !== null && bNum !== null) return aNum === bNum;
  if ((aNum !== null) !== (bNum !== null)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const key = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : JSON.stringify(v));
    const sortedA = a.map(key).sort();
    const sortedB = b.map(key).sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();

  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Round-3 C1/C2: which fields of `finalData` actually differ from the stored
 * `ipos` row. This — not `consolidationResult.fieldsUpdated` — is what decides
 * whether the update is a no-op.
 *
 * Why the change: `fieldsUpdated` counts PROVENANCE rows (`field_sources`), and
 * it is computed BEFORE the persister adds `listingExchanges`, `registrarId`,
 * `offeringType` and the re-applied write-field sanitizers. Two real bugs
 * followed. (a) A cycle where consolidation changed nothing but the merged
 * exchange list gained 'BSE', or a null `registrarId` finally resolved, was
 * skipped — the row never got the value. (b) A row repaired by a direct write
 * (provenance says 100, the row says 90) never converged: provenance already
 * agreed with the incoming value, so `fieldsUpdated` was 0 forever while the
 * row stayed at 90. Diffing the payload against the ROW closes both.
 */
export function diffFieldsForWrite(
  finalData: Record<string, unknown>,
  existingIPO: Record<string, unknown>
): string[] {
  const changed: string[] = [];
  for (const [field, value] of Object.entries(finalData)) {
    if (WRITE_DIFF_IGNORED_FIELDS.has(field)) continue;
    // `undefined` is never written by drizzle — it is "leave this column alone".
    if (value === undefined) continue;
    if (!valuesEqualForWrite(value, existingIPO[field], field)) changed.push(field);
  }
  return changed;
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

/**
 * OD-131: did a held-back provenance write's value reach the `ipos` row this door writes?
 * Only the singleton `ipos` row is judged here (the only table this door writes); a write for
 * any other table is not this door's to refuse. Emptiness is `=== null || === undefined`, never
 * falsiness — 0, false and '' are stored values.
 */
export function isProvenanceValueStored(
  write: { tableName: string; rowKey?: string; fieldName: string },
  finalData: Record<string, unknown>
): boolean {
  if (write.tableName !== 'ipos' || (write.rowKey ?? '') !== '') return true;
  const stored = finalData[write.fieldName];
  return stored !== null && stored !== undefined;
}

/** The payload minus the fields an admin hold dropped inside the write (what was actually stored). */
export function withoutHeld<T extends Record<string, unknown>>(data: T, dropped: readonly string[]): T {
  if (dropped.length === 0) return data;
  return Object.fromEntries(Object.entries(data).filter(([k]) => !dropped.includes(k))) as T;
}

/**
 * OD-131 (review round 1): the fallback door's filter. It stores the raw merged payload, not
 * consolidation's winners, so a decided provenance write counts only when its value was stored
 * AND is the value stored (a decided value the fallback overwrote must not be claimed).
 */
export function isProvenanceValueStoredAsDecided(
  write: { tableName: string; rowKey?: string; fieldName: string; value: unknown },
  storedData: Record<string, unknown>
): boolean {
  if (!isProvenanceValueStored(write, storedData)) return false;
  if (write.tableName !== 'ipos' || (write.rowKey ?? '') !== '') return true;
  return valuesEqualForWrite(write.value, storedData[write.fieldName], write.fieldName);
}

function getFieldSourcesRepository(): FieldSourcesRepository {
  if (!fieldSourcesRepoInstance) {
    fieldSourcesRepoInstance = new FieldSourcesRepository(db, getRedisClient());
  }
  return fieldSourcesRepoInstance;
}

/**
 * #1236 class fix: EVERY provenance lookup on the persister write paths answers one of three states,
 * never conflated. `source` set = a row vouches for the stored value (use it); `source` null with
 * `lookupFailed` false = no row was found, so there is no claim; `lookupFailed` true = the read
 * THREW, so whether a document vouches for the stored value is UNKNOWN. "Unknown" is never "no
 * document claim": the caller keeps the stored value and the failure is recorded in the ledger.
 * Lookups on these paths: offeringType (3 doors), listingExchanges (fallback door). The other
 * `findByField` reads (merged-validation owner, #180 F2 hard-date prior source) throw to their
 * caller's own handler and never collapse a failure into "no claim".
 */
export interface StoredProvenanceLookup {
  source: string | null;
  lookupFailed: boolean;
}

async function lookupStoredProvenanceSource(
  ipoId: string | undefined,
  fieldName: string
): Promise<StoredProvenanceLookup> {
  if (!ipoId) return { source: null, lookupFailed: false };
  try {
    const fieldSourcesRepo = getFieldSourcesRepository();
    if (typeof (fieldSourcesRepo as any).findByField !== 'function') return { source: null, lookupFailed: false };
    const provenance = await fieldSourcesRepo.findByField(ipoId, 'ipos', fieldName);
    return { source: (provenance as any)?.source ?? null, lookupFailed: false };
  } catch (e) {
    logger.warn(
      { ipoId, fieldName, error: e instanceof Error ? e.message : String(e) },
      `[DataPersister] #1236 stored ${fieldName} provenance lookup failed - holder unknown, the stored value is kept`
    );
    return { source: null, lookupFailed: true };
  }
}

/** #180 Tier-A round 6: who vouches for the CURRENT stored `offeringType`, for every door that guards it. */
function getStoredOfferingTypeSource(ipoId: string | undefined): Promise<StoredProvenanceLookup> {
  return lookupStoredProvenanceSource(ipoId, 'offeringType');
}

/**
 * OD-129 (#938): the source vouching for the stored `listingExchanges`, for the fallback door
 * (document or ADMIN row / feed row / no row / lookup threw; see StoredProvenanceLookup).
 */
function getStoredListingExchangesSource(ipoId: string | undefined): Promise<StoredProvenanceLookup> {
  return lookupStoredProvenanceSource(ipoId, 'listingExchanges');
}

/**
 * The SME-FPO guard, answer-state aware (#1236 class). When the lookup FAILED and the guard would
 * rewrite FPO to IPO, the rewrite is exactly the claim "no exchange vouches for the stored FPO" -
 * which is unknown - so the stored value is kept instead. Every other state behaves as before.
 */
export function guardSmeOfferingTypeWithLookup(
  segment: string | null | undefined,
  incoming: string,
  incomingSource: string | null | undefined,
  lookup: StoredProvenanceLookup,
  storedValue: string | null | undefined
): string {
  const guarded = guardSmeOfferingTypeAgainstFpo(segment, incoming, incomingSource, lookup.source);
  // Round 3 (MINOR): with nothing stored there is no holder to be unsure about, so the guard decides.
  if (lookup.lookupFailed && guarded !== incoming && storedValue != null) return storedValue;
  return guarded;
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
 *
 * #721 audit (every ERROR-severity rule `validateIPOData` can emit, checked
 * against this map): REQUIRED_FIELD_MISSING (companyName), CLOSE_DATE_BEFORE_
 * OPEN (dates), NON_IPO_WINDOW_TOO_LONG / NON_IPO_CORPORATE_ACTION_SHAPE /
 * NON_IPO_SCRIP_CODE_NAME / NON_IPO_TRUST_SHAPE (offeringType/companyName
 * shape guards) stay OUT of this map deliberately: each is a whole-row
 * shape/presence judgment (is this row an IPO at all, is a required field
 * present), already enforced per source and on the create path - dropping
 * one FIELD from an update can neither fix nor meaningfully express "this
 * row is not an IPO", and re-acting on them here would silently widen this
 * guard's blast radius far past W-14 into rejecting whole updates it was
 * never designed to gate. LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD/SME (Rule 9)
 * is DIFFERENT in kind from those: it is a per-FIELD arithmetic check
 * (lotSize x priceRangeMax against a SEBI window) of exactly the shape the
 * other entries below already cover, and unlike them it is a MERGED-only
 * rule - segment usually is not on the incoming payload at all, so it can
 * only ever fire here, on the merged view. Leaving it out was the actual
 * bug #721 reports; it is mapped below.
 */
const MERGED_RULE_FIELDS: Record<string, string[]> = {
  PRICE_BAND_INVERTED: ['priceRangeMin', 'priceRangeMax'],
  PRICE_BAND_TOO_WIDE_MAINBOARD: ['priceRangeMin', 'priceRangeMax'],
  PRICE_BAND_TOO_WIDE_SME: ['priceRangeMin', 'priceRangeMax'],
  LOT_SIZE_INVALID: ['lotSize'],
  LOT_SIZE_TOO_LOW: ['lotSize'],
  // #721: Rule 9 (LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD/SME, data-validation.ts
  // ~L556) is a genuinely MERGED-only rule — it needs segment + lot + band
  // together, which per-source validation rarely has (a BSE payload carries
  // no segment at all; the merged view resolves it from the STORED row, see
  // `applyMergedRecordValidation` above). Before this entry, an ERROR from
  // this rule matched no key in this map, `fieldsToDrop` was `undefined`,
  // and the `continue` a few lines below silently skipped it: no field
  // dropped, no warn logged, no data_conflicts row — the exact "never runs"
  // shape #721 reported, though the root cause is this map, not the rule.
  // Drop `lotSize`, not the band: the rule's own message ("This lot/band
  // pair is arithmetically impossible... reject and flag for
  // reclassification") treats the pair as jointly impossible, but the
  // existing sibling rules for the same input shape (LOT_SIZE_TOO_LOW,
  // LOT_SIZE_INVALID) already establish the convention that the LOT is the
  // suspect value when a lot/band combination fails a SEBI check — the band
  // alone is independently validated by PRICE_BAND_TOO_WIDE_*/INVERTED above,
  // so re-dropping it here on a rule that never flagged the band's own shape
  // would discard a value nothing else found wrong.
  LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD: ['lotSize'],
  LOT_ECONOMICS_IMPOSSIBLE_SME: ['lotSize'],
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
    // W-160: openDate/closeDate/listingDate together, on the MERGED record —
    // a single source rarely reports all three in one payload (per-source
    // validation's CLOSE_DATE_BEFORE_OPEN never sees listingDate at all), so
    // an impossible close/listing combination only becomes visible here.
    openDate: mergedValue('openDate'),
    closeDate: mergedValue('closeDate'),
    listingDate: mergedValue('listingDate'),
  };

  const mergedValidation = validateIPOData(mergedRecord as any, source);

  for (const warning of mergedValidation.warnings) {
    if (warning.field === 'lotSize' || warning.field === 'priceBand' || warning.field === 'dates') {
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

    // #721: LOT_SIZE_TOO_LOW and LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD/SME can
    // both fire on the SAME impossible lot (a lot under 10 that is also
    // outside its segment's SEBI window) - both map to `lotSize`. Once an
    // earlier rule THIS CALL has already dropped every field this one would
    // drop, there is nothing left to reject and no second CRITICAL
    // data_conflicts row is warranted for the same field/value pair.
    if (fieldsToDrop.every((field) => droppedFields.includes(field))) continue;

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
          // F-181/#818 class: `error.field` is validateIPOData's own grouping
          // label ('lotEconomics', 'priceBand') - never an `ipos` column, so
          // the admin queue can't resolve the row against a real field. Use
          // `ownerField` (fieldsToDrop[0], the actual column this rule drops
          // and the same name `findByField` above was already queried with)
          // instead; the rule name itself still lives in `resolutionReason`.
          fieldName: ownerField,
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
/**
 * `ofsSlugYear`, `ofsSlugYearMissingCount` and `computeIpoIdentitySlug` now
 * live in `./ipo-identity-slug.js` (item 12, type-check:scripts fix) so a
 * caller needing only the pure slug computation does not pull this file's
 * heavy import graph (repositories, scrapers) into its compilation. Re-
 * exported here so every existing caller of `data-persister.js` is
 * unaffected.
 */
import { ofsSlugYear, ofsSlugYearMissingCount, computeIpoIdentitySlug } from './ipo-identity-slug.js';
export { ofsSlugYear, ofsSlugYearMissingCount, computeIpoIdentitySlug };

function shouldSkipRetry(error: any): boolean {
  // OD-68: a held record is a decision, not a transient failure — retrying it
  // only repeats the same hold.
  // OD-85: a duplicate-key report or a SUPERSEDED key is the same kind of decision.
  if (SOURCE_KEY_NO_WRITE_ERROR_NAMES.has(error?.name)) return true;
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

      // #928: a hold (OD-68) or a key no-write (OD-85) is a decision recorded in
      // audit_logs, not a database failure: one warn line, no error lines, no retry.
      if (SOURCE_KEY_NO_WRITE_ERROR_NAMES.has(error?.name)) {
        logger.warn(
          { errorName: error.name, operation: operationName, message: error?.message },
          'identity decision - nothing written, not retried'
        );
        throw error;
      }

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
  scrapedListingExchange: 'NSE' | 'BSE' | 'BOTH' | undefined,
  // W-145: SME rows list on exactly one board, so the fallback must not widen
  // them either. Omitted (or non-SME) keeps the previous union behaviour.
  segment?: string | null,
  // OD-129 (#938, review MINOR 2): the source vouching for the STORED set
  // (field_sources). Only an offer-document (or ADMIN) source holds the set;
  // null / unknown / a feed source means no document claim, so the feed union
  // still applies ("Only when no document has been read: the exchange feed").
  storedSource?: string | null,
  // #1236: the provenance lookup itself threw, so who holds the stored set is UNKNOWN. A feed must
  // not widen a set that may be document-held, and the provenance write would then record the feed
  // as its source, which no later cycle undoes. Fail closed: keep the stored set; the next cycle's
  // consolidation (or this lookup succeeding) decides it. A never-tracked set (no row) is not this case.
  provenanceLookupFailed?: boolean
): ('NSE' | 'BSE')[] {
  const existing = existingExchanges ?? [];
  // W-145: ONE rule for what a source proves — an aggregator's 'BOTH' is
  // unknown, NSE/BSE assert only themselves.
  const incoming = toListingExchangesForSource(scrapedListingExchange, source);
  if (!incoming) return existing;
  // OD-129 (#938): the same decision the consolidation door makes. A document's
  // listing sentence replaces the set (never unions into it); a set a document
  // or the admin holds is never widened by a feed.
  const od129 = decideListingExchangesOd129({
    stored: existing,
    storedSource: storedSource ?? undefined,
    incoming,
    incomingSource: source,
  });
  if (od129.kind === 'DOCUMENT_WRITES') return od129.value as ('NSE' | 'BSE')[];
  if (od129.kind !== 'NO_DOCUMENT') return existing;
  if (provenanceLookupFailed && existing.length > 0) {
    logger.warn(
      { source, stored: existing, incoming },
      '[DataPersister] #1236 stored listingExchanges holder unknown (provenance lookup failed) - not widening the set from a feed'
    );
    return existing;
  }

  let merged = existing;
  for (const exchange of incoming) {
    merged = mergeListingExchanges(merged, exchange);
  }
  if (violatesSmeSingleExchange(segment, merged) && existing.length > 0) {
    return existing;
  }
  return merged;
}

/**
 * Round 3 of PR #972 (review MINOR 3): the legacy fallback door (it runs when consolidation
 * throws) must honour the same terminal-status rule as the consolidation path
 * (`TERMINAL_IPO_STATUSES`, plus POSTPONED, #1298): a stored WITHDRAWN, DELISTED or POSTPONED is never overwritten by an
 * ordinary scrape's status. Returns the update without `status` when the stored one is
 * terminal and the incoming one differs; otherwise the update unchanged.
 */
export function keepTerminalIpoStatus<T extends Record<string, any>>(existingStatus: unknown, update: T): T {
  if (!('status' in update)) return update;
  const stored = existingStatus == null ? null : String(existingStatus);
  // #1298: POSTPONED is not terminal, but this fallback door cannot read the relaunch evidence, so it
  // keeps POSTPONED (fail closed); the consolidation path releases it on a relaunch (§2.9).
  const held = TERMINAL_IPO_STATUSES.has(stored ?? '') || stored === 'POSTPONED';
  if (stored === null || !held || String(update.status) === stored) return update;
  const { status: _dropped, ...rest } = update;
  logger.warn({ storedStatus: stored, incomingStatus: update.status }, '[LEGACY PATH] terminal ipo status kept; incoming status dropped');
  return rest as T;
}

/**
 * #1253: the ONE definition of "this key is not a claim of this write on the fallback door": a
 * context field (OD-66, both `listingExchange` spellings, #938) or, for a document source, an E-1
 * exchange-stated field (§1.2.1). The publish filter (`dropFallbackNonClaims`), the provenance
 * filter and the "is the listing exchange context" test all read this, so they cannot drift.
 */
function fallbackContextKeys(contextFields: readonly string[] | undefined): Set<string> {
  const context = new Set(contextFields ?? []);
  if (context.has('listingExchange')) context.add('listingExchanges');
  if (context.has('listingExchanges')) context.add('listingExchange');
  return context;
}

export function fallbackNonClaimTest(
  source: string,
  contextFields: readonly string[] | undefined,
): (key: string) => boolean {
  const context = fallbackContextKeys(contextFields);
  const isDocumentSource = DOCUMENT_PATH_SOURCES.has(source);
  return (key) => context.has(key) || (isDocumentSource && E1_EXCHANGE_STATED_FIELDS.has(key));
}

/**
 * #454 (remainder): the fallback door publishes only this write's CLAIMS, the same set the
 * consolidation door would resolve. Two kinds of key are not claims and are removed before the
 * `ipos` update, not merely left out of provenance:
 *  - a field the caller declared as CONTEXT (OD-66; both `listingExchange` spellings, #938) —
 *    the consolidator skips these outright (data-consolidation-service.ts, the `contextFields`
 *    `continue` in `consolidateIPOData`), so they never reach `consolidatedData`;
 *  - an E-1 exchange-stated field from a document source (§1.2.1: "the document is not a source
 *    for these fields"; the shared set in field-sources-repository.ts). From an exchange or any
 *    other non-document source an E-1 field is a claim and stays.
 * Returns the filtered update and the names it removed (for the log line).
 */
export function dropFallbackNonClaims<T extends Record<string, any>>(
  update: T,
  source: string,
  contextFields: readonly string[] | undefined,
): { update: T; refused: string[] } {
  const isNonClaim = fallbackNonClaimTest(source, contextFields);
  const kept: Record<string, any> = {};
  const refused: string[] = [];
  for (const [key, value] of Object.entries(update)) {
    if (isNonClaim(key)) {
      refused.push(key);
      continue;
    }
    kept[key] = value;
  }
  return { update: kept as T, refused };
}

/**
 * #1236 round 3 (re-approach after independent review): the ONE list of guards every `ipos` UPDATE
 * runs on its merged payload, whichever door writes it. Before this, the fallback door (the one that
 * runs when anything on the consolidation path throws, including a guard's own provenance read) ran a
 * hand-kept SUBSET of the consolidation door's guards, so an exception downgraded protection: an
 * uncorroborated CHITTORGARH openDate reached a stored null because the #180 F2 read threw and the
 * fallback door had no F2. Now both doors call `applyIpoWriteGuards`, so the fallback door cannot be
 * weaker by construction; the unit suite pins the list and tests each guard on the fallback door.
 *
 * Answer states for a guard that reads provenance: found -> the guard applies; none -> the guard
 * decides as before; the read THREW -> the stored value is kept (fail closed) and the field is named
 * in `provenanceLookupFailed` for the ledger. A read that throws never escapes a guard.
 *
 * `consolidatorEnforced`: the consolidation door already applies this rule inside
 * `consolidateIPOData` with the richer field_sources view (T-276 degenerate band with the tracked
 * map; OD-66 / E-1 context skip; POSTPONED released only on relaunch evidence, section 2.9), so on that
 * door the guard is not re-run (re-running the fallback form would, e.g., block a legitimate relaunch).
 * Guards outside this list run for BOTH doors at one shared point: the pre-door payload guards
 * (W-104 slug, W-177 issue size, merged-view date plausibility, segment drop, the incoming SME-FPO
 * guard, W-14 removal from the payload), `listingExchanges` (each door merges with the same OD-129 /
 * W-145 / context rules and fails closed on a failed lookup), and the admin hold (section 9.2 item 19:
 * both doors write through `updateReportingHolds`).
 */
export interface IpoWriteGuardContext {
  door: 'consolidation' | 'fallback';
  existing: Record<string, any>;
  /** The door-independent incoming payload (ipoData); the degenerate-band guard judges it. */
  incoming: Record<string, any>;
  source: ScraperSource;
  contextFields: readonly string[] | undefined;
  mergedValidationDroppedFields: readonly string[];
  provenanceLookupFailed: Set<string>;
}

interface IpoWriteGuard {
  name: string;
  consolidatorEnforced: boolean;
  run(payload: Record<string, any>, ctx: IpoWriteGuardContext): Promise<Record<string, any>> | Record<string, any>;
}

const HARD_DATE_FIELDS = ['openDate', 'closeDate', 'listingDate'] as const;

/** Keys the precedence guard never ranks: bookkeeping, the OD-129 merged set, and a derived FK. */
const PRECEDENCE_EXEMPT_KEYS = new Set(['lastScrapedAt', 'updatedAt', 'listingExchanges', 'registrarId']);

function isStoredValuePresent(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

/**
 * #1236 round 3 / #1363 review: the field-priority matrix on the fallback door. A payload value that
 * would REPLACE a present stored value is kept at the stored value unless
 * `fallbackDoorMayReplaceStoredValue` (the consolidator's own rank functions) allows it. The stored
 * value's holder comes from ONE field_sources read; if that read throws, every present stored value is
 * kept and named in provenanceLookupFailed. Filling an empty column is left to the other guards (F2).
 * Kept values are written back as the STORED value (not dropped), so the classification and SME-FPO
 * guards after this one still see and correct the stored value, as they do on the consolidation door.
 */
async function guardSourcePrecedence(
  payload: Record<string, any>,
  ctx: IpoWriteGuardContext
): Promise<Record<string, any>> {
  const replacing = Object.keys(payload).filter(
    (f) =>
      !PRECEDENCE_EXEMPT_KEYS.has(f) &&
      payload[f] !== undefined &&
      isStoredValuePresent(ctx.existing[f]) &&
      !valuesEqualForWrite(ctx.existing[f], payload[f], f)
  );
  if (replacing.length === 0) return payload;
  const out = { ...payload };
  const keepStored = (f: string) => {
    out[f] = ctx.existing[f];
    if (f === 'registrar' && 'registrarId' in out) out.registrarId = ctx.existing.registrarId;
  };
  const ipoId = ctx.existing.id as string;
  let holders: Map<string, ScraperSource>;
  try {
    const fieldSourcesRepo = getFieldSourcesRepository();
    const rows = typeof (fieldSourcesRepo as any).findByIPOId === 'function'
      ? await fieldSourcesRepo.findByIPOId(ipoId)
      : [];
    holders = new Map();
    for (const row of rows as any[]) {
      if ((row.tableName ?? 'ipos') !== 'ipos' || (row.rowKey ?? '') !== '') continue;
      if (!holders.has(row.fieldName)) holders.set(row.fieldName, row.source);
    }
  } catch (e) {
    for (const f of replacing) {
      keepStored(f);
      ctx.provenanceLookupFailed.add(f);
    }
    logger.warn(
      { ipoId, source: ctx.source, door: ctx.door, fields: replacing, error: e instanceof Error ? e.message : String(e) },
      '[DataPersister] field_sources read failed - stored values kept on the fallback door (#1236 round 3)'
    );
    return out;
  }
  const kept: { field: string; reason: string }[] = [];
  for (const f of replacing) {
    const decision = fallbackDoorMayReplaceStoredValue({
      fieldName: f,
      holderSource: holders.get(f) ?? null,
      incomingSource: ctx.source,
      ipoId,
      segment: ctx.existing.segment ?? null,
      listingExchanges: ctx.existing.listingExchanges ?? null,
      ipoStatus: ctx.existing.status ?? null,
      storedValue: ctx.existing[f],
      incomingValue: payload[f],
    });
    if (!decision.allowed) {
      keepStored(f);
      kept.push({ field: f, reason: decision.reason });
    }
  }
  if (kept.length > 0) {
    logger.info(
      { ipoId, source: ctx.source, door: ctx.door, kept },
      '[DataPersister] source precedence kept the stored value(s) on the fallback door (#1236 round 3)'
    );
  }
  return out;
}

/**
 * #180 F2: a non-authoritative source may not be the FIRST to assert a hard date over a stored null
 * on a row whose provenance is tracked, unless a prior field_sources row for that field exists. A row
 * with no field_sources rows at all is untracked (unknown provenance) and is not protected. Either
 * read throwing keeps the stored null (fail closed) and flags the field.
 */
async function guardFirstTouchHardDates(
  payload: Record<string, any>,
  ctx: IpoWriteGuardContext
): Promise<Record<string, any>> {
  if (isAuthoritativeForHardDatesOnCreate(ctx.source)) return payload;
  const candidates = HARD_DATE_FIELDS.filter(
    (f) => f in payload && payload[f] != null && ctx.existing[f] == null
  );
  if (candidates.length === 0) return payload;
  const out = { ...payload };
  const ipoId = ctx.existing.id as string;
  const failClosed = (fields: readonly string[], e: unknown) => {
    for (const f of fields) {
      delete out[f];
      ctx.provenanceLookupFailed.add(f);
    }
    logger.warn(
      { ipoId, source: ctx.source, door: ctx.door, fields, error: e instanceof Error ? e.message : String(e) },
      '[DataPersister] #180 F2 provenance lookup failed - the stored empty hard date is kept (#1236 round 3)'
    );
  };
  const fieldSourcesRepo = getFieldSourcesRepository();
  let rowHasAnyTrackedProvenance: boolean;
  try {
    rowHasAnyTrackedProvenance = typeof (fieldSourcesRepo as any).findByIPOId === 'function'
      ? (await fieldSourcesRepo.findByIPOId(ipoId)).length > 0
      : true; // no way to tell -> assume tracked (the guard stays active)
  } catch (e) {
    failClosed(candidates, e);
    return out;
  }
  if (!rowHasAnyTrackedProvenance) return out;
  for (const dateField of candidates) {
    let priorSource: unknown;
    try {
      priorSource = await fieldSourcesRepo.findByField(ipoId, 'ipos', dateField);
    } catch (e) {
      failClosed([dateField], e);
      continue;
    }
    if (!priorSource) {
      logger.info(
        { ipoId, source: ctx.source, dateField, door: ctx.door },
        '[DataPersister] #180 F2 - dropping uncorroborated hard-date assertion on update (first touch, non-authoritative source)'
      );
      delete out[dateField];
    }
  }
  return out;
}

export const IPO_WRITE_GUARDS: readonly IpoWriteGuard[] = [
  // The consolidator's per-field source-priority decision (field-priority matrix, OD-64 venue).
  { name: 'source-precedence', consolidatorEnforced: true, run: guardSourcePrecedence },
  {
    // Never let a scraper's generic 'IPO' downgrade a stored specific classification
    // (takeover/buyback/rights/debt; see reclassify-corporate-actions.ts).
    name: 'offering-type-keeps-classification',
    consolidatorEnforced: false,
    run: (payload, ctx) => {
      if (!payload.offeringType) return payload;
      return {
        ...payload,
        offeringType: resolveOfferingTypeKeepingClassification(ctx.existing.offeringType, payload.offeringType),
      };
    },
  },
  {
    // #180 F1 / P1-1: an SME row has no genuine FPO unless an exchange vouches for it (this scrape's
    // source or the stored value's provenance). A failed provenance read keeps the stored value.
    name: 'sme-offering-type-fpo',
    consolidatorEnforced: false,
    run: async (payload, ctx) => {
      if (!('offeringType' in payload)) return payload;
      const segment = 'segment' in payload ? payload.segment : (ctx.existing.segment ?? null);
      const lookup = await getStoredOfferingTypeSource(ctx.existing.id);
      if (lookup.lookupFailed) ctx.provenanceLookupFailed.add('offeringType');
      return {
        ...payload,
        offeringType: guardSmeOfferingTypeWithLookup(segment, payload.offeringType, ctx.source, lookup, ctx.existing.offeringType),
      };
    },
  },
  { name: 'hard-date-first-touch-f2', consolidatorEnforced: false, run: guardFirstTouchHardDates },
  {
    // W-14: a field the merged-record rule set refused stays at its stored value on every door.
    name: 'merged-record-validation-w14',
    consolidatorEnforced: false,
    run: (payload, ctx) => {
      if (ctx.mergedValidationDroppedFields.length === 0) return payload;
      const out = { ...payload };
      for (const field of ctx.mergedValidationDroppedFields) delete out[field];
      return out;
    },
  },
  {
    // T-276: never collapse a stored real band to min === max (FIXED_PRICE exempt). The fallback door
    // has no field_sources map, so the stored row is the signal (the consolidator's untracked path, T-281).
    name: 'degenerate-price-band-t276',
    consolidatorEnforced: true,
    run: (payload, ctx) => {
      const degenerate = collectDegeneratePriceBandFields(ctx.incoming as any, new Map(), ctx.existing as any);
      if (degenerate.size === 0) return payload;
      const out = { ...payload };
      for (const fieldName of degenerate) delete out[fieldName];
      logger.warn(
        { ipoId: ctx.existing.id, source: ctx.source, door: ctx.door, fields: [...degenerate], reason: 'DEGENERATE_PRICE_BAND' },
        '[DataPersister] degenerate price band not written over a stored real range (T-276, #1253)'
      );
      return out;
    },
  },
  {
    // OD-66 context fields and, for a document source, E-1 fields (section 1.2.1) are not claims.
    name: 'non-claims-context-e1',
    consolidatorEnforced: true,
    run: (payload, ctx) => {
      const { update, refused } = dropFallbackNonClaims(payload, ctx.source, ctx.contextFields);
      if (refused.length > 0) {
        logger.warn(
          { ipoId: ctx.existing.id, source: ctx.source, door: ctx.door, fields: refused, reason: 'fallback-non-claim-refused' },
          '[DataPersister] context / document-path E-1 field(s) not published (OD-66, section 1.2.1, #454)'
        );
      }
      return update;
    },
  },
  {
    // WITHDRAWN / DELISTED (terminal) and POSTPONED (section 2.9) are never overwritten by an ordinary scrape.
    name: 'terminal-status-kept',
    consolidatorEnforced: true,
    run: (payload, ctx) => keepTerminalIpoStatus(ctx.existing.status, payload),
  },
];

/** Runs IPO_WRITE_GUARDS in order on a door's merged payload; returns the guarded copy. */
export async function applyIpoWriteGuards(
  payload: Record<string, any>,
  ctx: IpoWriteGuardContext
): Promise<Record<string, any>> {
  let out = payload;
  for (const guard of IPO_WRITE_GUARDS) {
    if (ctx.door === 'consolidation' && guard.consolidatorEnforced) continue;
    out = await guard.run(out, ctx);
  }
  return out;
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
import { normalizeCompanyNameForMatching, rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';
import { stripIdentityNameDecoration, stripIdentitySlugSuffix } from '@ipodhan/shared/utils/identity-decoration';
import {
  toListingExchangesForSource,
  violatesSmeSingleExchange,
  decideListingExchangesOd129,
} from './listing-exchange-resolution.js';
export { normalizeCompanyNameForMatching };

/** Minimal repository surface `writeOpeningDayIpoFields` needs. */
export interface OpeningDayWriteRepo {
  /** `IPORepository.updateReportingHolds`: the write, plus the fields an admin hold dropped (§9.2 item 19). */
  updateReportingHolds: (ipoId: string, data: Record<string, unknown>) => Promise<{ dropped: string[] }>;
  create: (values: any, opts: { sourceKeys: any[] | null; boundBy: string }) => Promise<{ id: string }>;
}

/** Minimal `FieldSourcesRepository` surface `writeOpeningDayIpoFields` needs. */
export interface OpeningDayFieldSourcesWriter {
  trackFieldUpdate: (input: {
    ipoId: string;
    tableName: string;
    fieldName: string;
    source: string;
    confidence?: number;
    previousValue?: string | null;
  }) => Promise<unknown>;
}

/**
 * The opening-day check's (item 7 S4, OD-87/OD-88) ONLY door to `ipos` — the
 * narrow write kept OUT of `upsertIPO` (round 4, #951: the whole-row
 * consolidated save overwrote listingExchanges). SETs exactly the given
 * `set` (companyName/status/openDate/closeDate, per OD-87) on an existing
 * row, or CREATEs a new row (NSE-list only, OD-88) with `set` plus
 * `segment`/`offeringType`/`slug`. Every column it writes gets its own
 * `field_sources` row, except one the field-priority decision call already
 * recorded (`alreadyTracked`) — never duplicated, never left unrecorded.
 *
 * Caller (`createOpeningDayWriter`, scraper/src/scheduler/opening-day-discovery.ts)
 * owns identity resolution, the per-IPO lock check and field protection, and
 * the field-priority decision itself; this function only performs the write
 * those steps decided on, so the write-ratchet's `repository` pattern
 * (`ipoRepository.(create|update)(`) has one owning file for every job, not
 * a second one per job (write-ratchet-baseline.json stays shrink-only).
 */
export async function writeOpeningDayIpoFields(params: {
  ipoRepository: OpeningDayWriteRepo;
  fieldSources: OpeningDayFieldSourcesWriter;
  sourceTrackingEnabled: boolean;
  source: string;
  existing: Record<string, any> | null | undefined;
  set: Record<string, unknown>;
  slug: string;
  segment: unknown;
  sourceKeys: any[] | null;
  boundBy: string;
  confidence: number;
  /** `ipos` field names the field-priority decision call already tracked provenance for. */
  alreadyTracked: string[];
}): Promise<{ outcome: 'inserted' | 'updated' | 'unchanged' | 'skipped'; ipoId: string | null; written: Record<string, unknown>; fieldSources: string[] }> {
  const { ipoRepository, fieldSources, sourceTrackingEnabled, source, existing, set, slug, segment, sourceKeys, boundBy, confidence, alreadyTracked } = params;

  let ipoId: string;
  let written: Record<string, unknown>;
  if (existing) {
    if (Object.keys(set).length === 0) return { outcome: 'unchanged', ipoId: existing.id, written: {}, fieldSources: [] };
    // OD-131 + §9.2 item 19: a field an admin hold dropped was NOT written, so it is not in
    // `written` and gets no provenance row — the ADMIN row stays that field's source.
    const { dropped } = await ipoRepository.updateReportingHolds(existing.id, set);
    ipoId = existing.id;
    written = Object.fromEntries(Object.entries(set).filter(([k]) => !dropped.includes(k)));
    if (Object.keys(written).length === 0) return { outcome: 'unchanged', ipoId, written: {}, fieldSources: [] };
  } else {
    if (!set.companyName || !set.status) return { outcome: 'skipped', ipoId: null, written: {}, fieldSources: [] };
    written = { ...set, segment, offeringType: 'IPO' };
    const row = await ipoRepository.create({ ...written, slug }, { sourceKeys, boundBy });
    ipoId = row.id;
  }

  // Every provenance row this write produced: the decision call's own (which may
  // include a column whose value did not change but whose owning source did) plus
  // this write's. The step ledger's F6 count is this list's length.
  const trackedFieldSources: string[] = alreadyTracked.filter((f) => !(f in written));
  if (sourceTrackingEnabled) {
    for (const fieldName of Object.keys(written)) {
      if (!alreadyTracked.includes(fieldName)) {
        const prior = existing?.[fieldName];
        await fieldSources.trackFieldUpdate({
          ipoId,
          tableName: 'ipos',
          fieldName,
          source,
          confidence,
          previousValue: prior === undefined || prior === null ? null : prior instanceof Date ? prior.toISOString() : String(prior),
        });
      }
      trackedFieldSources.push(fieldName);
    }
  }

  return { outcome: existing ? 'updated' : 'inserted', ipoId, written, fieldSources: trackedFieldSources };
}

/** Minimal repository surface the post-listing price writes need (item 7 S5). */
export interface PostListingPriceWriteRepo {
  update: (ipoId: string, data: Record<string, unknown>) => Promise<unknown>;
}

/** The price write also needs the dropped-field report (§9.2 item 19, OD-131). */
export interface PostListingPriceHoldRepo extends PostListingPriceWriteRepo {
  updateReportingHolds: (ipoId: string, data: Record<string, unknown>) => Promise<{ dropped: string[] }>;
}

/**
 * `IPORepository.updateReportingHolds` where the repository has it (always, in production — the
 * `upsertIPO` doors are typed `IPORepository`); an untyped test fake with only `update` reports none.
 */
/**
 * #1233 round 2 (MAJOR-3): options for `upsertIPO`.
 * `inIposWriteTx` runs INSIDE the `ipos` update's own transaction (`IPORepository.updateReportingHolds`
 * option `inTx`), after the update and under the row lock that write takes, with the type slice
 * (`segment`, `listingExchanges`, `offeringType`) read in that transaction before the update. A throw
 * rolls the `ipos` write back. Not run when the write is a no-op (nothing changed, so the plan inputs
 * did not change either) or when the row is created.
 */
export interface UpsertIpoOptions {
  inIposWriteTx?: (
    tx: unknown,
    before: { segment: string | null; listingExchanges: string[] | null; offeringType: string | null }
  ) => Promise<void>;
}

async function updateReportingHolds(
  repo: {
    update: (id: string, data: any) => Promise<unknown>;
    updateReportingHolds?: (id: string, data: any, options?: { inTx?: UpsertIpoOptions['inIposWriteTx'] }) => Promise<{ dropped: string[] }>;
  },
  id: string,
  data: Record<string, unknown>,
  inTx?: UpsertIpoOptions['inIposWriteTx']
): Promise<string[]> {
  if (typeof repo.updateReportingHolds === 'function') {
    return (await repo.updateReportingHolds(id, data, inTx ? { inTx } : undefined)).dropped;
  }
  // Fail closed: a caller that needs work inside the write transaction must never get a write without it.
  if (inTx) throw new Error('upsertIPO: inIposWriteTx needs a repository with updateReportingHolds (no transactional write available)');
  await repo.update(id, data);
  return [];
}

/** The exact `ipos` columns the post-listing price write may SET (OD-29: the price and its as-of stamp). */
export const POST_LISTING_PRICE_COLUMNS = ['currentPrice', 'currentPriceUpdatedAt'] as const;

/** A stored `current_price_updated_at` (Date from the ORM, or the naive column's UTC text) as an instant. */
export function storedAsOfInstant(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (text === '') return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Item 7 S5 (spec §2.1 job row "Post-listing price", OD-29, OD-54): the price job's ONLY
 * door to the price columns. SETs at most `currentPrice` and `currentPriceUpdatedAt` (the
 * repository adds its own `updated_at` housekeeping stamp) through `IPORepository.update`
 * (cache invalidated), never `upsertIPO` (#951: the whole-row save writes unclaimed columns).
 * `asOf` is the EXCHANGE's own as-of instant (NSE `lastUpdateTime` / BSE `Ason`, IST converted
 * to UTC). Drizzle's timestamp mapper binds `asOf.toISOString()` (ist-timezone.md; the
 * integration test round-trips it with drift 0).
 *
 *   stale     — the as-of is OLDER than the stored one (round 2, Tier A MAJOR 2: the as-of only
 *               moves forward, so a slow run or a lagging exchange mirror can never overwrite a
 *               newer price with an older one). Nothing is written.
 *   unchanged — same price, same or no newer as-of. Nothing is written (OD-73).
 *   confirmed — same price, newer as-of: only `currentPriceUpdatedAt` moves, because §2.1
 *               "Label" shows the price "with the timestamp it was read at"; one provenance row.
 *   updated   — a new price: both columns, one provenance row each.
 */
export async function writePostListingPrice(params: {
  ipoRepository: PostListingPriceHoldRepo;
  fieldSources: OpeningDayFieldSourcesWriter;
  sourceTrackingEnabled: boolean;
  ipoId: string;
  existing: { currentPrice: unknown; currentPriceUpdatedAt: unknown };
  price: number;
  asOf: Date;
  source: 'NSE' | 'BSE';
}): Promise<{ outcome: 'updated' | 'confirmed' | 'unchanged' | 'stale'; written: string[]; fieldSources: string[] }> {
  const { ipoRepository, fieldSources, sourceTrackingEnabled, ipoId, existing, price, asOf, source } = params;
  if (!(Number.isFinite(price) && price > 0) || Number.isNaN(asOf.getTime())) {
    throw new Error(`writePostListingPrice: refused price ${price} / as-of ${String(asOf)} for ${ipoId}`);
  }
  const storedAsOf = storedAsOfInstant(existing.currentPriceUpdatedAt);
  if (storedAsOf && asOf.getTime() < storedAsOf.getTime()) {
    return { outcome: 'stale', written: [], fieldSources: [] };
  }
  const rounded = price.toFixed(2);
  const prior = existing.currentPrice === null || existing.currentPrice === undefined ? null : Number(existing.currentPrice);
  const samePrice = prior !== null && prior.toFixed(2) === rounded;
  if (samePrice && storedAsOf && asOf.getTime() === storedAsOf.getTime()) {
    return { outcome: 'unchanged', written: [], fieldSources: [] };
  }
  const set: Record<string, unknown> = samePrice ? { currentPriceUpdatedAt: asOf } : { currentPrice: rounded, currentPriceUpdatedAt: asOf };
  // OD-131 + §9.2 item 19: an admin-held price column was not written; it gets no NSE/BSE provenance row.
  const { dropped } = await ipoRepository.updateReportingHolds(ipoId, set);
  const writtenFields = Object.keys(set).filter((f) => !dropped.includes(f));
  if (writtenFields.length === 0) return { outcome: 'unchanged', written: [], fieldSources: [] };
  const tracked: string[] = [];
  if (sourceTrackingEnabled) {
    const previous: Record<string, string | null> = {
      currentPrice: prior === null ? null : prior.toFixed(2),
      currentPriceUpdatedAt: storedAsOf ? storedAsOf.toISOString() : null,
    };
    for (const fieldName of writtenFields) {
      await fieldSources.trackFieldUpdate({ ipoId, tableName: 'ipos', fieldName, source, confidence: 1, previousValue: previous[fieldName] });
      tracked.push(fieldName);
    }
  }
  return { outcome: samePrice || !writtenFields.includes('currentPrice') ? 'confirmed' : 'updated', written: writtenFields, fieldSources: tracked };
}

/** The `ipos` column the post-listing state write may SET (the cached working NSE series). */
export const POST_LISTING_STATE_COLUMNS = ['priceNseSeries'] as const;

/**
 * Minimal shape `writePostListingAttempt` needs — matches the one drizzle call it makes,
 * injectable so a unit test can assert the exact SET without a live database.
 */
export interface PriceAttemptWriter {
  update: typeof db.update;
}

/**
 * #1310 round 2 (MAJOR-2, listed-rotation-stall, 2nd write path): stamps `priceLastAttemptAt`
 * on the row — called for EVERY candidate the job actually attempted this run (priced,
 * no-price, refused, or an unexpected error), never only on a successful price write. This is
 * the ONLY thing that stops a never-priceable row from pinning the front of
 * `selectPriceCandidates`'s ASC-NULLS-FIRST order forever.
 *
 * Deliberately bypasses `IPORepository.update()`: that path re-checks admin/scraper-lock
 * protection inside its own transaction (`filterPatchUnderHold(..., { honourScraperLock: true
 * })`, field-hold.ts:53) and drops EVERY key of the patch for a `scraper_locked` row — this
 * stamp included, which would leave a locked LISTED row pinning the front forever, exactly the
 * starvation this fix exists to stop. `price_last_attempt_at` is job bookkeeping, not a
 * published field: no admin ever holds it, so the hold check has nothing to protect here.
 * Writing straight through drizzle also fixes MINOR-1 as a side effect — no `updatedAt` bump
 * (which would churn the sitemap's lastmod) and no repository cache flush (`ipo:list`/`search`)
 * on every walked row, priced or not. A Date object is bound (never a `.toISOString()` string)
 * per ist-timezone.md: drizzle's own mapper calls `.toISOString()` on whatever it is handed.
 * A failure here is logged and swallowed by the caller — it must never crash the run.
 *
 * #1323: this is a direct `db.update(iposTable)` through the `ipos as iposTable` import alias
 * (line ~27) — baselined in `config/write-ratchet-baseline.json` under the `drizzle` pattern.
 * Written reason: job bookkeeping (`price_last_attempt_at`), never scraped or published data —
 * see the paragraph above for why it deliberately bypasses the shared repository write path.
 */
export async function writePostListingAttempt(params: {
  db: PriceAttemptWriter;
  ipoId: string;
  at: Date;
}): Promise<void> {
  await params.db.update(iposTable).set({ priceLastAttemptAt: params.at }).where(eqOp(iposTable.id, params.ipoId));
}

/**
 * Item 7 S5 (spec §2.1 job row "Post-listing price"): the job's row state. SETs only
 * `priceNseSeries` (the stock's working NSE series, asked first next time).
 */
export async function writePostListingState(params: {
  ipoRepository: PostListingPriceWriteRepo;
  ipoId: string;
  patch: { nseSeries?: string };
}): Promise<string[]> {
  const { patch } = params;
  const set: Record<string, unknown> = {};
  if (patch.nseSeries !== undefined) set.priceNseSeries = patch.nseSeries;
  if (Object.keys(set).length === 0) return [];
  await params.ipoRepository.update(params.ipoId, set);
  return Object.keys(set);
}

/**
 * #983 / OD-132 (spec 2.3.3.3): persist the post-listing price job's delisting count. On the third
 * consecutive delisting report (`delistAt` set) the row's status becomes DELISTED with the third
 * read's instant in `delisted_at`; the price job then stops for it (it selects LISTED rows only).
 * Only these four columns are written.
 */
export async function writeDelistingState(params: {
  ipoRepository: PostListingPriceWriteRepo;
  ipoId: string;
  next: { strikes: number; reads: Array<{ at: string; exchange: string; detail: string }> };
  delistAt: Date | null;
}): Promise<string[]> {
  const set: Record<string, unknown> = {
    delistingStrikes: params.next.strikes,
    delistingStrikeReads: params.next.reads.length > 0 ? params.next.reads : null,
  };
  if (params.delistAt) {
    set.status = 'DELISTED';
    set.delistedAt = params.delistAt;
  }
  await params.ipoRepository.update(params.ipoId, set);
  return Object.keys(set);
}

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
  preResolvedIPO?: IPO | null,
  /**
   * OD-66: keys of `scrapedIPO` this write is NOT claiming — identity facts
   * the caller had to supply so the slug could be computed and the row
   * resolved, never values the source asserts. Passed straight through to
   * `consolidateIPOData`. Omitted means "every key is a claim" (unchanged).
   */
  contextFields?: string[],
  /**
   * #993: the caller's `field_sources.data_lineage` for the values it supplies (the filing
   * persister's `{method, docType, documentId, sourceSha, ...}`). Passed to consolidation, which
   * merges it into a provenance row ONLY when the value written came from this caller's source
   * (never onto a row another source owns). Omitted = unchanged behaviour.
   */
  lineage?: Record<string, unknown> | null,
  /** #1233 round 2: see `UpsertIpoOptions`. Omitted = unchanged behaviour. */
  options?: UpsertIpoOptions
): Promise<string> {
  // OD-85: one record = one source-key lineage scope, so its field_sources rows carry the key ids
  // that bound it (reuses the caller's scope when BaseScraperOrchestrator already opened one).
  return withSourceKeyLineage(() => upsertIPOInScope(ipoRepository, scrapedIPO, source, preResolvedIPO, contextFields, lineage, options));
}

async function upsertIPOInScope(
  ipoRepository: IPORepository,
  scrapedIPO: ScrapedIPO,
  source: ScraperSource,
  preResolvedIPO: IPO | null | undefined,
  contextFields: string[] | undefined,
  lineage?: Record<string, unknown> | null,
  options?: UpsertIpoOptions
): Promise<string> {
  const startTime = Date.now();
  // T-478 round 3 (issue #225 follow-up, CRITICAL fix): the -ofs-<year> slug
  // (and the identity guard below) apply ONLY to an EXPLICITLY classified
  // OFS record (offeringTypeExplicit) — every other source hard-defaults
  // offeringType='IPO' with no real signal, and treating that default as
  // "this is definitely an IPO, not an OFS" would decline every identity
  // tier on a re-scrape of a legacy OFS row and attempt a colliding create
  // (23505) every cycle. `ofsSlugYear` never falls back to the current
  // wall-clock date (round 2's bug: a Dec/Jan re-scrape shifted the slug) —
  // it is null when the source has no derivable date, in which case a
  // stable, non-time-dependent `-ofs-unknown` marker is used instead (never
  // Date.now()) so the slug cannot drift between cycles.
  const offeringTypeExplicit = (scrapedIPO as any).offeringTypeExplicit === true;
  const slug = computeIpoIdentitySlug(scrapedIPO);
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
  /** #1236: provenance lookups that threw during this write (the stored value was kept). */
  const provenanceLookupFailed = new Set<string>();

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
            // OD-34 step 1 (§2.3.3.2): the CIN binds before every other identifier.
            cin: scrapedIPO.cin ?? null,
            isin: scrapedIPO.isin,
            symbol: scrapedIPO.symbol,
            openDate: scrapedIPO.openDate ?? null,
            priceRangeMin: scrapedIPO.priceRangeMin ?? null,
            priceRangeMax: scrapedIPO.priceRangeMax ?? null,
            segment: scrapedIPO.segment ?? null,
            // T-478 round 3: explicit-only, same rationale as
            // BaseScraperOrchestrator.ts.
            offeringType: offeringTypeExplicit ? scrapedIPO.offeringType : undefined,
            // OD-85: the record's own source numbers, tried before every other step.
            sourceKeys: (scrapedIPO as any).sourceKeys ?? null,
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

      // W-145: one shared rule for "which boards does THIS source prove?" —
      // NSE/BSE assert only themselves, a 'BOTH' from an aggregator is unknown
      // (undefined), and unknown leaves the column NULL rather than writing a
      // guessed pair. `[scrapedIPO.listingExchange]` used to be written blind,
      // which produced `[undefined]` the moment the field became optional.
      // #938 echo: a listing exchange the caller declared as CONTEXT (the
      // filing persister re-sends the STORED boards so the row resolves) is
      // not this write's claim, under either spelling of the key.
      const listingExchangeIsContext = fallbackContextKeys(contextFields).has('listingExchanges');
      const listingExchanges = toListingExchangesForSource(scrapedIPO.listingExchange, source);

      // Stage A.5 write-path date-plausibility guard (#41/#52): a current scrape must
      // not stomp an old IPO's open/close dates. Anchor on the trustworthy post-IPO
      // dates (this scrape's, else the existing row's allotment/listing) and drop any
      // open/close that contradicts the anchor by years.
      // #1229: every one of the four is merged with the stored row (open/close
      // were not, so an incoming listing with stored open/close read as "listing
      // with no open"). Only a key THIS scrape carried is judged or taken below.
      const scrapedDateKeys = new Set(
        (['openDate', 'closeDate', 'allotmentDate', 'listingDate'] as const).filter((k) => !!scrapedIPO[k])
      );
      const rawDatesForSanitize = {
        openDate: scrapedIPO.openDate || (existingIPO?.openDate ?? null),
        closeDate: scrapedIPO.closeDate || (existingIPO?.closeDate ?? null),
        allotmentDate: scrapedIPO.allotmentDate || (existingIPO?.allotmentDate ?? null),
        listingDate: scrapedIPO.listingDate || (existingIPO?.listingDate ?? null),
      };
      const safeDates = sanitizeIpoDates(rawDatesForSanitize);
      // T-299 (#P2-7): a violation MUST be loud, not just silently nulled — this is
      // the create/legacy-update path's only date-plausibility log (the
      // consolidation-update path logs via isDateSequenceCoherent above).
      (['openDate', 'closeDate', 'allotmentDate', 'listingDate'] as const).forEach((k) => {
        if (scrapedDateKeys.has(k) && rawDatesForSanitize[k] != null && safeDates[k] == null) {
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
      let safeIssueSize = coercePositiveOrNull(scrapedIPO.issueSize);

      // W-177: the T-329 segment-floor / shares-x-band plausibility guard
      // (`collectImplausibleIssueSizeFields`) was wired only into the
      // consolidation UPDATE path (`consolidateIPOData`), not here — the
      // CREATE path and the legacy non-destructive-fallback UPDATE path both
      // build `ipoData.issueSize` from `safeIssueSize` alone, so a fresh SME
      // row created straight from a source's raw share count (e.g.
      // CHITTORGARH, the matrix winner for SME) never passed through the
      // check at all. Re-run the SAME helper here — never a re-derived
      // threshold — so every write door rejects an implausible value the
      // same way: never written, loud WARN with the segment floor / shares-x-
      // band figure for whoever reviews the log.
      //
      // W-177 round 2 (MAJOR-1): `ScrapedIPO` (validators.ts `ScrapedIPOSchema`)
      // has NO `sharesOffered`/`noOfSharesOffered` field at all — that name
      // belongs to `ScrapedSubscriptionSchema`, a different payload entirely.
      // No IPO-main scraper/adapter currently sets either key on the object
      // reaching this door (NSE's `computeNSEIssueSizeRupees` reads
      // `noOfSharesOffered` off the RAW API response and converts it to
      // rupees internally — the share count itself never survives onto
      // `ScrapedIPO`), so the coherence (shares x band) arm of
      // `collectImplausibleIssueSizeFields` is currently a no-op on this
      // path: it only fires once some scraper actually populates one of
      // these keys. `?? noOfSharesOffered` matches the helper's own
      // preference order so the day a source starts supplying it, this door
      // and the consolidation orchestrator agree with no further change.
      if (safeIssueSize !== null) {
        const effectiveSegment = scrapedIPO.segment ?? existingIPO?.segment ?? null;
        const implausible = collectImplausibleIssueSizeFields(
          {
            issueSize: safeIssueSize,
            segment: effectiveSegment,
            sharesOffered: (scrapedIPO as any).noOfSharesOffered ?? (scrapedIPO as any).sharesOffered,
            priceRangeMin: scrapedIPO.priceRangeMin,
            priceRangeMax: scrapedIPO.priceRangeMax,
          },
          existingIPO
            ? { segment: existingIPO.segment, priceRangeMin: existingIPO.priceRangeMin, priceRangeMax: existingIPO.priceRangeMax }
            : null,
          source
        );
        if (implausible.fields.has('issueSize')) {
          logger.warn({
            ipoId: existingIPO?.id ?? null,
            companyName: scrapedIPO.companyName,
            source,
            path: existingIPO ? 'legacy-fallback-update' : 'create',
            rejectedIssueSize: safeIssueSize,
            segment: effectiveSegment,
            segmentFloor: effectiveSegment === 'MAINBOARD' ? MAINBOARD_ISSUE_SIZE_FLOOR : effectiveSegment === 'SME' ? SME_ISSUE_SIZE_FLOOR : null,
            sharesOffered: (scrapedIPO as any).noOfSharesOffered ?? (scrapedIPO as any).sharesOffered ?? null,
            priceRangeMin: scrapedIPO.priceRangeMin ?? existingIPO?.priceRangeMin ?? null,
            priceRangeMax: scrapedIPO.priceRangeMax ?? existingIPO?.priceRangeMax ?? null,
            reason: implausible.reason,
          }, '[IssueSizePlausibility] rejected implausible issueSize at the create/legacy-fallback write door (W-177)');
          safeIssueSize = null;
        }
      }

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
        openDate: scrapedDateKeys.has('openDate') ? ((safeDates.openDate as Date | undefined) ?? undefined) : undefined,
        closeDate: scrapedDateKeys.has('closeDate') ? ((safeDates.closeDate as Date | undefined) ?? undefined) : undefined,
        // Convert empty strings to undefined for date fields (Story 11.7 - Fix Chittorgarh date handling)
        // #1229 review r1: the SANITIZED value, like open/close above -- the raw
        // one was written by the create door and the fallback update (both read
        // ipoData) even after the check above logged it "rejected".
        allotmentDate: scrapedDateKeys.has('allotmentDate') ? ((safeDates.allotmentDate as string | undefined) ?? undefined) : undefined,
        listingDate: scrapedDateKeys.has('listingDate') ? ((safeDates.listingDate as string | undefined) ?? undefined) : undefined,
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

      // W-104: the public slug is a canonical URL key and is generated ONLY at
      // row creation. On every UPDATE path (the consolidation `incomingData`
      // below, and the non-destructive fallback via `buildNonDestructiveUpdate`)
      // the freshly-generated slug MUST be dropped before it reaches either
      // write door — a companyName correction from ANY scrape (even DRHP, see
      // the "Rays of Belief" live incident) would otherwise silently re-slug an
      // existing row and break every stored link, the sitemap, and the search
      // index. ADMIN is the sole source trusted to intentionally change a slug.
      if (existingIPO && source !== 'ADMIN') {
        delete (ipoData as any).slug;
      }

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
        // #180 Tier-A round 6: `source` here IS the source asserting this
        // incoming FPO value THIS scrape (trusts a bootstrap write) — but
        // this door also needs the STORED provenance (an existing row whose
        // offeringType was already vouched for by NSE/BSE), same as every
        // other door, or it silently drops that signal.
        const storedOfferingTypeLookup = await getStoredOfferingTypeSource(existingIPO?.id);
        if (storedOfferingTypeLookup.lookupFailed) provenanceLookupFailed.add('offeringType');
        (ipoData as any).offeringType = guardSmeOfferingTypeWithLookup(
          effectiveSegment,
          (ipoData as any).offeringType,
          source,
          storedOfferingTypeLookup,
          existingIPO?.offeringType
        );
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
        // OD-131: provenance the consolidation door decided but has not committed yet. Held
        // OUTSIDE its try so that, when a step after consolidation throws, the non-destructive
        // fallback below commits it for the values the fallback actually stores (before OD-131
        // these rows were written inline, so dropping them on the fallback would lose lineage).
        // Cleared the moment it is committed, so it is never written twice.
        // #1253: set when ANY provenance commit on the fallback door fails (the deferred commit writes
        // row by row, so a failure is partial), so the ledger never claims lineage that was not written.
        let fallbackProvenanceWriteFailed = false;
        let uncommittedProvenance:
          | { service: { commitDeferredProvenance: DataConsolidationService['commitDeferredProvenance'] }; writes: DeferredProvenanceWrite[] }
          | undefined;

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
              // #938 echo: the caller names the payload key (`listingExchange`,
              // singular); the consolidator sees the mapped `listingExchanges`.
              // Name both, or the stored boards are re-claimed as this source's.
              contextFields: listingExchangeIsContext
                ? [...new Set([...(contextFields ?? []), 'listingExchanges'])]
                : contextFields,
              source: source,
              incomingLineage: lineage ?? null,
              existingData: existingIPO as any,
              shadowMode: false, // Production mode - writes to database
              scrapedAt: new Date(),
              // OD-131: this door refuses values AFTER consolidation (sanitizeIpoWriteFields,
              // the #180 F2 date guard, W-14 merged-record drops). Provenance is committed only
              // for what reaches the row, below — a refused value was never set.
              deferProvenance: true,
            });
            if (consolidationResult.deferredProvenance?.length) {
              uncommittedProvenance = { service: consolidationService, writes: consolidationResult.deferredProvenance };
            }

            const consolidationDuration = Date.now() - consolidationStartTime;

            // Merge exchanges (preserve exchange tracking logic).
            // W-145: the union is over what each source can actually prove —
            // NSE/BSE self-assertions only — and an SME row may hold exactly ONE
            // board, so a merge that would widen an SME row is refused here too
            // (the consolidation service logs the conflict row).
            let mergedExchanges = existingIPO.listingExchanges as ('NSE' | 'BSE')[];
            const segment = (existingIPO.segment ?? scrapedIPO.segment) as string | null | undefined;
            // OD-129 (#938): when the consolidation decided the set document-first
            // (a document replaced or confirmed it, or a stored document set held
            // against a feed), its decision IS the value — re-running the union
            // here would re-add the very board the document ruled out.
            const od129Result = consolidationResult.fieldResults.find(
              (f) => f.fieldName === 'listingExchanges' && String(f.conflictReason ?? '').startsWith('OD129_')
            );
            const incomingExchanges = listingExchangeIsContext || od129Result
              ? undefined
              : toListingExchangesForSource(scrapedIPO.listingExchange, source);
            if (od129Result && Array.isArray(od129Result.finalValue)) {
              mergedExchanges = od129Result.finalValue as ('NSE' | 'BSE')[];
            }
            if (incomingExchanges) {
              const widened = [...(mergedExchanges ?? [])];
              for (const exchange of incomingExchanges) {
                if (!widened.includes(exchange)) widened.push(exchange);
              }
              if (violatesSmeSingleExchange(segment, widened)) {
                logger.warn(
                  { ipoId: existingIPO.id, source, segment, stored: mergedExchanges, incomingExchanges },
                  '[DataPersister] W-145 SME single-exchange invariant - refusing to widen an SME row'
                );
              } else {
                mergedExchanges = widened as ('NSE' | 'BSE')[];
              }
            }

            // #52 observability: detect an incoherent merged date sequence BEFORE the
            // sanitizer corrects it, so a consolidation mis-merge recurrence is visible
            // in prod logs/alerting (the sanitize below only silently nulls the offender).
            // #1229: judged on the MERGED record (stored row + this update), the
            // same view the sanitizer below uses — the consolidation result holds
            // only this update's fields, so a listing-only update read as
            // "listing_date present without open_date".
            const rawConsolidated = consolidationResult.consolidatedData;
            const mergedDates = mergedDateSet(rawConsolidated, existingIPO as any);
            const dateCoherence = isDateSequenceCoherent(mergedDates);
            if (!dateCoherence.ok) {
              logger.warn({
                ipoId: existingIPO.id,
                companyName: scrapedIPO.companyName,
                source,
                reason: dateCoherence.reason,
                dates: mergedDates,
                incomingDateKeys: Object.keys(rawConsolidated).filter((k) => k in mergedDates),
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
            let finalData: Record<string, any> = {
              ...sanitizeIpoWriteFields(rawConsolidated, existingIPO as any),
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

            // #1236 round 3: the shared guard list (classification keep, SME-FPO, #180 F2 hard dates,
            // W-14), the SAME list the fallback door runs. A guard whose own provenance read throws keeps
            // the stored value and flags it; it no longer throws the whole write onto the fallback door.
            finalData = await applyIpoWriteGuards(finalData, {
              door: 'consolidation',
              existing: existingIPO as any,
              incoming: ipoData as any,
              source,
              contextFields,
              mergedValidationDroppedFields,
              provenanceLookupFailed,
            });

            // S-02 §5 no-op write suppression, corrected in round 3 (C1/C2/M3).
            // The skip is decided by an actual field-by-field diff of the FINAL
            // payload against the STORED ROW — not by
            // `consolidationResult.fieldsUpdated`, which counts `field_sources`
            // provenance rows and is computed before `listingExchanges`,
            // `registrarId`, `offeringType` and the write-field sanitizers are
            // applied above. See `diffFieldsForWrite` for the two bugs that
            // caused. Skipping the write skips BOTH the `ipos` row write AND the
            // per-row cache invalidation `ipoRepository.update()` performs
            // internally (BaseRepository cache-aside) — exactly the pair the S-02
            // §5 write-suppression design calls out. `lastScrapedAt`/`updatedAt`
            // bumps are deliberately foregone on a true no-op cycle; the next
            // cycle that DOES change a field still refreshes them via `finalData`.
            // Round-4 M-LOW: `existingIPO` can be the resolver's cached
            // `findBySlug` result (IPO_DETAIL, 900s TTL — see `resolveIpoRow`'s
            // name/slug tiers). A row repaired by a direct write while the
            // cache still holds the old snapshot would be diffed against that
            // stale snapshot and the real change skipped for up to 15 minutes.
            // Re-read uncached, by id, right before the diff decides whether to
            // write — non-fatal: on any failure, fall back to the already-
            // resolved row rather than blocking the write.
            let diffAgainst: Record<string, unknown> = existingIPO as unknown as Record<string, unknown>;
            try {
              const uncached = await ipoRepository.findByIdUncached(existingIPO.id);
              if (uncached) diffAgainst = uncached as unknown as Record<string, unknown>;
            } catch (error) {
              logger.warn({
                ipoId: existingIPO.id,
                error: error instanceof Error ? error.message : String(error),
              }, 'Uncached re-read before write-diff failed (non-fatal) — diffing against the already-resolved row');
            }
            const changedFields = diffFieldsForWrite(finalData, diffAgainst);
            const isNoopUpdate = changedFields.length === 0;
            let heldDropped: string[] = [];
            if (isNoopUpdate) {
              logger.debug({
                ipoId: existingIPO.id,
                companyName: scrapedIPO.companyName,
                source,
                noop: true,
                fieldsUpdated: consolidationResult.fieldsUpdated ?? 0,
              }, '[DataConsolidation] No field actually changed — skipping ipos row update + cache invalidation');
            } else {
              // Update IPO with consolidated data. §9.2 item 19: the fields an admin hold dropped
              // inside the write transaction are reported back so no provenance claims them (OD-131).
              heldDropped = await updateReportingHolds(ipoRepository as never, existingIPO.id, finalData, options?.inIposWriteTx);
            }

            // OD-131 ("Rejected = never set"): write provenance only for values this door
            // actually stored. A value the sanitizer nulled or a guard deleted gets no
            // `field_sources` row (glass-wall-systems-india-ltd: CG's 2026-09-03 listing date,
            // before its 2026-09-08 open, was nulled here yet kept a CHITTORGARH row).
            const pendingWrites = uncommittedProvenance?.writes;
            uncommittedProvenance = undefined;
            const provenanceCommit = pendingWrites
              ? await consolidationService.commitDeferredProvenance(
                pendingWrites,
                (write) => isProvenanceValueStored(write, withoutHeld(finalData, heldDropped))
              )
              : { written: 0, refused: [] };
            if (provenanceCommit.refused.length > 0) {
              logger.info({
                ipoId: existingIPO.id,
                source,
                refusedFields: provenanceCommit.refused.map((w) => w.fieldName),
              }, '[DataPersister] OD-131 - refused value(s) not stored, so no field_sources row written');
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
              provenanceLookupFailed: [...provenanceLookupFailed],
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
        const storedExchangesProvenance = listingExchangeIsContext
          ? { source: null, lookupFailed: false }
          : await getStoredListingExchangesSource((existingIPO as any).id);
        if (storedExchangesProvenance.lookupFailed) provenanceLookupFailed.add('listingExchanges');
        const fallbackData: any = {
          ...buildNonDestructiveUpdate(existingIPO as any, ipoData),
          listingExchanges: mergeListingExchangesForSource(
            (existingIPO as any).listingExchanges,
            source,
            // #938 echo: context is never a claim, on this door either.
            listingExchangeIsContext ? undefined : scrapedIPO.listingExchange,
            ((existingIPO as any).segment ?? scrapedIPO.segment) as string | null | undefined,
            storedExchangesProvenance.source,
            storedExchangesProvenance.lookupFailed
          ),
          lastScrapedAt: new Date(),
          updatedAt: new Date(),
        };
        // #1236 round 3: EVERY guard the consolidation door applies, from the one shared list
        // (IPO_WRITE_GUARDS): source precedence, classification keep, SME-FPO, #180 F2 hard dates,
        // W-14, degenerate band (T-276), context / E-1 non-claims (OD-66, section 1.2.1), terminal status.
        const guardedFallback = await applyIpoWriteGuards(fallbackData, {
          door: 'fallback',
          existing: existingIPO as any,
          incoming: ipoData as any,
          source,
          contextFields,
          mergedValidationDroppedFields,
          provenanceLookupFailed,
        });
        const fallbackHeld = await updateReportingHolds(ipoRepository as never, existingIPO.id, guardedFallback, options?.inIposWriteTx);
        // OD-131 + §9.2 item 19: what the admin hold dropped was not stored; nothing below claims it.
        const storedFallback = withoutHeld(guardedFallback, fallbackHeld);

        // OD-131 (review round 1): consolidation already decided provenance for this payload and
        // a later step threw before it was committed. Commit it for exactly the values this door
        // stored: stored-only (same filter as the consolidation door) AND equal to what was
        // stored, because this door merges the raw payload rather than consolidation's winners,
        // so a decided value this door did not write must not be claimed. The #454 block below
        // then records this door's own changed values, as before.
        if (uncommittedProvenance) {
          const { service, writes } = uncommittedProvenance;
          uncommittedProvenance = undefined;
          try {
            await service.commitDeferredProvenance(writes, (write) =>
              isProvenanceValueStoredAsDecided(write, storedFallback)
            );
          } catch (e: any) {
            fallbackProvenanceWriteFailed = true;
            logger.error(
              { ipoId: existingIPO.id, source, error: e?.message, cause: e?.cause instanceof Error ? e.cause.message : e?.cause },
              '[DataPersister] OD-131 fallback-door deferred provenance commit failed after the ipos update committed'
            );
          }
        }

        // #454: this door writes published `ipos` values with zero
        // cross-source comparison (that is what "fallback" means), but a
        // published value with NO lineage AT ALL is the defect — staging
        // measured 11 rows with issueSize > 0 and no issueSize field_sources
        // row, all written on a prior version of this exact door. Track every
        // field this write actually persisted, at this write's source, same
        // shape as the create path (P3-11) and `recordDiscoveredLeadManagers`
        // (row_key '', bulkTrackFieldUpdates). Bookkeeping fields the caller
        // never asserted as data (`lastScrapedAt`, `updatedAt`) are excluded —
        // provenance for them would be noise, not lineage.
        //
        // Round 1 review (OD-73 CRITICAL + two MAJORs) found this first cut
        // over-claimed:
        //  1. It re-stamped a field with THIS source's provenance even when
        //     the incoming value was IDENTICAL to the stored one (raw
        //     `previousValue !== value` was never even checked) — a
        //     lower-ranked source silently demoted a DOC-owned settled value.
        //     Fixed by skipping any field where `valuesEqualForWrite` (the
        //     same normalized-equality the write-gate itself uses, not a
        //     raw `String()` compare that a date/decimal type difference
        //     would fool) says nothing changed.
        //  2. It ignored `contextFields`/`listingExchange(s)` context (OD-66)
        //     and could hand `status`/`listingExchanges` to a DOCUMENT_PATH
        //     source, which `trackFieldUpdate` refuses (#862's E-1 guard) —
        //     AFTER `ipoRepository.update` above had already committed,
        //     turning a would-have-succeeded write into a thrown error with
        //     a half-recorded ledger. Fixed by excluding both the caller's
        //     context fields (both spellings, matching the consolidation
        //     door's own #938 handling) and any E-1 field for a document
        //     source BEFORE the write, and by never letting a provenance
        //     write failure propagate past this point — signal-ownership.md
        //     R6: the failure is logged with its cause, not swallowed silently.
        const FALLBACK_BOOKKEEPING_FIELDS = new Set(['lastScrapedAt', 'updatedAt']);
        if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
          const isFallbackNonClaim = fallbackNonClaimTest(source, contextFields);
          const fieldsToTrack = Object.entries(storedFallback)
            .filter(([fieldName, value]) => {
              if (FALLBACK_BOOKKEEPING_FIELDS.has(fieldName)) return false;
              if (value === undefined || value === null) return false;
              if (isFallbackNonClaim(fieldName)) return false;
              const previousValue = (existingIPO as any)?.[fieldName];
              if (valuesEqualForWrite(previousValue, value, fieldName)) return false;
              return true;
            })
            .map(([fieldName, value]) => {
              const previousValue = (existingIPO as any)?.[fieldName];
              return {
                fieldName,
                source,
                confidence: 100,
                previousValue: previousValue !== undefined && previousValue !== null ? String(previousValue) : null,
                // #993: this write's own lineage (method/docType/documentId/sourceSha, ...),
                // the same field the consolidation door passes as `incomingLineage` — dropped
                // entirely by this door before this fix.
                dataLineage: (lineage ?? undefined) as Record<string, unknown> | undefined,
              };
            });

          if (fieldsToTrack.length > 0) {
            try {
              const fieldSourcesRepo = getFieldSourcesRepository();
              await fieldSourcesRepo.bulkTrackFieldUpdates(existingIPO.id, 'ipos', fieldsToTrack);
            } catch (e: any) {
              // The `ipos` row already committed above — a provenance-write
              // failure here must never surface as upsertIPO throwing (that
              // would read as "the write failed" when the write succeeded
              // and only its lineage is incomplete).
              fallbackProvenanceWriteFailed = true;
              logger.error(
                {
                  ipoId: existingIPO.id,
                  source,
                  fields: fieldsToTrack.map((f) => f.fieldName),
                  error: e?.message,
                  cause: e?.cause instanceof Error ? e.cause.message : e?.cause,
                  stack: e?.stack,
                },
                '[DataPersister] #454 fallback-door provenance write failed after the ipos update committed'
              );
            }
          }
        }

        // S-02: the fallback door wrote the row but ran no cross-source
        // consolidation, so F4/F5 are deliberately NOT claimed here — nothing
        // compared sources this time. `fieldSourcesWritten` now reflects
        // whether lineage rows were actually written for THIS write (the
        // ledger must stay honest about what happened on this door, per #454).
        ledgerFacts = {
          source,
          created: false,
          fields: Object.keys(storedFallback),
          offeringType: guardedFallback.offeringType ?? null,
          consolidated: false,
          fieldSourcesWritten: FEATURE_FLAGS.ENABLE_SOURCE_TRACKING && !fallbackProvenanceWriteFailed,
          provenanceLookupFailed: [...provenanceLookupFailed],
          companyName: scrapedIPO.companyName,
        };

        return existingIPO.id;
      } else {
        // Create new IPO
        logger.debug({ slug, source }, `Creating new ${source} IPO`);
        const newIPO = await ipoRepository.create({
          ...ipoData,
          createdAt: new Date()
        } as IPOInsert, { sourceKeys: (scrapedIPO as any).sourceKeys ?? null, boundBy: `scraper:${source}` });

        // P3-11 (T-292): lineage was previously written only on the UPDATE path
        // (inside consolidation, above) — a brand-new row had ZERO field_sources
        // rows, which is exactly why P2-5's Priority Jewels row had no provenance
        // to show it was single-sourced. Track every field this scrape actually
        // supplied, at full confidence, with no prior value (there is no prior row).
        if (FEATURE_FLAGS.ENABLE_SOURCE_TRACKING) {
          const fieldsToTrack = Object.entries(ipoData)
            .filter(([, value]) => value !== undefined && value !== null)
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

  // Prepare peer company data. A peer whose name has no identity
  // (empty/whitespace-only, or pure junk under the shared `rowKeyForName`)
  // is skipped rather than written with an invented key — logged so the
  // skip is countable, never silent. Built OUTSIDE the retry loop: it is
  // pure (depends only on `scrapedPeers`), so re-computing it on a retry
  // would be wasted work, not a correctness issue either way.
  const peerCompanyData = scrapedPeers
    .map((peer) => ({ peer, key: rowKeyForName(peer.companyName) }))
    .filter(({ peer, key }) => {
      if (key === null) {
        logger.warn(
          { ipoId, table: 'peer_companies', name: peer.companyName },
          'skipping peer_companies row: name has no identity (empty/whitespace-only)'
        );
        return false;
      }
      return true;
    })
    .map(({ peer, key }) => ({
      ipoId,
      companyName: peer.companyName,
      // Item 1 slice s1 (row-key prep, F-74): the future row key.
      normalizedName: key as string,
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

  if (peerCompanyData.length === 0) {
    return 0;
  }

  const result = await retryWithBackoff(
    async () => {
      // Item 1 slice s2 fix round (F-1 / GitHub #443): delete-then-insert
      // as ONE transaction via `replaceForIpo`, de-duped by row key inside
      // it, so a retry re-runs one atomic replace rather than a delete
      // that commits on its own followed by an insert that might not.
      const createdPeers = await peerCompanyRepository.replaceForIpo(ipoId, peerCompanyData);

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
  },
  /** The writer's scraper_source label; an admin-owned list records its suggestion under it (#1294 item 3). */
  writer: string = 'DRHP'
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
        }, { writer });

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
        }, { writer });

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
 *    becomes due. The IPO_NO is NOT immutable (F-145): BSE relaunches a
 *    postponed issue under a new number and keeps serving the old one beside
 *    it (Dhanwel 7794 -> 7900, F-144), so last-write-wins made the column flip
 *    with whichever record was read last. OD-85: the column is written ONLY
 *    from the row's ACTIVE BSE_IPO_NO source key; an incoming number that is
 *    not that key is ignored (and logged), and with no ACTIVE key nothing is
 *    written.
 *  - `bsePayloadLeadManagerCount`: how many lead managers the BSE payload
 *    ACTUALLY listed, so the nightly audit can FAIL when fewer were stored.
 *    Refreshed every time, because the payload can gain a co-BRLM.
 *
 * Lives HERE rather than in the document cycle because `scraper-write-path.md`
 * and the R0 write ratchet both require every `ipos` write to go through the
 * shared write path. The first cut of T-403 issued `UPDATE ipos SET ...` as raw
 * SQL from `document-cycle.ts` and `check-write-ratchet.mjs` correctly failed it.
 */
/** OD-85 / F-145: the row's ACTIVE BSE_IPO_NO key as a number, or null (no key, or a repository without a key table). */
export async function activeBseIpoNo(ipoRepository: IPORepository, ipoId: string): Promise<number | null> {
  const getter = (ipoRepository as { sourceKeyDb?: () => unknown }).sourceKeyDb;
  if (typeof getter !== 'function') return null;
  const keys = await findSourceKeysForIpo(getter.call(ipoRepository) as never, ipoId);
  const active = keys.find((k) => k.keyType === 'BSE_IPO_NO' && k.state === 'ACTIVE');
  const n = active ? Number(active.keyValue) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function recordBseDiscoveryMetadata(
  ipoRepository: IPORepository,
  ipoId: string,
  metadata: { bseIpoNo?: number | null; bsePayloadLeadManagerCount?: number | null }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (metadata.bseIpoNo !== undefined && metadata.bseIpoNo !== null) {
    const active = await activeBseIpoNo(ipoRepository, ipoId);
    if (active != null) {
      patch.bseIpoNo = active;
      if (active !== metadata.bseIpoNo) {
        logger.info({ ipoId, incoming: metadata.bseIpoNo, active }, '[OD-85] bse_ipo_no follows the ACTIVE source key, not the record read last');
      }
    }
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
 * Minimal transactional shape `recordDiscoveredLeadManagers` needs — matches
 * the subset of `NodePgDatabase` it calls (`transaction`/`update`/`select`/
 * `insert`), injectable so tests can supply a fake transaction without a
 * live database.
 */
export interface TransactionalIposWriter {
  transaction<T>(fn: (tx: TransactionalIposWriter) => Promise<T>): Promise<T>;
  update: typeof db.update;
  select: typeof db.select;
  insert: typeof db.insert;
  execute: HoldExecutor['execute'];
}

/**
 * Fill `ipos.lead_managers` from names the document-discovery BSE/NSE
 * core-API fetch already parsed, for IPOs the main scrape-cycle write path
 * never populated the field for (T-503 / #416).
 *
 * RCA: `document-discovery-runner.ts` fetches BSE's (and, as a fallback,
 * NSE's) core-API row to find documents and, as a side effect, parses its
 * Book Running Lead Manager / Co-BRLM fields into `result.leadManagers`
 * (`parseBseParties` / `parseNseLeadManagers`) — but `document-cycle.ts`
 * (the only caller) forwarded ONLY the count into `bsePayloadLeadManagerCount`
 * via `recordBseDiscoveryMetadata`; the names themselves were discarded. A
 * BSE payload that listed a real BRLM the main scrape cycle's own BSE/DRHP
 * source never found (or that `sanitizeLeadManagers` filtered out) left
 * `ipos.lead_managers` null forever, while `m_brlm_count` correctly flagged
 * the gap between the recorded payload count and the 0 names ever stored
 * (Steamhouse India, 2026-09-08: payload count 1, stored 0).
 *
 * Round 2 (#417 review): TWO fixes over the first cut.
 *  1. Write-once is now a SQL WHERE guard evaluated by Postgres inside the
 *     UPDATE itself (`lead_managers IS NULL OR jsonb_array_length(...) = 0`),
 *     not a read-then-write check against a cycle-start snapshot — the first
 *     cut's `existing` snapshot could go stale between the read and the
 *     write (TOCTOU): a concurrent scraper cycle's write in that window would
 *     have been silently clobbered.
 *  2. The write now records WHO said so: a `field_sources` provenance row
 *     (source `BSE`/`NSE`, `previousSource` carried through) is upserted in
 *     the SAME transaction as the `ipos` update, mirroring
 *     `FieldSourcesRepository.trackFieldUpdate`'s upsert shape — a hard fact
 *     with no provenance row was the MAJOR finding: nothing else at this call
 *     site records who vouches for `leadManagers`.
 *
 * This discovery fetch has no field-priority-matrix rank of its own, so it
 * must never silently overwrite a value a ranked source (ADMIN/DRHP/NSE/BSE
 * main-scrape/MONEYCONTROL) already wrote — the WHERE guard is what enforces
 * that now, not a pre-check. `sanitizeLeadManagers` is re-applied so this
 * write path enforces the same pollution guard as every other `lead_managers`
 * write (`sanitizeIpoWriteFields`, line ~928 below).
 *
 * Lives HERE, not in `document-cycle.ts`, for the same reason as
 * `recordBseDiscoveryMetadata`: `scraper-write-path.md` and the R0 write
 * ratchet require every `ipos` write to go through the shared write path.
 *
 * #1323: the `.update(iposTable)` call below (and the `.select(...).from(iposTable)` a few
 * lines above it, under the hold branch) go through the `ipos as iposTable` import alias
 * (line ~27) — baselined in `config/write-ratchet-baseline.json` under the `drizzle` pattern.
 * Written reason: this is the shared write path itself (see the header comment above and
 * `scraper-write-path.md`) — the write-once SQL WHERE guard, admin-hold check, and
 * same-transaction provenance row it implements cannot be expressed through
 * `ipoRepository.update()` (T-513/#419), so it writes `ipos` directly under the field-hold
 * and lock discipline documented above, not as a bypass of them.
 *
 * Known gap (MINOR, #417 review): the NSE-sourced arm (BSE unreachable,
 * `document-discovery-runner.ts` falls back to `parseNseLeadManagers`) has no
 * nightly detection — `m_brlm_count` only compares against
 * `bse_payload_lead_manager_count`, which is BSE-only by design (F-2). A
 * follow-up issue tracks a check over rows with an NSE-sourced payload; not
 * built here.
 *
 * T-513 / #419: this function writes `leadManagers` drizzle-direct inside its
 * own transaction (never through `ipoRepository.update()`, which would defeat
 * the SQL WHERE write-once guard above), so it never invalidated the
 * `IPO_DETAIL`/`IPO_LIST` cache — every read served the stale (pre-write)
 * value for up to `CacheTTL.IPO_DETAIL` / `IPO_LIST` (900s). `recordBseDiscoveryMetadata`
 * (above) does not have this bug because it writes via `ipoRepository.update()`,
 * which invalidates. Fix: after the transaction COMMITS (never from inside
 * it — a rolled-back write must not drop a still-valid cache entry), call the
 * repository's `invalidateIpoCache`, matching what `recordBseDiscoveryMetadata`
 * gets for free via `.update()`.
 */
export async function recordDiscoveredLeadManagers(
  ipoRepository: Pick<IPORepository, 'invalidateIpoCache'>,
  ipoId: string,
  names: string[] | null | undefined,
  source: 'BSE' | 'NSE',
  dbLike: TransactionalIposWriter = db as unknown as TransactionalIposWriter
): Promise<{ written: boolean }> {
  const sanitized = sanitizeLeadManagers(names);
  if (!sanitized || sanitized.length === 0) return { written: false };

  let writtenSlug: string | null = null;

  const written = await dbLike.transaction(async (tx) => {
    // §9.2 item 19: an admin who set or cleared leadManagers (OD-121: delete = keep empty) holds it;
    // the empty-array guard below alone would refill it. Re-read under the ipos row lock.
    const { dropped, hold } = await filterPatchUnderHold(tx, ipoId, 'ipos', { leadManagers: sanitized }, { honourScraperLock: true });
    if (dropped.length > 0) {
      // §9.2 items 8, 9 (OD-107): an admin-owned list is kept, and this source's different list is
      // recorded as a suggestion for the admin queue (same as IPORepository.update's lead managers).
      if (hold?.protectedFields.has('leadManagers')) {
        const [cur] = await tx.select({ lm: iposTable.leadManagers }).from(iposTable).where(eqOp(iposTable.id, ipoId));
        await recordListSuggestion(tx as never, {
          ipoId,
          list: 'lead_managers',
          source,
          stored: (Array.isArray(cur?.lm) ? (cur.lm as unknown[]) : []).map((name) => ({ name })),
          incoming: sanitized.map((name) => ({ name })),
        });
      }
      return false;
    }
    const updated = await tx
      .update(iposTable)
      .set({ leadManagers: sanitized, updatedAt: new Date() })
      .where(
        andOp(
          eqOp(iposTable.id, ipoId),
          orOp(isNullOp(iposTable.leadManagers), sqlOp`jsonb_array_length(${iposTable.leadManagers}) = 0`)
        )
      )
      .returning({ id: iposTable.id, slug: iposTable.slug });

    if (updated.length === 0) return false;
    writtenSlug = updated[0]?.slug ?? null;

    const previous = await tx
      .select({ source: fieldSourcesTable.source })
      .from(fieldSourcesTable)
      .where(
        andOp(
          eqOp(fieldSourcesTable.ipoId, ipoId),
          eqOp(fieldSourcesTable.tableName, 'ipos'),
          // #1074: rowKey defaults to '' for every row-scoped field_sources write (matching
          // unique_field_source_per_ipo below) — filtered explicitly so this lookup can never
          // match a future row-keyed provenance row for the same (ipo, table, field).
          eqOp(fieldSourcesTable.rowKey, ''),
          eqOp(fieldSourcesTable.fieldName, 'leadManagers')
        )
      )
      .limit(1);

    // OD-85: the binding key ids when this record came through a key bind, else null as before.
    const sourceKeyLineage = sourceKeyLineageFor(ipoId) ?? null;
    const sourceKeyLineageJson = sourceKeyLineage === null ? null : JSON.stringify(sourceKeyLineage);

    const provenanceRow = {
      source: source as never,
      confidence: 100,
      previousValue: null,
      previousSource: (previous[0]?.source ?? null) as never,
      dataLineage: sourceKeyLineage as never,
      updatedAt: new Date(),
      updatedBy: 'SYSTEM',
    };

    await tx
      .insert(fieldSourcesTable)
      .values({ ipoId, tableName: 'ipos', rowKey: '', fieldName: 'leadManagers', ...provenanceRow })
      .onConflictDoUpdate({
        // #1074: the only unique index on field_sources is unique_field_source_per_ipo on
        // (ipo_id, table_name, row_key, field_name) — a 3-column target here (missing rowKey)
        // has no matching arbiter index, so Postgres raises 42P10 on every write and the whole
        // transaction (including the ipos.lead_managers update above) rolls back. Same class as
        // ipo-repository.ts's merge-duplicate-ipo fix and corrigendum-suggestions.ts.
        target: [
          fieldSourcesTable.ipoId,
          fieldSourcesTable.tableName,
          fieldSourcesTable.rowKey,
          fieldSourcesTable.fieldName,
        ],
        set: {
          ...provenanceRow,
          // #1072 round 2 (same class as #755/#753/#1065/#1068): a plain object here REPLACES
          // the whole jsonb column on conflict, destroying whatever docType/other keys an
          // earlier write on this SAME (ipo, table, row) had set. Same coalesce-and-concat merge
          // as field-sources-repository.ts's fix, made null-safe: when THIS write carries no
          // source-key lineage (sourceKeyLineage === null), keep the existing column value
          // rather than overwriting it with NULL.
          dataLineage:
            sourceKeyLineageJson === null
              ? sqlOp`${fieldSourcesTable.dataLineage}`
              : sqlOp`COALESCE(${fieldSourcesTable.dataLineage}, '{}'::jsonb) || ${sourceKeyLineageJson}::jsonb`,
        },
      });

    return true;
  });

  if (written) {
    logger.debug({ ipoId, leadManagerCount: sanitized.length, source }, 'Recorded discovered lead managers');

    // T-513 / #419: invalidate AFTER the transaction above has committed —
    // never move this inside it, or a rolled-back write would drop a
    // still-valid cache entry. The write itself is already durable at this
    // point; a cache-layer failure here must never be reported as a failed
    // write. `invalidateIpoCache` already swallows Redis errors internally,
    // but a defensive try/catch keeps that contract even if the repository
    // implementation changes.
    if (writtenSlug) {
      try {
        await ipoRepository.invalidateIpoCache(ipoId, writtenSlug);
      } catch (error) {
        logger.warn(
          { ipoId, error: error instanceof Error ? error.message : String(error) },
          'Failed to invalidate IPO cache after recording discovered lead managers (write already committed, non-fatal)'
        );
      }
    }
  }
  return { written };
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
