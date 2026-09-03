/**
 * W-83 — the NORMALIZED company name must never be the PERSISTED value.
 *
 * Live shape (Deepa Jewellers walk, ipodhan_test with production flags):
 * `ipos.company_name` read back as `deepa jewellers` — lowercased and with the
 * legal suffix stripped — while prod still held `Deepa Jewellers Limited`.
 *
 * `normalizeCompanyName()` (normalization-engine.ts ~L293) exists for COMPARISON
 * and matching only: it lowercases, strips `Limited/Ltd/Private/...`, drops dots
 * and `&`. Case 2 of `consolidateField` ("values are equivalent — keep existing")
 * returned `normalizedExisting` as `finalValue`, and
 * data-consolidation-orchestrator.ts:354 copies every `finalValue` into the row
 * that data-persister.ts writes — so the comparison form was stored.
 *
 * Rule under test: for any `company_name`-normalized field, the persisted value
 * is the RAW winner (never case-changed, suffix kept). Normalization decides
 * equivalence; it never decides what is written.
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

const DISPLAY_NAME = 'Deepa Jewellers Limited';

function fieldSourceRow(fieldName: string, source: string, value: any) {
  return {
    ipoId: 'deepa', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

function nameResult(result: any) {
  return result.fieldResults.find((f: any) => f.fieldName === 'companyName');
}

describe('W-83: company_name normalization is for comparison, never for storage', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  it('an equivalent BSE name keeps the stored display casing and suffix (no lowercase leak)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('companyName', 'NSE', DISPLAY_NAME),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { companyName: 'DEEPA JEWELLERS LIMITED' },
      source: 'BSE',
      existingData: { companyName: DISPLAY_NAME } as any,
    });

    const field = nameResult(result);
    expect(field.hadConflict).toBe(false);
    expect(field.finalValue).toBe(DISPLAY_NAME);
    expect(result.consolidatedData.companyName).toBe(DISPLAY_NAME);
  });

  it('the same source re-reporting the identical name does not rewrite it in normalized form', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('companyName', 'NSE', DISPLAY_NAME),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { companyName: DISPLAY_NAME },
      source: 'NSE',
      existingData: { companyName: DISPLAY_NAME } as any,
    });

    expect(nameResult(result).finalValue).toBe(DISPLAY_NAME);
  });

  it('a first-ever BSE-only name is stored exactly as received', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { companyName: 'DEEPA JEWELLERS LIMITED' },
      source: 'BSE',
      existingData: {} as any,
    });

    expect(nameResult(result).finalValue).toBe('DEEPA JEWELLERS LIMITED');
  });

  it('a genuinely different name is still a conflict', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('companyName', 'NSE', DISPLAY_NAME),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'deepa',
      tableName: 'ipos',
      incomingData: { companyName: 'Sahaj Solar Limited' },
      source: 'BSE',
      existingData: { companyName: DISPLAY_NAME } as any,
    });

    const field = nameResult(result);
    expect(field.hadConflict).toBe(true);
    // NSE outranks BSE for companyName - the stored raw name wins, unchanged.
    expect(field.finalValue).toBe(DISPLAY_NAME);
  });
});
