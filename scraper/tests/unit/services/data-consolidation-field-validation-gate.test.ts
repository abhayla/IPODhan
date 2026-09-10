import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

/**
 * Item 4 (OD-21) — the gate inside the REAL `consolidateField`, not a
 * re-implementation of the rule engine.
 *
 * The load-bearing assertion in this file is NOT "a bad value is dropped"
 * (the pure evaluator's own test covers the rules). It is that a bad value is
 * dropped ON ITS OWN: one failing field must not take the four good fields on
 * the same document with it, and a field no rule was ever written to judge
 * must be KEPT, not blanked.
 */

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_FIELD_EXTRACTION_VALIDATION: true,
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

const recordFailure = vi.fn().mockResolvedValue({ id: 'fef-1' });
const markResolved = vi.fn().mockResolvedValue(0);

function makeService() {
  return new DataConsolidationService(
    mockFieldSourcesRepo,
    mockConflictsRepo,
    undefined,
    { recordFailure, markResolved },
    new Set<string>()
  );
}

/** One document carrying FOUR good fields and ONE that violates its rule. */
const DOCUMENT = {
  faceValue: 3, // violates face_value_equity_enum ({1,2,5,10})
  registrar: 'Link Intime India Private Limited',
  symbol: 'ACMECORP',
  companyName: 'Acme Corporation Limited',
  leadManagers: 'Kotak Mahindra Capital',
};

describe('item 4 gate — a failing field is dropped on its own', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([] as any);
    service = makeService();
  });

  it('drops the violating field and records ONE failure row with a non-null cause naming the rule and the value', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-1',
      tableName: 'ipos',
      incomingData: DOCUMENT,
      source: 'NSE',
      offeringType: 'IPO',
    });

    expect(recordFailure).toHaveBeenCalledTimes(1);
    const failure = recordFailure.mock.calls[0][0];
    expect(failure.fieldName).toBe('faceValue');
    expect(failure.ruleId).toBe('face_value_equity_enum');
    expect(failure.rankAttempted).toBe('NSE');
    expect(failure.cause).toBeTruthy();
    expect(failure.cause).toContain('face_value_equity_enum');
    expect(failure.cause).toContain('3');
    expect(failure.extractedValue).toBe('3');

    const faceValueResult = result.fieldResults.find((f) => f.fieldName === 'faceValue');
    expect(faceValueResult?.finalValue ?? null).toBeNull();
    expect(faceValueResult?.rejectedSources?.[0]?.reason).toBe(
      'VALIDATION_RULE_FAILED:face_value_equity_enum'
    );
  });

  it('THE ONE THAT MATTERS: the other four fields on the same document still write', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-2',
      tableName: 'ipos',
      incomingData: DOCUMENT,
      source: 'NSE',
      offeringType: 'IPO',
    });

    expect(result.consolidatedData.registrar).toBe(DOCUMENT.registrar);
    expect(result.consolidatedData.symbol).toBe(DOCUMENT.symbol);
    expect(result.consolidatedData.companyName).toBe(DOCUMENT.companyName);
    expect(result.consolidatedData.leadManagers).toBe(DOCUMENT.leadManagers);
    expect(result.errors).toHaveLength(0);
  });

  it('a field NO rule covers is KEPT, not blanked, and records no failure', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-3',
      tableName: 'ipos',
      incomingData: {
        registrar: 'Bigshare Services',
        symbol: 'NORULE',
        companyName: 'No Rule Covers Me Limited',
      },
      source: 'NSE',
      offeringType: 'IPO',
    });

    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.consolidatedData.registrar).toBe('Bigshare Services');
    expect(result.consolidatedData.symbol).toBe('NORULE');
    expect(result.consolidatedData.companyName).toBe('No Rule Covers Me Limited');
  });

  it('offering-type scoping: an NCD face_value of 1000 is NOT dropped', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-4',
      tableName: 'ipos',
      incomingData: { faceValue: 1000, symbol: 'NCDCO' },
      source: 'NSE',
      offeringType: 'NCD',
    });

    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.consolidatedData.faceValue).toBe(1000);
  });

  it('an unknown offering type is judged by no offering-scoped rule — the value is kept', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-5',
      tableName: 'ipos',
      incomingData: { faceValue: 3, symbol: 'UNKWN' },
      source: 'NSE',
    });

    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.consolidatedData.faceValue).toBe(3);
  });

  it('the gate never runs with the flag on but no failures repository wired', async () => {
    const bare = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    const result = await bare.consolidateIPOData({
      ipoId: 'ipo-gate-6',
      tableName: 'ipos',
      incomingData: { faceValue: 3, symbol: 'BARE' },
      source: 'NSE',
      offeringType: 'IPO',
    });

    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.consolidatedData.faceValue).toBe(3);
  });

  it('a recordFailure throw does not abort the document — the other fields still write', async () => {
    recordFailure.mockRejectedValueOnce(new Error('insert exploded'));

    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-7',
      tableName: 'ipos',
      incomingData: DOCUMENT,
      source: 'NSE',
      offeringType: 'IPO',
    });

    expect(result.errors).toHaveLength(0);
    expect(result.consolidatedData.registrar).toBe(DOCUMENT.registrar);
    expect(result.consolidatedData.symbol).toBe(DOCUMENT.symbol);
  });
});

describe('item 4 gate — off by default', () => {
  it('is a pure no-op when the repository is absent (flag default false in prod)', async () => {
    vi.clearAllMocks();
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([] as any);
    const service = makeService();
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-gate-8',
      tableName: 'ipo_details',
      incomingData: { faceValue: 3 },
      source: 'NSE',
      offeringType: 'IPO',
    });
    // Rules are keyed on (table, column) — `ipo_details` is not `ipos`.
    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.consolidatedData.faceValue).toBe(3);
  });
});
