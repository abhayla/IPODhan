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
});
