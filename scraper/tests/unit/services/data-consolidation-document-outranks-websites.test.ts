/**
 * T-520 - the offer document outranks EVERY website for the fields it prints.
 *
 * RCA: `scraper/src/config/field-priority-matrix.ts` listed DRHP (the enum slot
 * every offer document maps to - `filing-persister.ts:378 scraperSourceForDocType`)
 * BELOW NSE/BSE/MONEYCONTROL for the printed offer terms (price band, lot size,
 * minimum investment, issue price, fresh/OFS split, registrar, company name), so
 * `resolveConflict`'s SOURCE_PRIORITY branch republished a website's transcription
 * over the filing itself.
 *
 * These tests drive the REAL resolver (`DataConsolidationService.consolidateIPOData`),
 * not `getSourcePriority` alone: a website value arriving AFTER a tracked document
 * value must be rejected and recorded as a conflict, never silently applied.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import { getSourcePriority } from '../../../src/config/field-priority-matrix.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 100,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

/** One tracked `field_sources` row, as the repository returns it. */
function tracked(fieldName: string, value: string, source = 'DRHP') {
  return {
    ipoId: 'test-ipo',
    tableName: 'ipos',
    fieldName,
    source,
    value,
    confidence: 95,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
}

/**
 * Every field the offer document PRINTS whose matrix entry T-520 re-ranked, with
 * the document value and the (wrong) website value a real cycle supplied.
 */
const PRINTED_OFFER_TERMS: Array<{ field: string; docValue: number; webValue: number }> = [
  { field: 'priceRangeMin', docValue: 100, webValue: 90 },
  { field: 'priceRangeMax', docValue: 105, webValue: 95 },
  { field: 'lotSize', docValue: 1200, webValue: 1400 },
  { field: 'min_investment', docValue: 126000, webValue: 133000 },
  { field: 'issue_price', docValue: 105, webValue: 95 },
  { field: 'fresh_issue_size', docValue: 5000000000, webValue: 3000000000 },
  { field: 'offer_for_sale_size', docValue: 2000000000, webValue: 1000000000 },
];

/** Re-ranked fields whose values are strings, not numbers. */
const PRINTED_TEXT_TERMS = ['registrar', 'companyName'];

describe('T-520: a website value arriving after a document value is REJECTED, not applied', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(PRINTED_OFFER_TERMS)(
    'keeps the DRHP-sourced $field when NSE later reports a different value',
    async ({ field, docValue, webValue }) => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        tracked(field, String(docValue)),
      ] as never);

      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: { [field]: webValue },
        source: 'NSE',
        confidence: 90,
      });

      expect(Number(result.consolidatedData[field])).toBe(docValue);
    }
  );

  it.each(['BSE', 'MONEYCONTROL'] as const)(
    'keeps the DRHP-sourced lotSize when %s later reports a different lot',
    async (websiteSource) => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        tracked('lotSize', '1200'),
      ] as never);

      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: { lotSize: 1400 },
        source: websiteSource,
        confidence: 90,
      });

      expect(Number(result.consolidatedData.lotSize)).toBe(1200);
    }
  );

  it('keeps the DRHP-sourced registrar when NSE later reports a different one', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      tracked('registrar', 'KFin Technologies Limited'),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { registrar: 'Link Intime India Pvt Ltd' },
      source: 'NSE',
      confidence: 90,
    });

    expect(result.consolidatedData.registrar).toBe('KFin Technologies Limited');
  });

  it('LOGS the rejection as a conflict rather than dropping it silently', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      tracked('priceRangeMin', '100'),
    ] as never);

    await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 90 },
      source: 'NSE',
      confidence: 90,
    });

    const calls = vi.mocked(mockConflictsRepo.upsertConflict).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0][0] as unknown as Record<string, unknown>;
    expect(call.fieldName).toBe('priceRangeMin');
    expect(call.resolvedSource).toBe('DRHP');
  });

  it('an ADMIN override still beats the document on every re-ranked field', () => {
    for (const field of [...PRINTED_OFFER_TERMS.map((f) => f.field), ...PRINTED_TEXT_TERMS]) {
      expect(getSourcePriority(field, 'ADMIN')).toBeLessThan(getSourcePriority(field, 'DRHP'));
    }
  });

  it('ranks DRHP above every website source on every re-ranked field', () => {
    for (const field of [...PRINTED_OFFER_TERMS.map((f) => f.field), ...PRINTED_TEXT_TERMS]) {
      const drhp = getSourcePriority(field, 'DRHP');
      expect(drhp).toBeGreaterThanOrEqual(0);
      for (const website of ['NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'] as const) {
        const rank = getSourcePriority(field, website);
        if (rank >= 0) expect(drhp).toBeLessThan(rank);
      }
    }
  });

  it('leaves the fields no offer document contains untouched (websites still win)', () => {
    // Live subscription, GMP, listing price/gain and current status are NOT in
    // any filing - the exchanges and the GMP feeds remain authoritative.
    for (const field of [
      'total_subscription',
      'retail_subscription',
      'qib_subscription',
      'nii_subscription',
      'gmp_price',
      'expected_listing_price',
      'listing_price',
      'listing_gain_percentage',
      'status',
    ]) {
      expect(getSourcePriority(field, 'DRHP')).toBe(-1);
    }
  });

  it('keeps the W-117 timeline rule: the exchanges still outrank the printed ad on open/close/allotment/listing dates', () => {
    for (const field of ['openDate', 'closeDate', 'allotmentDate', 'listingDate']) {
      const drhp = getSourcePriority(field, 'DRHP');
      expect(drhp).toBeGreaterThanOrEqual(0);
      expect(getSourcePriority(field, 'NSE')).toBeLessThan(drhp);
      expect(getSourcePriority(field, 'BSE')).toBeLessThan(drhp);
    }
  });
});
