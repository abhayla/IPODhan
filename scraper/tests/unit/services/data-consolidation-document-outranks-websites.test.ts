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
import {
  getSourcePriority,
  allowsSameSourceRefresh,
  incomingDocumentOutranksStored,
} from '../../../src/config/field-priority-matrix.js';
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

/**
 * T-520 round 2 (MAJOR 1 + MAJOR 2): now that the document outranks every
 * website, a WRONG document value would be permanently uncorrectable unless a
 * newer document can replace it — and the replacement must be ordered by
 * document TYPE, because all four document types arrive as source `DRHP`.
 */
describe('T-520 round 2: a document can correct a document, a website still cannot', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A tracked row that also records which document wrote it. */
  function trackedDoc(fieldName: string, value: string, docType: string, updatedAt: Date) {
    return { ...tracked(fieldName, value), dataLineage: { docType }, updatedAt, createdAt: updatedAt };
  }

  const REFRESHABLE = [
    { field: 'lotSize', wrong: 1200, right: 1600 },
    { field: 'min_investment', wrong: 126000, right: 168000 },
    { field: 'issue_price', wrong: 105, right: 112 },
    { field: 'fresh_issue_size', wrong: 5000000000, right: 6000000000 },
    { field: 'offer_for_sale_size', wrong: 2000000000, right: 2500000000 },
    { field: 'priceRangeMin', wrong: 100, right: 106 },
    { field: 'priceRangeMax', wrong: 105, right: 112 },
  ];

  it.each(REFRESHABLE)(
    'a NEWER document write corrects an older mis-read document $field',
    async ({ field, wrong, right }) => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        trackedDoc(field, String(wrong), 'RHP', new Date('2026-09-01T00:00:00Z')),
      ] as never);

      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: { [field]: right },
        source: 'DRHP',
        docType: 'PRICE_BAND_AD',
        confidence: 100,
        scrapedAt: new Date('2026-09-05T00:00:00Z'),
      });

      expect(Number(result.consolidatedData[field])).toBe(right);
    }
  );

  it.each(REFRESHABLE)(
    'a website value still loses to the stored document $field (self-refresh is DRHP-only)',
    async ({ field, wrong, right }) => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        trackedDoc(field, String(wrong), 'RHP', new Date('2026-09-01T00:00:00Z')),
      ] as never);

      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: { [field]: right },
        source: 'NSE',
        confidence: 90,
        scrapedAt: new Date('2026-09-05T00:00:00Z'),
      });

      expect(Number(result.consolidatedData[field])).toBe(wrong);
      expect(allowsSameSourceRefresh(field, 'NSE')).toBe(field === 'priceRangeMin' || field === 'priceRangeMax');
      expect(allowsSameSourceRefresh(field, 'MONEYCONTROL')).toBe(false);
      expect(allowsSameSourceRefresh(field, 'DRHP')).toBe(true);
    }
  );

  it('the registrar and companyName documents self-refresh too, but no website may', () => {
    for (const field of ['registrar', 'companyName']) {
      expect(allowsSameSourceRefresh(field, 'DRHP')).toBe(true);
      for (const website of ['NSE', 'BSE', 'MONEYCONTROL'] as const) {
        expect(allowsSameSourceRefresh(field, website)).toBe(false);
      }
    }
  });

  it('a re-extraction of an OLD RHP does NOT overwrite a price-band advertisement band, even though it is written later', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      trackedDoc('priceRangeMax', '112', 'PRICE_BAND_AD', new Date('2026-09-02T00:00:00Z')),
    ] as never);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { priceRangeMax: 105 }, // the stale band printed in the RHP
      source: 'DRHP',
      docType: 'RHP',
      confidence: 100,
      scrapedAt: new Date('2026-09-06T00:00:00Z'), // written LATER
    });

    expect(Number(result.consolidatedData.priceRangeMax)).toBe(112);
  });

  it('document-type ranking: the ad and a corrigendum outrank the RHP, which outranks the prospectus, which outranks the DRHP', () => {
    expect(incomingDocumentOutranksStored('RHP', 'PRICE_BAND_AD')).toBe(true);
    expect(incomingDocumentOutranksStored('RHP', 'CORRIGENDUM')).toBe(true);
    expect(incomingDocumentOutranksStored('PRICE_BAND_AD', 'RHP')).toBe(false);
    expect(incomingDocumentOutranksStored('PROSPECTUS', 'RHP')).toBe(true);
    expect(incomingDocumentOutranksStored('DRHP', 'PROSPECTUS')).toBe(true);
    expect(incomingDocumentOutranksStored('PROSPECTUS', 'DRHP')).toBe(false);
    // Equal authority, or an unknown/absent type: the caller falls back to
    // newest-write-wins rather than inventing an order.
    expect(incomingDocumentOutranksStored('RHP', 'RHP')).toBe(null);
    expect(incomingDocumentOutranksStored(null, 'RHP')).toBe(null);
    expect(incomingDocumentOutranksStored('RHP', 'SOMETHING_NEW')).toBe(null);
  });
});
