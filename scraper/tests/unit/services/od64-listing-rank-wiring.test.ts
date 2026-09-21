/**
 * OD-64 — the WIRING test: does the consolidator actually pass the row's
 * listing venue into the priority lookup?
 *
 * The unit tests on `getSourcePriority` prove the RULE. This proves the WIRE.
 * A venue-aware rule the consolidator never hands a venue to is dead code that
 * passes its own tests — the exact shape found the same night in item 17,
 * whose job was correct while its ORDER BY pointed at the wrong rows: unit
 * tests green, the thing doing nothing useful.
 *
 * Scenario: a BSE-only IPO whose `status` is stored from BSE. NSE arrives with
 * a different status. Under OD-64 NSE has no standing on an issue it does not
 * list, so the stored BSE value must hold.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
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

function row(fieldName: string, source: string, value: unknown) {
  return {
    ipoId: 'ipo-1', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

describe('OD-64 wiring: the consolidator ranks against the row listing venue', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      row('priceRangeMax', 'BSE', 100),
    ]);
  });

  // priceRangeMax rather than status: `status` is timeBased, which bypasses
  // priority entirely (isTimeBased -> newest wins), so it would prove nothing
  // about the venue wiring. The band IS priority-resolved.
  const write = (listingExchanges: string[] | null) =>
    service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { priceRangeMax: 200 },
      source: 'NSE',
      existingData: { priceRangeMax: 100, listingExchanges } as any,
    } as any);

  const band = (r: any) => r.fieldResults.find((f: any) => f.fieldName === 'priceRangeMax');

  it('refuses an NSE price band on a BSE-only IPO', async () => {
    expect(band(await write(['BSE'])).finalValue).toBe(100);
  });

  it('accepts an NSE price band when the IPO is listed on BOTH', async () => {
    expect(band(await write(['NSE', 'BSE'])).finalValue).toBe(200);
  });

  it('accepts an NSE price band when the venue is unknown (unchanged default)', async () => {
    expect(band(await write(null)).finalValue).toBe(200);
  });
});
