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

/**
 * T-309 (T-305 round-6 P3) — the dominant root cause of the non-converging
 * conflict churn (~1,300 conflicts/cycle, ~62k/day per the review).
 *
 * Read-only probe against prod `data_conflicts` (2026-08-24) sampled the
 * actual stored rows and found the majority of open symbol/faceValue/
 * allotmentDate conflicts have `value2 = null` — one source simply has NO
 * value for the field (e.g. chittorgarh-orchestrator-v2.ts unconditionally
 * emits `symbol: ipo.symbol`, `undefined` for every IPO Chittorgarh doesn't
 * carry a symbol for), yet consolidateField() compared that missing value
 * against the other source's real value and logged a genuine disagreement,
 * every 30-min cycle, forever — a field-less source can never produce a
 * non-null value, so the "conflict" could never converge.
 *
 * These tests reproduce the exact prod shapes (source names + value pairs
 * pulled directly from the sampled rows) through the real service.
 */
describe('DataConsolidationService — missing incoming value is not a conflict (T-309)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prod shape: NSE symbol="SUNSHINE" (existing) vs Chittorgarh symbol=undefined (incoming) — no conflict logged', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'ipo-1', tableName: 'ipos', fieldName: 'symbol', source: 'NSE',
        value: 'SUNSHINE', confidence: 95, dataLineage: null, previousValue: null,
        previousSource: null, updatedAt: new Date(), createdAt: new Date(),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { symbol: undefined },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    expect(result.conflictsDetected).toBe(0);
    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
    const fieldResult = result.fieldResults.find(f => f.fieldName === 'symbol');
    expect(fieldResult?.hadConflict).toBe(false);
    expect(fieldResult?.finalValue).toBe('SUNSHINE'); // existing value preserved
  });

  it('prod shape: faceValue=10 (existing, NSE) vs Chittorgarh faceValue=null (incoming) — no conflict logged', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'ipo-2', tableName: 'ipos', fieldName: 'faceValue', source: 'NSE',
        value: 10, confidence: 95, dataLineage: null, previousValue: null,
        previousSource: null, updatedAt: new Date(), createdAt: new Date(),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-2',
      tableName: 'ipos',
      incomingData: { faceValue: null },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    expect(result.conflictsDetected).toBe(0);
    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
  });

  it('a genuine two-real-value disagreement STILL conflicts (this fix must not mask real conflicts)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'ipo-3', tableName: 'ipos', fieldName: 'symbol', source: 'NSE',
        value: 'ABC', confidence: 95, dataLineage: null, previousValue: null,
        previousSource: null, updatedAt: new Date(0), createdAt: new Date(0),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-3',
      tableName: 'ipos',
      incomingData: { symbol: 'XYZ' },
      source: 'BSE',
      confidence: 80,
      scrapedAt: new Date(),
    });

    expect(result.conflictsDetected).toBe(1);
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalled();
  });
});
