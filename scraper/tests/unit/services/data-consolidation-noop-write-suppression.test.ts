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

  /**
   * Round-3 M4 (Tier-A review of round 1): the two tests above both exercise the
   * SAME-source path, where `hadDifferentSource` is false and the normalized
   * comparison is what decides — so they passed for the right reason only by
   * accident of that one branch. These pin the CROSS-source paths.
   *
   * Measured behaviour, not assumed: when a higher-priority source arrives with
   * an EQUIVALENT value, consolidation treats it as a convergence — the stored
   * source keeps the field, `choseIncoming` is false, and nothing is counted as
   * updated. Either way `fieldsUpdated` no longer decides the `ipos` row write
   * (round-3 C1/C2): the persister diffs the final payload against the row.
   */
  it('cross-source, identical value (pg NUMERIC string vs incoming JS number): fieldsUpdated 0', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'revenue_fy1',
        source: 'MONEYCONTROL',
        value: '6800000000.00', // pg NUMERIC string
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
      incomingData: { revenue_fy1: 6800000000 }, // JS number, same value
      source: 'DRHP', // higher priority — wins the field
      confidence: 90,
    });

    expect(result.fieldsUpdated).toBe(0);
    expect(Number(result.consolidatedData.revenue_fy1)).toBe(6800000000);
    // The winner is the existing row's source: an identical value from another
    // source is a CONVERGENCE, not an update — no provenance churn either.
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'revenue_fy1')!;
    expect(fieldResult.chosenSource).toBe('MONEYCONTROL');
  });

  it('cross-source, identical value, incoming LOSES: no provenance update at all (fieldsUpdated 0)', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'test-ipo',
        tableName: 'ipos',
        fieldName: 'revenue_fy1',
        source: 'DRHP', // higher priority than the incoming MONEYCONTROL
        value: '6800000000.00',
        confidence: 95,
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
      source: 'MONEYCONTROL',
      confidence: 70,
    });

    expect(result.fieldsUpdated).toBe(0);
  });

  /**
   * Item 15 (F-49 / W-106): `valueActuallyChanged` is a local const read once on
   * the very next line, but it only DECIDES `valueChanged` when both
   * `existingValueFromMap` is truthy and `hadDifferentSource` is false (same
   * source re-supplies a value for a field that already has one). Walk item
   * W-106 found that on every path it walked, one of the other terms was
   * already true, so `valueActuallyChanged`'s own answer never once decided
   * anything. These four cases pin the four-way split (`NoopSuppressionCounts`)
   * that makes that branch separately observable instead of folded into the
   * single `fieldsUpdated` counter.
   */
  describe('noopSuppression counters (item 15)', () => {
    it('(a) no existing value: writtenNoExisting increments, nothing else does', async () => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

      const result = await service.consolidateIPOData({
        ipoId: 'test-ipo',
        tableName: 'ipos',
        incomingData: { revenue_fy1: 6800000000 },
        source: 'NSE',
        confidence: 90,
      });

      expect(result.noopSuppression).toEqual({
        writtenNoExisting: 1,
        writtenDifferentSource: 0,
        writtenSameSourceChanged: 0,
        suppressedNoop: 0,
      });
    });

    it('(b) existing value, DIFFERENT source wins: writtenDifferentSource increments, writtenSameSourceChanged does NOT', async () => {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        {
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'revenue_fy1',
          source: 'MONEYCONTROL', // lower priority than DRHP in revenue_fy1's matrix entry
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
        incomingData: { revenue_fy1: 7100000000 }, // genuinely different value too
        source: 'DRHP',
        confidence: 90,
      });

      expect(result.noopSuppression).toEqual({
        writtenNoExisting: 0,
        writtenDifferentSource: 1,
        writtenSameSourceChanged: 0,
        suppressedNoop: 0,
      });
    });

    it('(c) existing value, SAME source, equivalent after normalization: suppressedNoop increments, neither written counter does', async () => {
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
        incomingData: { revenue_fy1: 6800000000 }, // same value, different string shape only
        source: 'NSE', // SAME source re-supplies it
        confidence: 90,
      });

      expect(result.noopSuppression).toEqual({
        writtenNoExisting: 0,
        writtenDifferentSource: 0,
        writtenSameSourceChanged: 0,
        suppressedNoop: 1,
      });
    });

    it('(d) existing value, SAME source, GENUINELY different value: writtenSameSourceChanged increments — the branch F-49 says has never fired', async () => {
      // Measured, not assumed (this test was RED first against `revenue_fy1`,
      // a field with no `sameSourceRefresh` opt-in): without opting into
      // `sameSourceRefresh`, resolveConflict's DEFAULT_KEEP_EXISTING branch
      // keeps the stored value even when the same source re-supplies a
      // genuinely different one — that write never happens, so it cannot land
      // in `writtenSameSourceChanged` (it lands in `suppressedNoop` instead,
      // via `!valueChanged`). `priceRangeMin` opts in for NSE
      // (field-priority-matrix.ts `sameSourceRefreshSources: ['DRHP', 'NSE',
      // 'BSE']`) specifically so a same-source correction is NOT discarded —
      // that is the field this branch actually exercises in production.
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        {
          ipoId: 'test-ipo',
          tableName: 'ipos',
          fieldName: 'priceRangeMin',
          source: 'NSE',
          value: 100,
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
        // 120, NOT a string-shape variant of 100 — a genuinely different
        // number from the SAME source re-supplying the field.
        incomingData: { priceRangeMin: 120 },
        source: 'NSE',
        confidence: 90,
      });

      expect(result.noopSuppression).toEqual({
        writtenNoExisting: 0,
        writtenDifferentSource: 0,
        writtenSameSourceChanged: 1,
        suppressedNoop: 0,
      });
      expect(result.fieldsUpdated).toBe(1);
    });
  });
});
