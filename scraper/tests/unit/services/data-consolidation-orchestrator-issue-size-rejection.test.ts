/**
 * W-177 round 2 (CRITICAL-1) — the consolidation orchestrator is the door
 * `BaseScraperOrchestrator` actually writes through in prod
 * (ENABLE_DATA_CONSOLIDATION on); `upsertIPO`'s round-1 create/legacy-fallback
 * guard is never reached on that path. `DataConsolidationOrchestrator
 * .extractConsolidatedData()` built the write payload as
 * `consolidated.issueSize?.toString() ?? originalScraped.issueSize?.toString()`
 * — when the T-329 plausibility guard REJECTED the incoming issueSize (no
 * stored value to fall back to, e.g. a brand-new SME row), `consolidated
 * .issueSize` was `undefined` and the `??` silently re-admitted the raw,
 * rejected share count from `originalScraped`. Shanti Inorganics
 * (CHITTORGARH, SME, issueSize 5,691,200, band 79-83) walked straight
 * through this door.
 *
 * Fix: `extractConsolidatedData` now builds a `rejectedFields` set from
 * `result.fieldResults[].rejectedSources` (any entry naming the incoming
 * `source`) and never falls back to `originalScraped` for a field in that
 * set. These tests exercise the REAL `DataConsolidationService
 * .consolidateIPOData()` (only the two repositories are mocked) so the
 * rejection shape under test is the actual one the guard produces, then feed
 * the real result into the orchestrator's `extractConsolidatedData` (private
 * — accessed via `as any`, same pattern as
 * data-consolidation-orchestrator-face-value.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: false,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 0,
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
  resolveConflict: vi.fn(),
  countUnresolved: vi.fn(),
} as unknown as DataConflictsRepository;

function makeOrchestrator() {
  // fieldSourcesRepository/dataConflictsRepository/redis are only used by
  // consolidatedUpsertIPO's DB-touching machinery, not by
  // extractConsolidatedData under test here.
  return new DataConsolidationOrchestrator({} as any, {} as any, {} as any, null);
}

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: 'shanti-id',
    tableName: 'ipos',
    fieldName,
    source,
    value,
    confidence: 90,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt: new Date('2026-08-31T00:00:00Z'),
    createdAt: new Date('2026-08-31T00:00:00Z'),
  };
}

/** Shanti Inorganics' exact incoming shape (round 1 test fixture). */
function shantiIncoming(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Shanti Inorganics Ltd.',
    issueSize: 5_691_200, // the SHARE COUNT sitting in the rupee field
    priceRangeMin: 79,
    priceRangeMax: 83,
    segment: 'SME',
    offeringType: 'IPO',
    status: 'OPEN',
    ...overrides,
  };
}

describe('W-177 round 2 — DataConsolidationOrchestrator.extractConsolidatedData never re-admits a rejected issueSize', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({ id: 'row' } as any);
    vi.mocked(mockConflictsRepo.logConflict).mockResolvedValue({} as any);
  });

  it('(1) NEW row: a segment-floor-rejected issueSize (no stored value) writes undefined, not the raw share count', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'new',
      tableName: 'ipos',
      incomingData: shantiIncoming(),
      source: 'CHITTORGARH',
    });

    const issueSizeField = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(issueSizeField!.finalValue).toBeUndefined();
    expect(issueSizeField!.rejectedSources?.[0]).toMatchObject({
      source: 'CHITTORGARH',
      reason: 'ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR',
    });

    const orchestrator: any = makeOrchestrator();
    const originalScraped = shantiIncoming() as any;
    const created = orchestrator.extractConsolidatedData(result, originalScraped, 'CHITTORGARH', null);

    // The bug: `?? originalScraped.issueSize?.toString()` would re-admit "5691200" here.
    expect(created.issueSize).toBeUndefined();
  });

  it('(2) UPDATE, stored issue_size NULL: the rejected share count is not written', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]); // untracked row
    const existingData = { segment: 'SME', priceRangeMin: 79, priceRangeMax: 83, issueSize: null };

    const result = await service.consolidateIPOData({
      ipoId: 'shanti-id',
      tableName: 'ipos',
      incomingData: shantiIncoming(),
      source: 'CHITTORGARH',
      existingData,
    });

    const orchestrator: any = makeOrchestrator();
    const patch = orchestrator.extractConsolidatedData(result, shantiIncoming() as any, 'CHITTORGARH', {
      id: 'shanti-id',
      ...existingData,
    });

    expect(patch.issueSize).toBeUndefined();
  });

  it('(3) UPDATE, a plausible stored value exists: the stored value is kept (existing behaviour unchanged)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('issueSize', 'DRHP', '47200000'),
    ] as any);
    const existingData = { segment: 'SME', priceRangeMin: 79, priceRangeMax: 83, issueSize: '47200000' };

    const result = await service.consolidateIPOData({
      ipoId: 'shanti-id',
      tableName: 'ipos',
      incomingData: shantiIncoming(), // still the bad share count
      source: 'CHITTORGARH',
      existingData,
    });

    const orchestrator: any = makeOrchestrator();
    const patch = orchestrator.extractConsolidatedData(result, shantiIncoming() as any, 'CHITTORGARH', {
      id: 'shanti-id',
      ...existingData,
    });

    expect(patch.issueSize?.toString()).toBe('47200000');
  });

  it('(4) honest gap: a field consolidation had no value for still falls back to originalScraped', async () => {
    const result = { fieldResults: [] } as any; // consolidation never touched `sector`
    const orchestrator: any = makeOrchestrator();
    const originalScraped = { companyName: 'X', offeringType: 'IPO', status: 'OPEN', sector: 'Chemicals' } as any;

    const patch = orchestrator.extractConsolidatedData(result, originalScraped, 'CHITTORGARH', null);

    expect(patch.companyName).toBe('X');
    expect(patch.status).toBe('OPEN');
  });

  it('(5) coherence arm: a real share count 10x below shares x band is rejected even above the segment floor', async () => {
    // Above the SME floor (Rs1 Cr) on its own, but 68,570 sh x Rs79-83 band
    // implies ~Rs54-57 lakh x 100 = Rs5.4-5.7 Cr net/full — the incoming
    // Rs20 Cr issueSize is wildly incoherent with that (the real prod bug
    // shape: the share count leaks in under the REAL field name this time).
    const incoming = {
      companyName: 'Shanti Inorganics Ltd.',
      issueSize: 20_00_00_000, // Rs20 Cr — clears the SME floor
      noOfSharesOffered: 68_570, // the REAL field name (MAJOR-1 fix)
      priceRangeMin: 79,
      priceRangeMax: 83,
      segment: 'SME',
      offeringType: 'IPO',
      status: 'OPEN',
    };

    const result = await service.consolidateIPOData({
      ipoId: 'new',
      tableName: 'ipos',
      incomingData: incoming,
      source: 'CHITTORGARH',
    });

    const issueSizeField = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(issueSizeField!.rejectedSources?.[0]).toMatchObject({
      reason: 'ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND',
    });

    const orchestrator: any = makeOrchestrator();
    const patch = orchestrator.extractConsolidatedData(result, incoming as any, 'CHITTORGARH', null);
    expect(patch.issueSize).toBeUndefined();
  });
});
