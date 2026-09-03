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

// F-1 sweep: same enumerated-mock hazard — spread the real module first.
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

  it('M-1: an untracked stored value is not replaced by a source the matrix does not rank', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { registrar: 'Skyline Financial Services Private Limited' },
      source: 'API_FALLBACK',
      existingData: { registrar: 'Bigshare Services Pvt Ltd' } as any,
    });

    expect(result.consolidatedData.registrar).toBe('Bigshare Services Pvt Ltd');
    expect(trackCallFor('registrar')).toHaveLength(0);
  });

  it('M-1: a better-ranked source DOES replace an untracked stored value, recording it with an unknown previous source', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { registrar: 'Skyline Financial Services Private Limited' },
      source: 'NSE',
      existingData: { registrar: 'Bigshare Services Pvt Ltd' } as any,
    });

    expect(result.consolidatedData.registrar).toBe('Skyline Financial Services Private Limited');
    const track = trackCallFor('registrar')[0];
    expect(track.previousValue).toBe('Bigshare Services Pvt Ltd');
    expect(track.previousSource).toBeUndefined();
  });

  it('m-1: a stored falsy value (0) is a value, not an absence, for the untracked gate too', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'API_FALLBACK',
      existingData: { faceValue: 0 } as any,
    });

    expect(result.consolidatedData.faceValue).toBe(0);
    expect(trackCallFor('faceValue')).toHaveLength(0);
  });

  it('M-1 does not pre-empt the set merge: an UNTRACKED exchange list still merges', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { listingExchanges: ['NSE'] },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'] } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    expect(mockConflictsRepo.upsertConflict).not.toHaveBeenCalled();
  });

  it('F-2: an untracked NON-set array goes through priority resolution, not a blind Case 1 accept', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { leadManagers: ['Nuvama Wealth Management Limited'] },
      source: 'NSE',
      existingData: { leadManagers: ['Anand Rathi', 'IIFL'] } as any,
    });

    expect(result.consolidatedData.leadManagers).toEqual(['Nuvama Wealth Management Limited']);
    const track = trackCallFor('leadManagers')[0];
    expect(track).toBeDefined();
    expect(track.previousValue).toBe('["Anand Rathi","IIFL"]');
  });

  it('F-3: a non-set array can SHRINK when a higher-ranked source reports a corrected list', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('leadManagers', 'CHITTORGARH', ['A Capital', 'B Securities', 'C Artefact']),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { leadManagers: ['A Capital', 'B Securities'] },
      source: 'NSE',
      existingData: { leadManagers: ['A Capital', 'B Securities', 'C Artefact'] } as any,
    });

    expect(result.consolidatedData.leadManagers).toEqual(['A Capital', 'B Securities']);
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledTimes(1);
    const conflict = vi.mocked(mockConflictsRepo.upsertConflict).mock.calls[0][0] as any;
    expect(conflict.fieldName).toBe('leadManagers');
  });

  it('W-24: a LOSING incoming write leaves the provenance row untouched', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      { ...fieldSourceRow('faceValue', 'NSE', 10), previousValue: '2', previousSource: 'BSE' },
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { faceValue: 2 },
      source: 'BSE',
      existingData: { faceValue: 10 } as any,
    });

    expect(result.consolidatedData.faceValue).toBe(10);
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledTimes(1);
    expect(trackCallFor('faceValue')).toHaveLength(0);
  });

  it('W-25: a source confirming an untracked value creates the provenance row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { registrar: 'Bigshare Services Pvt Ltd' },
      source: 'BSE',
      existingData: { registrar: 'Bigshare Services Pvt Ltd' } as any,
    });

    expect(result.consolidatedData.registrar).toBe('Bigshare Services Pvt Ltd');
    const track = trackCallFor('registrar')[0];
    expect(track).toBeDefined();
    expect(track.source).toBe('BSE');
    expect(track.previousValue).toBeUndefined();
    expect(track.previousSource).toBeUndefined();
  });

  it('W-25 round 4: a confirming source gives an untracked SET-valued list its provenance row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { listingExchanges: ['BSE'] },
      source: 'BSE',
      existingData: { listingExchanges: ['BSE', 'NSE'] } as any,
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    const track = trackCallFor('listingExchanges')[0];
    expect(track).toBeDefined();
    expect(track.source).toBe('BSE');
    expect(track.value).toEqual(['BSE', 'NSE']);
    expect(track.previousValue).toBeUndefined();
    expect(track.previousSource).toBeUndefined();
  });

  it('W-25 round 4: a confirming source gives an untracked NON-set list its provenance row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { leadManagers: [...LEAD_MANAGERS] },
      source: 'BSE',
      existingData: { leadManagers: LEAD_MANAGERS } as any,
    });

    expect(result.consolidatedData.leadManagers).toEqual(LEAD_MANAGERS);
    const track = trackCallFor('leadManagers')[0];
    expect(track).toBeDefined();
    expect(track.source).toBe('BSE');
    expect(track.previousValue).toBeUndefined();
  });
});
