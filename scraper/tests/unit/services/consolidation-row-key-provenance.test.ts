/**
 * Item 1 slice s4 — thread the row key through the consolidation service.
 *
 * Slice s3 (PR #459) added `field_sources.row_key` / `data_conflicts.row_key`
 * and taught the repositories to write and filter on them. Nothing ABOVE the
 * repositories ever supplied a key, so every provenance row the consolidation
 * service wrote was filed under `''` — two promoters, two fiscal years or two
 * peer companies of one IPO were indistinguishable in the provenance trail,
 * and an open `data_conflicts` row belonging to one child row could be matched
 * and auto-resolved by a DIFFERENT child row's consolidation.
 *
 * This suite pins the plumbing: the key reaches `trackFieldUpdate`, it scopes
 * which existing provenance rows count as "this row's", and it is part of the
 * open-conflict match.
 *
 * NOT proven here (deliberately — it is not true yet): that two row keys keep
 * two SEPARATE `field_sources` rows in Postgres. `unique_field_source_per_ipo`
 * is still the 3-column (ipo_id, table_name, field_name) constraint; the
 * row-key-scoped swap is a later slice (see the header of
 * tests/integration/field-sources-row-key-provenance.integration.test.ts).
 * What THIS slice controls, and what is asserted below, is that the service
 * hands the repository two DISTINCT keys instead of two empty strings.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import { SME_SINGLE_EXCHANGE_CONFLICT_REASON } from '../../../src/services/listing-exchange-resolution.js';
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

const IPO_ID = 'row-key-ipo';

function fieldSourceRow(opts: {
  tableName: string;
  rowKey: string;
  fieldName: string;
  source: string;
  value: any;
}) {
  return {
    ipoId: IPO_ID,
    tableName: opts.tableName,
    rowKey: opts.rowKey,
    fieldName: opts.fieldName,
    source: opts.source,
    value: opts.value,
    confidence: 90,
    dataLineage: null,
    previousValue: null,
    previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
  };
}

describe('slice s4 — row key threaded through consolidation provenance', () => {
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

  it('two child rows of one table differing only in row key produce two DISTINCT provenance writes, not one overwrite', async () => {
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: '2024:RESTATED',
      incomingData: { revenue: 1200 },
      source: 'DRHP',
      existingData: {},
    });

    // The FY2024 row is now tracked. The FY2023 consolidation that follows
    // must neither read it as its own existing value nor overwrite its key.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'financial_statements',
        rowKey: '2024:RESTATED',
        fieldName: 'revenue',
        source: 'DRHP',
        value: 1200,
      }),
    ] as any);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: '2023:RESTATED',
      incomingData: { revenue: 900 },
      source: 'DRHP',
      existingData: {},
    });

    const writes = vi
      .mocked(mockFieldSourcesRepo.trackFieldUpdate)
      .mock.calls.map((call: any[]) => call[0])
      .filter(
        (arg: any) => arg.tableName === 'financial_statements' && arg.fieldName === 'revenue'
      );

    expect(writes).toHaveLength(2);
    expect(writes.map((w: any) => w.rowKey)).toEqual(['2024:RESTATED', '2023:RESTATED']);
    // FY2023 is a fresh row: 900 accepted outright, no FY2024 history bleeding in.
    expect(writes[1].value).toBe(900);
    expect(writes[1].previousValue).toBeUndefined();
  });

  it('a singleton IPO-level fact still files its provenance under the empty-string key', async () => {
    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { faceValue: 10 },
      source: 'NSE',
      existingData: {},
    });

    const write = vi
      .mocked(mockFieldSourcesRepo.trackFieldUpdate)
      .mock.calls.map((call: any[]) => call[0])
      .find((arg: any) => arg.fieldName === 'faceValue');

    expect(write).toBeDefined();
    expect((write as any).rowKey).toBe('');
  });

  it('an open conflict recorded for row A is NOT matched when row B consolidates the same field', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: 'ROW-B',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
      }),
    ] as any);

    // The only open row belongs to ROW-A. BSE agreeing with it must not
    // release ROW-B's held value.
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-row-a',
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: 'ROW-A',
        fieldName: 'openDate',
        source1: 'CHITTORGARH',
        value1: '2026-12-09',
        source2: 'NSE',
        value2: '2026-09-08',
        resolvedSource: 'CHITTORGARH',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
        severity: 'CRITICAL',
        adminNote: null,
        resolvedAt: null,
        resolvedBy: null,
        detectedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-B',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      existingData: {
        status: 'UPCOMING',
        openDate: '2026-12-09',
        closeDate: '2026-12-12',
        listingDate: '2026-09-16',
        segment: 'MAINBOARD',
      },
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(field!.conflictReason).not.toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalledWith(
      'conflict-row-a',
      expect.anything()
    );
  });

  it('control: the SAME row key DOES match its own open conflict and releases the held value', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: 'ROW-A',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
      }),
    ] as any);

    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-row-a',
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: 'ROW-A',
        fieldName: 'openDate',
        source1: 'CHITTORGARH',
        value1: '2026-12-09',
        source2: 'NSE',
        value2: '2026-09-08',
        resolvedSource: 'CHITTORGARH',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
        severity: 'CRITICAL',
        adminNote: null,
        resolvedAt: null,
        resolvedBy: null,
        detectedAt: new Date(),
        createdAt: new Date(),
      },
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-A',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      existingData: {
        status: 'UPCOMING',
        openDate: '2026-12-09',
        closeDate: '2026-12-12',
        listingDate: '2026-09-16',
        segment: 'MAINBOARD',
      },
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });

    const field = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(field!.conflictReason).toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');
    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith(
      'conflict-row-a',
      expect.objectContaining({ resolutionReason: 'EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE' })
    );
  });

  it('a conflict logged for a child row carries that row key into data_conflicts', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'peer_companies',
        rowKey: 'ACME-LTD',
        fieldName: 'peRatio',
        source: 'CHITTORGARH',
        value: 21,
      }),
    ] as any);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'peer_companies',
      rowKey: 'ACME-LTD',
      incomingData: { peRatio: 34 },
      source: 'MONEYCONTROL',
      existingData: { peRatio: 21 },
    });

    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        tableName: 'peer_companies',
        rowKey: 'ACME-LTD',
        fieldName: 'peRatio',
      })
    );
  });

  /**
   * The two guards below sit on the OTHER two open-conflict lookups. Both act on
   * `ipos` columns today (`listingExchanges`; the HIGH_VALUE date fields), so no
   * production caller supplies a non-empty key on either path yet — they become
   * load-bearing when child tables route through `consolidateField` in s5b/s7a/s7b.
   * They are exercised here through the real public entry point with an explicit
   * row key, which is exactly what those slices will do. Each goes red when its
   * own guard is neutered.
   */

  it('SME collapse does NOT resolve another row open conflict', async () => {
    const listingRepo = { findByIPO: vi.fn().mockResolvedValue(null) };
    const smeService = new DataConsolidationService(
      mockFieldSourcesRepo,
      mockConflictsRepo,
      listingRepo
    );

    // This row's OWN provenance (ROW-B) is the collapse evidence...
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: 'ROW-B',
        fieldName: 'listingExchanges',
        source: 'NSE',
        value: ['NSE'],
      }),
    ] as any);

    // ...while the only open SME conflict belongs to ROW-A.
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-row-a',
        tableName: 'ipos',
        rowKey: 'ROW-A',
        fieldName: 'listingExchanges',
        resolutionReason: SME_SINGLE_EXCHANGE_CONFLICT_REASON,
      },
    ] as any);

    const result = await smeService.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-B',
      incomingData: { listingExchanges: ['BSE'] },
      source: 'BSE',
      existingData: { listingExchanges: ['NSE', 'BSE'], segment: 'SME' } as any,
    });

    // The collapse itself still happens — this proves the path was reached.
    expect(result.consolidatedData.listingExchanges).toEqual(['NSE']);
    // ROW-A's dispute stays OPEN: it was never this row's dispute to close.
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalled();
  });

  it('control: SME collapse DOES resolve its own row open conflict', async () => {
    const listingRepo = { findByIPO: vi.fn().mockResolvedValue(null) };
    const smeService = new DataConsolidationService(
      mockFieldSourcesRepo,
      mockConflictsRepo,
      listingRepo
    );

    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: 'ROW-B',
        fieldName: 'listingExchanges',
        source: 'NSE',
        value: ['NSE'],
      }),
    ] as any);

    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      {
        id: 'conflict-row-b',
        tableName: 'ipos',
        rowKey: 'ROW-B',
        fieldName: 'listingExchanges',
        resolutionReason: SME_SINGLE_EXCHANGE_CONFLICT_REASON,
      },
    ] as any);

    await smeService.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-B',
      incomingData: { listingExchanges: ['BSE'] },
      source: 'BSE',
      existingData: { listingExchanges: ['NSE', 'BSE'], segment: 'SME' } as any,
    });

    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith(
      'conflict-row-b',
      expect.objectContaining({ resolutionReason: 'SME_COLLAPSE_FIELD_SOURCE_PROVENANCE' })
    );
  });

  /**
   * Escape (b), the date-order invariant. `source2` is the SAME exchange as the
   * incoming source in both cases below, so the consensus escape (a) is refused
   * by its own same-source guard and the date-invariant lookup is the only one
   * under test here.
   */
  const kanoharHeld = {
    status: 'UPCOMING',
    openDate: '2026-12-09',
    closeDate: '2026-12-12',
    listingDate: '2026-09-16',
    segment: 'MAINBOARD',
  };

  function heldOpenDateRow(rowKey: string) {
    return fieldSourceRow({
      tableName: 'ipos',
      rowKey,
      fieldName: 'openDate',
      source: 'CHITTORGARH',
      value: '2026-12-09',
    });
  }

  function openConflict(id: string, rowKey: string) {
    return {
      id,
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey,
      fieldName: 'openDate',
      source1: 'CHITTORGARH',
      value1: '2026-12-09',
      source2: 'NSE',
      value2: '2026-09-08',
      resolvedSource: 'CHITTORGARH',
      resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
      severity: 'CRITICAL',
      adminNote: null,
      resolvedAt: null,
      resolvedBy: null,
      detectedAt: new Date(),
      createdAt: new Date(),
    };
  }

  it('the date-invariant override does NOT close another row open conflict', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      heldOpenDateRow('ROW-B'),
    ] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      openConflict('conflict-row-a', 'ROW-A'),
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-B',
      incomingData: { openDate: '2026-09-08', closeDate: '2026-09-10' },
      source: 'NSE',
      existingData: kanoharHeld,
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    // The override still fires for ROW-B — the path was reached.
    const field = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(field!.conflictReason).toBe('DATE_INVARIANT_OVERRIDE_HELD_VALUE');
    // ROW-A's CRITICAL dispute is left open rather than silently closed on
    // evidence that was never about it.
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalled();
  });

  it('control: the date-invariant override DOES close its own row open conflict', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      heldOpenDateRow('ROW-B'),
    ] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      openConflict('conflict-row-b', 'ROW-B'),
    ] as any);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'ROW-B',
      incomingData: { openDate: '2026-09-08', closeDate: '2026-09-10' },
      source: 'NSE',
      existingData: kanoharHeld,
      scrapedAt: new Date('2026-09-05T00:01:00Z'),
    });

    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith(
      'conflict-row-b',
      expect.objectContaining({ resolutionReason: 'DATE_INVARIANT_OVERRIDE_HELD_VALUE' })
    );
  });
  /**
   * s4 round 2 (MINOR-3) — the `''`-versus-keyed and prefix directions.
   *
   * Every guard test above compares ROW-A against ROW-B: two non-empty, mutually
   * non-prefixing keys. That leaves two weakenings of the four row-key
   * comparisons green, both of which a reviewer's mutation run confirmed:
   *
   *   1. `(row.rowKey ?? '').startsWith(rowKey)` (or the reverse) — passes,
   *      because 'ROW-A' and 'ROW-B' do not prefix one another.
   *   2. `!a || !b || a === b` ("compare only when both are non-empty") — passes,
   *      because neither side is ever `''` in those tests.
   *
   * Weakening 2 is not academic: it IS the migration state. Every `data_conflicts`
   * row written before this slice carries `''`, so the FIRST keyed consolidation
   * after the writer slices land reads exactly `'' vs 'peer:abcdef'`. Under that
   * weakening a legacy IPO-wide dispute would release a child row's held value on
   * evidence that was never about it.
   *
   * The consequence asserted is the one that matters: the held value stays HELD
   * and the dispute stays OPEN. Asserting only that a `.find()` missed would pass
   * for the wrong reason.
   */
  function heldConflictRow(id: string, rowKey: string) {
    return {
      id,
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey,
      fieldName: 'openDate',
      source1: 'CHITTORGARH',
      value1: '2026-12-09',
      source2: 'NSE',
      value2: '2026-09-08',
      resolvedSource: 'CHITTORGARH',
      resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
      severity: 'CRITICAL',
      adminNote: null,
      resolvedAt: null,
      resolvedBy: null,
      detectedAt: new Date(),
      createdAt: new Date(),
    };
  }

  const HELD_EXISTING = {
    status: 'UPCOMING',
    openDate: '2026-12-09',
    closeDate: '2026-12-12',
    listingDate: '2026-09-16',
    segment: 'MAINBOARD',
  };

  /**
   * Drives the real public entry point with `consolidationRowKey` while the only
   * open conflict row carries `storedConflictRowKey`. The field_sources row always
   * carries the consolidation's OWN key, so the HOLD path is genuinely reached and
   * the row-key comparison on the conflict lookup is the only variable.
   */
  async function consolidateAgainstStoredConflict(opts: {
    storedConflictRowKey: string;
    consolidationRowKey: string;
  }) {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: opts.consolidationRowKey,
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
      }),
    ] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([
      heldConflictRow('conflict-stored', opts.storedConflictRowKey),
    ] as any);

    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: opts.consolidationRowKey,
      // BSE agreeing with the stored NSE value is what would trigger the
      // consensus escape, IF the stored row were this row's dispute.
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      existingData: HELD_EXISTING,
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });

    return result.fieldResults.find((f) => f.fieldName === 'openDate')!;
  }

  function expectStillHeld(field: { finalValue: any; conflictReason?: string }) {
    // The consequence: the held CHITTORGARH value survives...
    expect(field.finalValue).toBe('2026-12-09');
    // ...the escape did not fire...
    expect(field.conflictReason).not.toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');
    // ...and the stored dispute is still open for a human to adjudicate.
    expect(mockConflictsRepo.resolveConflict).not.toHaveBeenCalled();
  }

  it('a legacy empty-key conflict row is NOT matched by a consolidation carrying a real row key', async () => {
    const field = await consolidateAgainstStoredConflict({
      storedConflictRowKey: '',
      consolidationRowKey: 'peer:abcdef',
    });
    expectStillHeld(field);
  });

  it('a keyed conflict row is NOT matched by an IPO-wide consolidation carrying the empty key', async () => {
    const field = await consolidateAgainstStoredConflict({
      storedConflictRowKey: 'peer:abcdef',
      consolidationRowKey: '',
    });
    expectStillHeld(field);
  });

  it('a conflict row whose key is a PREFIX of this row key is not matched', async () => {
    const field = await consolidateAgainstStoredConflict({
      storedConflictRowKey: 'peer:abc',
      consolidationRowKey: 'peer:abcdef',
    });
    expectStillHeld(field);
  });

  it('a conflict row whose key this row key is a prefix OF is not matched', async () => {
    const field = await consolidateAgainstStoredConflict({
      storedConflictRowKey: 'peer:abcdef',
      consolidationRowKey: 'peer:abc',
    });
    expectStillHeld(field);
  });

  it('control: an exactly-equal key still releases the held value, so the four guards above are not vacuous', async () => {
    const field = await consolidateAgainstStoredConflict({
      storedConflictRowKey: 'peer:abcdef',
      consolidationRowKey: 'peer:abcdef',
    });
    expect(field.finalValue).toBe('2026-09-08');
    expect(field.conflictReason).toBe('EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE');
    expect(mockConflictsRepo.resolveConflict).toHaveBeenCalledWith(
      'conflict-stored',
      expect.objectContaining({ resolutionReason: 'EXCHANGE_CONSENSUS_OVERRIDE_HELD_VALUE' })
    );
  });

  it('the HOLD audit-trail row a child-row consolidation writes carries that row key', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow({
        tableName: 'ipos',
        rowKey: 'peer:abcdef',
        fieldName: 'openDate',
        source: 'CHITTORGARH',
        value: '2026-12-09',
      }),
    ] as any);
    vi.mocked(mockConflictsRepo.findUnresolvedForIPO).mockResolvedValue([] as any);

    await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: 'peer:abcdef',
      incomingData: { openDate: '2026-09-08' },
      source: 'BSE',
      existingData: HELD_EXISTING,
      scrapedAt: new Date('2026-09-05T00:05:00Z'),
    });

    // Written under `''`, this row is invisible to the keyed reads above and the
    // escape never fires again for this child row.
    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        rowKey: 'peer:abcdef',
        fieldName: 'openDate',
        resolutionReason: 'HELD_DISPUTED_HIGH_VALUE_LIVE',
      })
    );
  });
});
