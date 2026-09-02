/**
 * W-16b / W-17 / W-18 — Deepa Jewellers per-IPO walk (2026-09-02).
 *
 * Live shapes observed on ipodhan_test with production flags:
 *  - an NSE update with `leadManagers` undefined nulled a stored value whenever
 *    the field had NO `field_sources` row (rows written before source tracking
 *    existed have none, so this is live in prod);
 *  - `data_conflicts` rows were written for identical arrays and for a
 *    listingExchanges merge, while a real faceValue disagreement carried no
 *    previous_value/previous_source history.
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

const LEAD_MANAGERS = [
  'Emkay Global Financial Services Limited',
  'Valmiki Leela Capital Private Limited',
];

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: 'deepa', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

function trackCallFor(fieldName: string) {
  return vi
    .mocked(mockFieldSourcesRepo.trackFieldUpdate)
    .mock.calls.map((c) => c[0] as any)
    .filter((p) => p.fieldName === fieldName);
}

describe('consolidation write-path guards (Deepa walk)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('W-16b: an undefined incoming value never nulls a stored value that has NO field_sources row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { leadManagers: undefined, faceValue: 2 },
      source: 'NSE',
      existingData: { leadManagers: LEAD_MANAGERS, faceValue: 2 } as any,
    });

    const lead = result.fieldResults.find((f) => f.fieldName === 'leadManagers');
    expect(lead?.finalValue).toEqual(LEAD_MANAGERS);
    expect(result.consolidatedData.leadManagers).toEqual(LEAD_MANAGERS);
    expect(trackCallFor('leadManagers')).toHaveLength(0);
  });

  it('W-16b: a null incoming value never nulls a stored value that has NO field_sources row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { registrar: null },
      source: 'NSE',
      existingData: { registrar: 'Bigshare Services Pvt Ltd' } as any,
    });

    expect(result.consolidatedData.registrar).toBe('Bigshare Services Pvt Ltd');
  });

  it('W-18(ii): identical arrays from two sources are not a conflict', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('leadManagers', 'BSE', LEAD_MANAGERS),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { leadManagers: [...LEAD_MANAGERS] },
      source: 'NSE',
      existingData: { leadManagers: LEAD_MANAGERS } as any,
    });

    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
    expect(result.conflictsDetected).toBe(0);
    expect(result.consolidatedData.leadManagers).toEqual(LEAD_MANAGERS);
  });

  it('W-18(ii): a set-valued merge (incoming subset) is not a conflict and keeps the union', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE', 'NSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { listingExchanges: ['NSE'] },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE', 'NSE'] } as any,
    });

    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
  });

  it('W-17/W-18(ii): a set-valued merge that ADDS a member keeps the prior source and records history', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('listingExchanges', 'BSE', ['BSE']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { listingExchanges: ['NSE'] },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'] } as any,
    });

    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    const track = trackCallFor('listingExchanges')[0];
    expect(track).toBeDefined();
    expect(track.source).toBe('BSE');
    expect(track.previousValue).toBe('["BSE"]');
    expect(track.previousSource).toBe('BSE');
  });

  it('W-18(i)/W-17: a real faceValue disagreement writes ONE conflict row and records previous value+source', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('faceValue', 'BSE', 2),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'NSE',
      existingData: { faceValue: 2 } as any,
    });

    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledTimes(1);
    const conflict = vi.mocked(mockConflictsRepo.upsertConflict).mock.calls[0][0] as any;
    expect(conflict.fieldName).toBe('faceValue');
    expect(conflict.severity).toBe('CRITICAL');
    expect(result.fieldResults.find((f) => f.fieldName === 'faceValue')?.hadConflict).toBe(true);

    const track = trackCallFor('faceValue')[0];
    expect(track.previousValue).toBe('2');
    expect(track.previousSource).toBe('BSE');
  });
});
