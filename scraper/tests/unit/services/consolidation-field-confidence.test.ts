/**
 * F6 (W-37) — the consolidation service writes a MEANINGFUL
 * `field_sources.confidence`, not the constant 100 it wrote before.
 *
 * Spec: docs/specs/per-ipo-due-step-pipeline.md section 6, D-10.
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

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: IPO_ID,
    tableName: 'ipos',
    fieldName,
    source,
    value,
    confidence: 100,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

function trackCallFor(fieldName: string) {
  return vi
    .mocked(mockFieldSourcesRepo.trackFieldUpdate)
    .mock.calls.map((c) => c[0] as any)
    .filter((p) => p.fieldName === fieldName);
}

describe('F6: field_sources.confidence reflects source tier, conflicts and confirmations', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('writes 80 for the NSE winner of a CRITICAL disagreement with BSE', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('faceValue', 'BSE', 2),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'NSE',
      existingData: { faceValue: 2 } as any,
      // the orchestrator's per-payload hint must NOT become the written value
      confidence: 100,
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'faceValue')!;
    expect(field.chosenSource).toBe('NSE');
    expect(field.conflictSeverity).toBe('CRITICAL');

    const calls = trackCallFor('faceValue');
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe('NSE');
    expect(calls[0].confidence).toBe(80); // NSE 90 - 10 (CRITICAL)
  });

  it('W-24 stays intact: a LOSING incoming write still touches no provenance row', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('faceValue', 'NSE', 10),
    ]);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 2 },
      source: 'BSE',
      existingData: { faceValue: 10 } as any,
    });

    expect(trackCallFor('faceValue')).toHaveLength(0);
  });

  it('raises a stored NSE value to 95 when BSE confirms it', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('faceValue', 'NSE', 10),
    ]);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'BSE',
      existingData: { faceValue: 10 } as any,
      confidence: 100,
    });

    const calls = trackCallFor('faceValue');
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe('NSE');
    expect(calls[0].confidence).toBe(95);
    // W-24: a confirmation must never null the provenance history
    expect(calls[0].previousValue).toBe('10');
    expect(calls[0].previousSource).toBe('NSE');
  });

  it('does not re-confirm (or re-write) when the SAME source repeats its value', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('faceValue', 'NSE', 10),
    ]);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'NSE',
      existingData: { faceValue: 10 } as any,
    });

    expect(trackCallFor('faceValue')).toHaveLength(0);
  });

  it('writes 60 for a CHITTORGARH-only (uncontested, aggregator) value', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'CHITTORGARH',
      existingData: {} as any,
      confidence: 100,
    });

    const calls = trackCallFor('faceValue');
    expect(calls).toHaveLength(1);
    expect(calls[0].source).toBe('CHITTORGARH');
    expect(calls[0].confidence).toBe(60);
  });

  it('writes 100 for an ADMIN value', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'ADMIN',
      existingData: {} as any,
    });

    const calls = trackCallFor('faceValue');
    expect(calls).toHaveLength(1);
    expect(calls[0].confidence).toBe(100);
  });
});
