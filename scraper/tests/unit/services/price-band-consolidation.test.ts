/**
 * T-276 — price-band min-collapse: consolidation mechanism.
 *
 * Round-2 review P1-1: 223/271 IPO rows carry `price_range_min = price_range_max`
 * and the system never self-corrects. Production logged the mechanism itself:
 *
 *   sunshine-pictures-ltd | priceRangeMin | NSE 360 vs NSE 342
 *                         | resolved_source NSE | reason DEFAULT_KEEP_EXISTING
 *
 * NSE published a corrected band, the scraper read it every 30 minutes, and
 * `resolveConflict` threw the correction away because the two values came from
 * the SAME source and the field is not `timeBased`. Once a wrong floor lands it
 * is permanent.
 *
 * The fix is matrix-driven and bounded: `sameSourceRefresh: true` on the
 * price-band fields lets a NEWER value from the SAME source win, but only when
 * the matrix lists that source as authoritative for the field. Paired with a
 * record-level no-narrowing guard so a degenerate (min == max) incoming band can
 * never overwrite a stored real range.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    MAX_CONFLICTS_PER_IPO: 50,
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
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

const OLD = new Date('2026-08-20T14:42:00Z');
const NEW = new Date('2026-08-22T13:00:00Z');

/** Build the `field_sources` rows the service reads for an existing band. */
function existingBand(min: number, max: number, source = 'NSE', updatedAt = OLD) {
  return [
    { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMin', source, value: String(min), confidence: 95, updatedAt },
    { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'priceRangeMax', source, value: String(max), confidence: 95, updatedAt },
  ];
}

function finalOf(result: any, fieldName: string) {
  return result.fieldResults.find((f: any) => f.fieldName === fieldName)?.finalValue;
}

describe('T-276 price-band consolidation', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('lets a NEWER value from the SAME source correct a wrong price-band floor (sunshine-pictures replay)', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue(existingBand(360, 400));

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 342, priceRangeMax: 400 },
      source: 'NSE',
      existingData: { priceRangeMin: 360, priceRangeMax: 400 },
      scrapedAt: NEW,
    });

    expect(finalOf(result, 'priceRangeMin')).toBe(342);
  });

  it('does NOT let an OLDER value from the same source overwrite a newer stored band', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue(existingBand(342, 400, 'NSE', NEW));

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 360, priceRangeMax: 400 },
      source: 'NSE',
      existingData: { priceRangeMin: 342, priceRangeMax: 400 },
      scrapedAt: OLD,
    });

    expect(finalOf(result, 'priceRangeMin')).toBe(342);
  });

  it('rejects a DEGENERATE incoming band (min == max) over a stored real range (tempsens replay)', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue(existingBand(285, 300));

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      source: 'NSE',
      existingData: { priceRangeMin: 285, priceRangeMax: 300 },
      scrapedAt: NEW,
    });

    expect(finalOf(result, 'priceRangeMin')).toBe(285);
    expect(finalOf(result, 'priceRangeMax')).toBe(300);
  });

  it('still accepts a degenerate band when no real range is stored yet (fixed-price issues)', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 300, priceRangeMax: 300 },
      source: 'NSE',
      existingData: {},
      scrapedAt: NEW,
    });

    expect(finalOf(result, 'priceRangeMin')).toBe(300);
    expect(finalOf(result, 'priceRangeMax')).toBe(300);
  });

  it('is BOUNDED: a same-source conflict on a field without sameSourceRefresh still keeps existing', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue([
      { ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'faceValue', source: 'NSE', value: '10', confidence: 95, updatedAt: OLD },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { faceValue: 5 },
      source: 'NSE',
      existingData: { faceValue: 10 },
      scrapedAt: NEW,
    });

    expect(finalOf(result, 'faceValue')).toBe(10);
  });

  it('is BOUNDED: a same-source refresh from a source the matrix does NOT list keeps existing', async () => {
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue(existingBand(360, 400, 'CHITTORGARH'));

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMin: 342, priceRangeMax: 400 },
      source: 'CHITTORGARH',
      existingData: { priceRangeMin: 360, priceRangeMax: 400 },
      scrapedAt: NEW,
    });

    expect(finalOf(result, 'priceRangeMin')).toBe(360);
  });
});
