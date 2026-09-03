/**
 * S-02 §5 no-op write suppression: `valueActuallyChanged` used to compare
 * `fieldResult.finalValue` (a JS number/string from the scraper) to
 * `existingValueFromMap.value` (whatever came back from Postgres — a NUMERIC
 * column round-trips as a STRING) with a raw `!==`, so an unchanged numeric
 * field counted as "updated" on every re-scrape. The fix reuses the same
 * normalize+areEquivalent pair `provenanceUnchanged` already uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
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

describe('S-02 §5: no-op write suppression (valueActuallyChanged normalized comparison)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a pg NUMERIC string "6800000000.00" vs incoming number 6800000000 from the SAME top source is NOT a change', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'revenue_fy1',
        source: 'NSE',
        value: '6800000000.00', // as it round-trips from a pg NUMERIC column
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { revenue_fy1: 6800000000 },
      source: 'NSE',
      confidence: 90,
    });

    expect(result.fieldsUpdated).toBe(0);
  });

  it('a genuinely different value from a HIGHER-priority source IS still reported as a change (not masked by the normalization fix)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'revenue_fy1',
        source: 'MONEYCONTROL', // lower priority than DRHP/NSE in revenue_fy1's matrix entry
        value: '6800000000.00',
        confidence: 70,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { revenue_fy1: 7100000000 },
      source: 'DRHP',
      confidence: 90,
    });

    expect(result.fieldsUpdated).toBe(1);
  });

  it('a brand-new field with no prior provenance row IS reported as a change (insert, not a no-op)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'test-ipo',
      tableName: 'ipos',
      incomingData: { revenue_fy1: 6800000000 },
      source: 'NSE',
      confidence: 90,
    });

    expect(result.fieldsUpdated).toBe(1);
  });
});
