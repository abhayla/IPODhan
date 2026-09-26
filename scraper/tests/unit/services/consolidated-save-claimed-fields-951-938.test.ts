/**
 * #951 — the consolidated IPO save wrote fields the caller never claimed.
 * #938 — `ipos.listing_exchanges` recorded an exchange that only runs the bidding.
 *
 * Both run through the REAL `DataConsolidationOrchestrator.consolidatedUpsertIPO`
 * and the REAL `DataConsolidationService` (only the repositories are mocked), so
 * the union, the provenance stamp and the final `ipos` payload are the ones
 * production computes.
 *
 * #951 probe (issue body, 2026-09-24): stored ['NSE','BSE']; an NSE-only
 * 4-field write left ["NSE"], then a BSE-only one ["BSE"], with keys
 * {companyName, segment, offeringType, status, openDate, listingExchanges,
 * lastScrapedAt}.
 *
 * #938 real case (staging, 2026-09-17 03:15 UTC = 08:45 IST, the 08:00 OD-19
 * cycle): national-stock-exchange-of-india-ltd, field_sources listingExchanges
 * = {source DRHP, value ["BSE","NSE"], previous_value ["BSE"], previous_source
 * DRHP}. The price band ad and RHP p.3 say BSE only (F-135). This file fixes
 * only the provenance stamp; whether an exchange feed may add a board it only
 * runs bidding for is an open owner question (F-135) and stays as spec row 17
 * has it (NSE > BSE > CG, E-1).
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

const IPO_ID = '00000000-0000-4000-8000-000000000951';

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

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: IPO_ID,
    slug: 'acme-industries-limited',
    companyName: 'Acme Industries Limited',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    status: 'UPCOMING',
    openDate: '2026-09-29',
    closeDate: '2026-10-01',
    listingExchanges: ['NSE', 'BSE'],
    ...overrides,
  } as any;
}

/** The opening-day check's shape: the list payload of ONE exchange. */
function listPayload(exchange: 'NSE' | 'BSE') {
  return {
    companyName: 'Acme Industries Limited',
    segment: 'SME' as const, // what the #951 probe's payload carried
    offeringType: 'IPO' as const,
    status: 'OPEN' as const,
    openDate: '2026-09-29',
    closeDate: '2026-10-01',
    listingExchange: exchange,
    symbol: 'ACME',
  } as any;
}

const FOUR = ['companyName', 'status', 'openDate', 'closeDate'];

function writtenPayload(ipoRepository: { update: any }, call = 0): Record<string, unknown> {
  return ipoRepository.update.mock.calls[call][1] as Record<string, unknown>;
}

describe('#951: an update writes only the fields its caller claimed', () => {
  it('the issue probe: NSE-only then BSE-only 4-field writes leave a stored [NSE,BSE] untouched', async () => {
    const { orchestrator, ipoRepository } = harness();
    const stored = storedRow();

    await orchestrator.consolidatedUpsertIPO(listPayload('NSE'), 'NSE', 100, stored, FOUR);
    await orchestrator.consolidatedUpsertIPO(listPayload('BSE'), 'BSE', 100, stored, FOUR);

    for (const call of [0, 1]) {
      const payload = writtenPayload(ipoRepository, call);
      expect(payload).not.toHaveProperty('listingExchanges');
      expect(Object.keys(payload).sort()).toEqual(
        ['closeDate', 'companyName', 'lastScrapedAt', 'openDate', 'status', 'updatedAt']
      );
    }
  });

  it('a claim of 4 fields never writes segment or offeringType from the raw payload', async () => {
    const { orchestrator, ipoRepository } = harness();
    // Payload says SME, row says MAINBOARD: the old fallback wrote SME.
    await orchestrator.consolidatedUpsertIPO(listPayload('NSE'), 'NSE', 100, storedRow(), FOUR);
    const payload = writtenPayload(ipoRepository);
    expect(payload).not.toHaveProperty('segment');
    expect(payload).not.toHaveProperty('offeringType');
  });

  it('a caller that DOES claim listingExchanges still has it resolved and written (SME self-assertion)', async () => {
    const { orchestrator, ipoRepository } = harness();
    const stored = storedRow({ segment: 'SME', listingExchanges: null });
    await orchestrator.consolidatedUpsertIPO(
      listPayload('NSE'), 'NSE', 100, stored, [...FOUR, 'listingExchanges']
    );
    expect(writtenPayload(ipoRepository).listingExchanges).toEqual(['NSE']);
  });

  it('a brand-new row still gets its identity columns from the payload (create path unchanged)', async () => {
    const { orchestrator, ipoRepository } = harness();
    await orchestrator.consolidatedUpsertIPO(listPayload('NSE'), 'NSE', 100, null, FOUR);
    const created = ipoRepository.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.segment).toBe('SME');
    expect(created.offeringType).toBe('IPO');
    expect(created.companyName).toBe('Acme Industries Limited');
    // An E-1 fact nobody claimed is not written without its provenance row.
    expect(created.listingExchanges).toBeUndefined();
  });
});

describe('#938 provenance: a widened set is recorded under the source that ADDED the member', () => {
  it('an NSE [NSE] widening a DRHP [BSE] is recorded as NSE, with DRHP as the previous source', async () => {
    // Before this fix the row read {source DRHP, value [BSE,NSE], previous
    // '["BSE"]', previous_source DRHP} -- the staging row for the NSE IPO, byte
    // for byte: data-consolidation-service Case 2b stamped the union with
    // `existingSource || incomingSource`, crediting DRHP with a board it never
    // named. Whether NSE's feed may add a board it only runs bidding for is an
    // open owner question (F-135, #938) and is NOT changed here.
    const { orchestrator, fieldSourcesRepository } = harness([
      provenanceRow('listingExchanges', 'DRHP', ['BSE']),
    ]);
    const service = (orchestrator as any).consolidationService;
    const result = await service.consolidateIPOData({
      ipoId: IPO_ID,
      tableName: 'ipos',
      incomingData: { listingExchanges: ['NSE'] },
      source: 'NSE',
      existingData: { listingExchanges: ['BSE'], segment: 'MAINBOARD' },
    });

    expect(result.consolidatedData.listingExchanges).toEqual(['BSE', 'NSE']);
    const tracked = fieldSourcesRepository.trackFieldUpdate.mock.calls
      .map((c: any[]) => c[0])
      .filter((row: any) => row.fieldName === 'listingExchanges');
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({
      fieldName: 'listingExchanges',
      source: 'NSE',
      value: ['BSE', 'NSE'],
      previousValue: '["BSE"]', // serialised, as field_sources.previous_value stores it
      previousSource: 'DRHP',
    });
  });
});
