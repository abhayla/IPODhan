/**
 * #654 — consolidation must not record provenance for a value that is null on
 * BOTH sides.
 *
 * Measured on ipodhan_staging: 61 IPOs carry a `field_sources` row naming a
 * field whose parent value is null. Two are live — Quanto Agroworld (OPEN) and
 * Axiom Gas Engineering (UPCOMING) — and both fail NSE document discovery with
 * `no_symbol` while the provenance ledger says CHITTORGARH supplied the symbol.
 * An audit reading `field_sources` would report those fields as sourced.
 *
 * WHICH WRITER, established from the data rather than assumed: Quanto's symbol
 * row carries confidence 60. The insert path in `data-persister.ts` hard-codes
 * `confidence: 100`; 60 is a DERIVED value and only `confidenceFor()` in this
 * service produces one. Across the 61 rows: confidence 60 -> 31 rows, 90 -> 12,
 * 100 -> 10, 80 -> 8. So consolidation wrote the majority.
 *
 * WHERE: `resolveFieldConflict` returns early when the incoming value is
 * null/undefined AND the stored value is NOT (data-consolidation-service.ts
 * ~1298) — "missing incoming keeps existing". There is no guard for the case
 * where BOTH are missing, which is exactly the Quanto shape: no symbol
 * anywhere, from any source. That falls through to the `trackFieldSource` call
 * and writes a provenance row asserting a value that has never existed.
 *
 * Class: every field, every table consolidation writes, both segments, both
 * slots, rows written before this fix and rows it will write after it.
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
  resolveConflict: vi.fn(),
} as unknown as DataConflictsRepository;

const IPO_ID = 'quanto-shape-ipo';

const trackedFields = () =>
  vi
    .mocked(mockFieldSourcesRepo.trackFieldUpdate)
    .mock.calls.map((c) => (c[0] as { fieldName: string }).fieldName);

describe('#654 — consolidation never records provenance for a value null on both sides', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([] as any);
    vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.upsertConflict).mockResolvedValue({ id: 'c-1' } as any);
    vi.mocked(mockConflictsRepo.logConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([] as any);
    vi.mocked(mockConflictsRepo.resolveConflict).mockResolvedValue({} as any);
    vi.mocked(mockConflictsRepo.autoResolveConverged).mockResolvedValue(0 as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('THE QUANTO SHAPE: a field null in the scrape AND null on the row gets no provenance row', async () => {
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { symbol: null, companyName: 'Quanto Agroworld Ltd.' },
      source: 'CHITTORGARH',
      existingData: { symbol: null },
    });

    expect(trackedFields()).not.toContain('symbol');
  });

  it('the same holds for undefined on both sides', async () => {
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { symbol: undefined, companyName: 'Quanto Agroworld Ltd.' },
      source: 'CHITTORGARH',
      existingData: {},
    });

    expect(trackedFields()).not.toContain('symbol');
  });

  it('POSITIVE CONTROL: a field with a real value still gets its provenance row', async () => {
    // Without this, a guard that dropped every field would pass both tests
    // above and silently stop recording all provenance — a far worse defect
    // than the one being fixed, and invisible.
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { symbol: 'QUANTO' },
      source: 'CHITTORGARH',
      existingData: { symbol: null },
    });

    expect(trackedFields()).toContain('symbol');
  });

  it('POSITIVE CONTROL: a falsy-but-real value is a value, not an absence', async () => {
    // THE TRAP. A guard written as `if (!value) return` would "fix" the bug
    // and silently drop every 0, every false and every empty string from the
    // provenance ledger.
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { subscriptionTotal: 0 },
      source: 'CHITTORGARH',
      existingData: { subscriptionTotal: null },
    });

    expect(trackedFields()).toContain('subscriptionTotal');
  });

  it('a missing incoming value against a REAL stored value still keeps the stored provenance', async () => {
    // The existing early return at ~1298 already handles this and must not
    // regress: "missing incoming keeps existing" is correct behaviour. Exact
    // assertions (Tier A review, PR #661): the prior version of this test
    // only asserted `expect(result).toBeDefined()`, which passes for ANY
    // truthy return — it would not have gone red if the both-null guard above
    // (NOTHING_TO_RECORD) were mistakenly widened to also swallow this
    // still-has-a-real-stored-value case. Assert the specific rejection
    // reason (NO_INCOMING_VALUE, never NOTHING_TO_RECORD) and that the real
    // stored value is what survives into consolidatedData.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'symbol',
        source: 'NSE',
        value: 'QUANTO',
        confidence: 90,
        dataLineage: null,
        previousValue: null,
        previousSource: null,
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        createdAt: new Date('2026-09-01T00:00:00Z'),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { symbol: null },
      source: 'CHITTORGARH',
      existingData: { symbol: 'QUANTO' },
    });

    const symbolResult = result.fieldResults.find((f) => f.fieldName === 'symbol');
    expect(symbolResult).toBeDefined();
    expect(symbolResult!.finalValue).toBe('QUANTO');
    expect(symbolResult!.rejectedSources?.[0]?.reason).toBe('NO_INCOMING_VALUE');
    expect(symbolResult!.rejectedSources?.[0]?.reason).not.toBe('NOTHING_TO_RECORD');
    expect(result.consolidatedData?.symbol).toBe('QUANTO');
  });
});
