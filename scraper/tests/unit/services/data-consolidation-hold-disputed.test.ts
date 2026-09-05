/**
 * T-328 — HOLD disputed HIGH_VALUE fields on live IPOs.
 *
 * Reproduces the exact Lumino 2026-08-26T00:01Z shape (review evidence:
 * evidence/2026-08-26-T-322/REVIEW-VERDICT.md — reproduced via code trace at
 * evidence/2026-08-26-T-328/PLAN.md, read-only DB access unavailable in this
 * worktree): NSE reports openDate=2026-08-26, CHITTORGARH reports
 * openDate=2026-08-27 (Chittorgarh right, per the reviewer), IPO is UPCOMING.
 * Before this fix: resolveConflict picks NSE by default field-priority
 * (openDate/closeDate have no camelCase matrix entry — see PLAN.md) and the
 * wrong value gets published, later flipping status. After this fix: the
 * field is HELD — the previously-published value is kept, the consolidation
 * result carries a disputed marker, and a data_conflicts row records why.
 *
 * Negative control: a LOW_VALUE field (not price band / not a date) still
 * resolves by plain SOURCE_PRIORITY as today, even on a live IPO — proves
 * HOLD is scoped to HIGH_VALUE fields only.
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

describe('T-328 HOLD disputed HIGH_VALUE fields (Lumino shape)', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.logConflict).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds openDate on an UPCOMING IPO when NSE and a non-1-day-delta source disagree (no tie-break)', async () => {
    // A 3-day delta (not the 1-day TZ signature) forces the HOLD path rather
    // than the tie-break path, isolating this test from T-328's tie-break logic.
    const existingFieldSources = [
      {
        ipoId: 'lumino-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-08-26',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-25T00:00:00Z'),
        createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'lumino-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-08-29' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-08-26' },
      scrapedAt: new Date('2026-08-26T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult).toBeDefined();
    // The previously-published value MUST stay — NSE's wrong value never wins one-sided.
    expect(fieldResult!.finalValue).toBe('2026-08-26');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    expect(fieldResult!.hadConflict).toBe(true);

    // Alert-to-correction link groundwork: a data_conflicts row is written
    // with the HOLD reason so downstream (UI + alert body) can read it.
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'openDate',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
      })
    );
  });

  it('holds closeDate the same way on an OPEN IPO', async () => {
    const existingFieldSources = [
      {
        ipoId: 'lumino-ipo-2',
        tableName: 'ipos',
        fieldName: 'closeDate',
        source: 'CHITTORGARH',
        value: '2026-09-02',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-25T00:00:00Z'),
        createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'lumino-ipo-2',
      tableName: 'ipos',
      incomingData: { closeDate: '2026-09-06' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'OPEN', closeDate: '2026-09-02' },
      scrapedAt: new Date('2026-08-26T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'closeDate');
    expect(fieldResult!.finalValue).toBe('2026-09-02');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('negative control: a LOW_VALUE field (registrar) still resolves by SOURCE_PRIORITY on a live IPO — HOLD does not apply', async () => {
    const existingFieldSources = [
      {
        ipoId: 'lumino-ipo-3',
        tableName: 'ipos',
        fieldName: 'registrar',
        source: 'CHITTORGARH',
        value: 'Old Registrar Pvt Ltd',
        confidence: 80,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-25T00:00:00Z'),
        createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'lumino-ipo-3',
      tableName: 'ipos',
      incomingData: { registrar: 'New Registrar Pvt Ltd' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', registrar: 'Old Registrar Pvt Ltd' },
      scrapedAt: new Date('2026-08-26T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'registrar');
    expect(fieldResult!.conflictReason).not.toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('TZ tie-break: a 1-day NSE-vs-non-NSE delta prefers the non-NSE value instead of HOLD', async () => {
    const existingFieldSources = [
      {
        ipoId: 'annu-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-08-27',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-25T00:00:00Z'),
        createdAt: new Date('2026-08-25T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'annu-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-08-26' }, // NSE, exactly 1 day earlier
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-08-27' },
      scrapedAt: new Date('2026-08-26T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    // Prefer the non-NSE (CHITTORGARH) value, not NSE's, and not a HOLD.
    expect(fieldResult!.finalValue).toBe('2026-08-27');
    expect(fieldResult!.chosenSource).toBe('CHITTORGARH');
    expect(fieldResult!.conflictReason).toBe('TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE');
  });

  it('TZ tie-break does not apply when the delta is more than 1 day (falls through to HOLD)', async () => {
    const existingFieldSources = [
      {
        ipoId: 'multi-day-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-08-20',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-08-19T00:00:00Z'),
        createdAt: new Date('2026-08-19T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'multi-day-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-08-25' }, // NSE, 5 days later — not the TZ signature
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'UPCOMING', openDate: '2026-08-20' },
      scrapedAt: new Date('2026-08-26T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('negative control: HIGH_VALUE field disagreement on a CLOSED IPO resolves by the matrix as today (not held)', async () => {
    const existingFieldSources = [
      {
        ipoId: 'closed-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-07-01',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'closed-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-07-05' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'CLOSED', openDate: '2026-07-01' },
      scrapedAt: new Date('2026-07-10T00:01:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.conflictReason).not.toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
  });

  it('W-161b: logs a warning when upsertConflict SKIPS the HOLD audit-trail write', async () => {
    // Empirically (W-161 integration test against ipodhan_test), a
    // different-source HOLD tuple like Kanohar's (CHITTORGARH vs NSE) is
    // NOT refused by the repository — but the caller here previously
    // ignored the `{ skipped: true }` return shape entirely (it only ever
    // throws on a genuine DB error, caught below). This proves the caller
    // now surfaces a skip at warn level instead of silently treating it as
    // a successful write, for whatever future guard inside `upsertConflict`
    // (or a same-source shape slipping through upstream) causes one.
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValueOnce({
      skipped: true,
      reason: 'same_source',
    } as any);
    const loggerModule = await import('../../../src/utils/logger.js');
    const warnSpy = vi.spyOn(loggerModule.default, 'warn');

    const existingFieldSources = [
      {
        ipoId: 'kanohar-ipo',
        tableName: 'ipos',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ];
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue(existingFieldSources as any);

    const result = await service.consolidateIPOData({
      ipoId: 'kanohar-ipo',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-08' },
      source: 'NSE',
      confidence: 95,
      existingData: { status: 'OPEN', openDate: '2026-12-09' },
      scrapedAt: new Date('2026-09-05T06:30:00Z'),
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult!.conflictReason).toBe('HELD_DISPUTED_HIGH_VALUE_LIVE');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ipoId: 'kanohar-ipo',
        fieldName: 'openDate',
        skipReason: 'same_source',
      }),
      expect.stringContaining('SKIPPED the HOLD audit-trail write')
    );
  });
});
