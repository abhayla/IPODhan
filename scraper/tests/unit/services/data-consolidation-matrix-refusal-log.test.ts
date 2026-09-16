import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stage 1 round 3 (signal-ownership.md R6) — `data-consolidation-service.ts`
 * dropped a field failing the matrix `validateValue` check with NO log line.
 * The 18:53 IST BSE-only staging cycle updated 10 IPOs and touched the NSE
 * row, but lot_size stayed NULL with no trace of why: the refusal was
 * completely silent. This test pins that a refusal now produces ONE
 * structured warn line naming the field, the ipo, the value and the rule.
 */

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_FIELD_EXTRACTION_VALIDATION: false,
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

import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';
import loggerModule from '../../../src/utils/logger.js';

const warn = vi.mocked(loggerModule.warn);

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn().mockResolvedValue([]),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn().mockResolvedValue([]),
} as unknown as DataConflictsRepository;

describe('data-consolidation-service — matrix validation refusal is logged', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([] as any);
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
  });

  it('a value failing matrix validation (lotSize=0) produces a warn line naming the field and ipo, and drops only that field', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-lot-refusal-1',
      tableName: 'ipos',
      incomingData: { lotSize: 0, symbol: 'REFUSE1' },
      source: 'NSE',
      offeringType: 'IPO',
    });

    const call = warn.mock.calls.find(
      ([meta, msg]: [Record<string, unknown>, string]) =>
        typeof msg === 'string' && msg.includes('matrix validation refused')
    );
    expect(call, 'expected a warn call naming the refusal').toBeTruthy();

    const [meta] = call as [Record<string, unknown>, string];
    expect(meta.fieldName).toBe('lotSize');
    expect(meta.ipoId).toBe('ipo-lot-refusal-1');
    expect(meta.value).toBe(0);
    expect(meta.source).toBe('NSE');

    const lotSizeResult = result.fieldResults.find((f) => f.fieldName === 'lotSize');
    expect(lotSizeResult?.rejectedSources?.[0]?.reason).toBe('VALIDATION_FAILED');
    expect(result.consolidatedData.symbol).toBe('REFUSE1');
  });

  it('a legal sub-10 lot (8) is NOT refused and produces no matrix-refusal warn line', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-lot-refusal-2',
      tableName: 'ipos',
      incomingData: { lotSize: 8, symbol: 'ACCEPT1' },
      source: 'BSE',
      offeringType: 'IPO',
    });

    const call = warn.mock.calls.find(
      ([, msg]: [Record<string, unknown>, string]) =>
        typeof msg === 'string' && msg.includes('matrix validation refused')
    );
    expect(call).toBeUndefined();
    expect(result.consolidatedData.lotSize).toBe(8);
  });
});
