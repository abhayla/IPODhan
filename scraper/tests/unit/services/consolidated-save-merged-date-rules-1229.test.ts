/**
 * #1229 (refs #70), the LIVE door: `DataConsolidationOrchestrator.consolidatedUpsertIPO`
 * (every scraper's Step 5, and the field walk's writer) ran NO date rule at all.
 * With #1228 mapping listing_date for the walk, a listing-only write reaches it, so
 * the cross-field date rules now run here too, on the MERGED record (stored row +
 * this write), BEFORE consolidation: a refused date is never written and gets no
 * provenance row (OD-131).
 *
 * Real case (staging, 2026-09-27): glass-wall-systems-india-ltd, open 2026-09-08,
 * close 2026-09-10, allotment 2026-09-11, listing NULL. CHITTORGARH's 2026-09-16 is
 * valid; its earlier 2026-09-03 (before the open date) is not.
 *
 * REAL orchestrator + REAL DataConsolidationService; only repositories are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/step-ledger-recorders.js', () => ({
  recordDiscoverySteps: vi.fn().mockResolvedValue(undefined),
  initStepLedger: vi.fn().mockResolvedValue(undefined),
}));

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

import { DataConsolidationOrchestrator } from '../../../src/services/data-consolidation-orchestrator.js';

const IPO_ID = '00000000-0000-4000-8000-000000001229';

function provenanceRow(fieldName: string, source: string, value: unknown) {
  return {
    ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-10T00:00:00Z'), createdAt: new Date('2026-09-10T00:00:00Z'),
  } as any;
}

function harness(provenance: any[] = []) {
  const ipoRepository = {
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: IPO_ID })),
  };
  const fieldSourcesRepository = {
    findByIPOId: vi.fn(async () => provenance),
    findByField: vi.fn(async () => null),
    trackFieldUpdate: vi.fn(async () => undefined),
  };
  const dataConflictsRepository = {
    logConflict: vi.fn(),
    upsertConflict: vi.fn(),
    autoResolveConverged: vi.fn(),
    findUnresolvedForIPO: vi.fn(async () => []),
    resolveConflict: vi.fn(),
  };
  const orchestrator = new DataConsolidationOrchestrator(
    ipoRepository as any,
    fieldSourcesRepository as any,
    dataConflictsRepository as any,
    null
  );
  return { orchestrator, ipoRepository, fieldSourcesRepository, dataConflictsRepository };
}


function glassWallStored() {
  return {
    id: IPO_ID,
    slug: 'glass-wall-systems-india-ltd',
    companyName: 'Glass Wall Systems India Ltd',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'CLOSED',
    openDate: '2026-09-08',
    closeDate: '2026-09-10',
    allotmentDate: '2026-09-11',
    listingDate: null,
    listingExchanges: ['NSE'],
  } as any;
}

function listingOnly(listingDate: string) {
  return { companyName: 'Glass Wall Systems India Ltd', listingDate } as any;
}

describe('#1229 at the orchestrator door: date rules on the merged record', () => {
  it('glass-wall listing-only 2026-09-16 (the walk shape, onlyFields [listingDate]) is written, with its provenance, and nothing else', async () => {
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(listingOnly('2026-09-16'), 'CHITTORGARH', 60, glassWallStored(), ['listingDate']);

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const payload = ipoRepository.update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.listingDate).toBe('2026-09-16');
    expect(Object.keys(payload).sort()).toEqual(['lastScrapedAt', 'listingDate', 'updatedAt']);
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).toEqual(['listingDate']);
  });

  it('listing-only 2026-09-03 (before stored open 2026-09-08) is refused: not written, no provenance row', async () => {
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    const r = await orchestrator.consolidatedUpsertIPO(listingOnly('2026-09-03'), 'CHITTORGARH', 60, glassWallStored(), ['listingDate']);
    // The refusal cause reaches the caller (the field walk records it, not "no field result returned").
    expect(r.refusedDateFields).toEqual(['listingDate']);

    const writes = ipoRepository.update.mock.calls.map((c: any[]) => c[1] as Record<string, unknown>);
    for (const w of writes) expect(w).not.toHaveProperty('listingDate');
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).not.toContain('listingDate');
  });

  it('an ADMIN write is never dropped by the merged date rule (W-14 exemption)', async () => {
    const { orchestrator, ipoRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(listingOnly('2026-09-03'), 'ADMIN' as any, 100, glassWallStored(), ['listingDate']);
    const payload = ipoRepository.update.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.listingDate).toBe('2026-09-03');
  });
});

describe('#1229 review r1: the orchestrator CREATE branch runs the date rule on the incoming record', () => {
  const full = (listingDate: string) => ({
    companyName: 'Glass Wall Systems India Ltd', openDate: '2026-09-08', closeDate: '2026-09-10', listingDate,
  } as any);

  it('create with listing_date 2026-09-03 before open 2026-09-08: listing_date not written, no provenance for it', async () => {
    const { orchestrator, ipoRepository, fieldSourcesRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(full('2026-09-03'), 'NSE', 100, null);
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const created = ipoRepository.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.listingDate ?? null).toBeNull();
    expect(created.openDate).toBe('2026-09-08');
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls.map((c: any[]) => c[0].fieldName);
    expect(tracked).not.toContain('listingDate');
  });

  it('create with a coherent listing_date (2026-09-16) writes it', async () => {
    const { orchestrator, ipoRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(full('2026-09-16'), 'NSE', 100, null);
    expect((ipoRepository.create.mock.calls[0][0] as Record<string, unknown>).listingDate).toBe('2026-09-16');
  });
});

describe('#1229 merged view: an undefined key is not a claim', async () => {
  const { incomingDatesRefusedOnMergedRecord } = await import('../../../src/utils/validators.js');
  it('a mapper payload with openDate/closeDate undefined still sees the stored open/close (no refusal of a valid listing)', () => {
    expect(
      incomingDatesRefusedOnMergedRecord(
        { openDate: undefined, closeDate: undefined, listingDate: '2026-09-16' },
        glassWallStored()
      )
    ).toEqual([]);
  });
  it('with no stored row (unreadable / create) the write alone is judged: the stricter partial-only verdict', () => {
    expect(incomingDatesRefusedOnMergedRecord({ listingDate: '2099-01-01' }, null)).toEqual(['listingDate']);
  });
});
