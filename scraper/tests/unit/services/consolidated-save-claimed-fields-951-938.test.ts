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
 * DRHP}. The price band ad and RHP p.3 say BSE only (F-135). The test below
 * reproduces that exact provenance row from an NSE mainboard feed payload.
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
import { toListingExchangesForSource } from '../../../src/services/listing-exchange-resolution.js';

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

describe('#938: an exchange that only runs the bidding is never recorded as a listing exchange', () => {
  let h: ReturnType<typeof harness>;
  const NSE_IPO_ROW = () =>
    storedRow({
      companyName: 'National Stock Exchange of India Ltd',
      slug: 'national-stock-exchange-of-india-ltd',
      segment: 'MAINBOARD',
      listingExchanges: ['BSE'],
    });

  beforeEach(() => {
    h = harness([provenanceRow('listingExchanges', 'DRHP', ['BSE'])]);
  });

  it('an NSE mainboard feed payload (full, unfiltered scrape) does not add NSE to a DRHP-sourced [BSE]', async () => {
    await h.orchestrator.consolidatedUpsertIPO(
      {
        companyName: 'National Stock Exchange of India Ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'OPEN',
        listingExchange: 'NSE',
        symbol: 'NSE',
      } as any,
      'NSE',
      100,
      NSE_IPO_ROW()
    );

    // The staging row this reproduces: {source DRHP, value [BSE,NSE], previous [BSE], previous_source DRHP}.
    const exchangeProvenance = h.fieldSourcesRepository.trackFieldUpdate.mock.calls.filter(
      (c: any[]) => JSON.stringify(c).includes('listingExchanges')
    );
    expect(exchangeProvenance).toHaveLength(0);
    expect(writtenPayload(h.ipoRepository)).not.toHaveProperty('listingExchanges');
  });

  it('the same for a BSE mainboard feed payload on an NSE-only row (the mirror case)', async () => {
    h = harness([provenanceRow('listingExchanges', 'DRHP', ['NSE'])]);
    await h.orchestrator.consolidatedUpsertIPO(
      { ...listPayload('BSE'), segment: 'MAINBOARD' },
      'BSE',
      100,
      storedRow({ listingExchanges: ['NSE'] })
    );
    expect(writtenPayload(h.ipoRepository)).not.toHaveProperty('listingExchanges');
  });

  it('a BSE payload with NO segment (BSE API) on a stored MAINBOARD row carries no listing claim', async () => {
    h = harness([provenanceRow('listingExchanges', 'DRHP', ['NSE'])]);
    await h.orchestrator.consolidatedUpsertIPO(
      { ...listPayload('BSE'), segment: undefined },
      'BSE',
      100,
      storedRow({ listingExchanges: ['NSE'] })
    );
    expect(writtenPayload(h.ipoRepository)).not.toHaveProperty('listingExchanges');
  });

  it('SME is unchanged: an exchange feed IS the listing venue and still self-asserts', async () => {
    h = harness();
    await h.orchestrator.consolidatedUpsertIPO(
      listPayload('BSE'), 'BSE', 100, storedRow({ segment: 'SME', listingExchanges: null })
    );
    expect(writtenPayload(h.ipoRepository).listingExchanges).toEqual(['BSE']);
  });

  it('a BSE payload with NO segment on a stored SME row still self-asserts (the stored segment decides)', async () => {
    h = harness();
    await h.orchestrator.consolidatedUpsertIPO(
      { ...listPayload('BSE'), segment: undefined },
      'BSE',
      100,
      storedRow({ segment: 'SME', listingExchanges: null })
    );
    expect(writtenPayload(h.ipoRepository).listingExchanges).toEqual(['BSE']);
  });

  it('SME invariant still holds: a second exchange on an SME row is refused', async () => {
    h = harness([provenanceRow('listingExchanges', 'BSE', ['BSE'])]);
    await h.orchestrator.consolidatedUpsertIPO(
      listPayload('NSE'), 'NSE', 100, storedRow({ segment: 'SME', listingExchanges: ['BSE'] })
    );
    expect(writtenPayload(h.ipoRepository).listingExchanges).toEqual(['BSE']);
  });

  it('a page-stating source (Chittorgarh "Listing At") still widens a mainboard set', async () => {
    h = harness([provenanceRow('listingExchanges', 'DRHP', ['BSE'])]);
    await h.orchestrator.consolidatedUpsertIPO(
      { ...listPayload('NSE'), segment: 'MAINBOARD', listingExchange: 'BOTH' },
      'CHITTORGARH',
      100,
      storedRow({ listingExchanges: ['BSE'] })
    );
    expect(writtenPayload(h.ipoRepository).listingExchanges).toEqual(['BSE', 'NSE']);
  });
});

describe('#938 boundary: toListingExchangesForSource needs the segment for an exchange source', () => {
  it('exact outputs', () => {
    expect(toListingExchangesForSource('NSE', 'NSE', 'MAINBOARD')).toBeUndefined();
    expect(toListingExchangesForSource('BSE', 'BSE', 'MAINBOARD')).toBeUndefined();
    expect(toListingExchangesForSource('BSE', 'BSE', undefined)).toBeUndefined();
    expect(toListingExchangesForSource('BSE', 'BSE', null)).toBeUndefined();
    expect(toListingExchangesForSource('NSE', 'NSE', 'SME')).toEqual(['NSE']);
    expect(toListingExchangesForSource('BOTH', 'BSE', 'SME')).toEqual(['BSE']);
    expect(toListingExchangesForSource('BOTH', 'CHITTORGARH', 'MAINBOARD')).toEqual(['NSE', 'BSE']);
    expect(toListingExchangesForSource('BOTH', 'DRHP', 'MAINBOARD')).toEqual(['NSE', 'BSE']);
    expect(toListingExchangesForSource('BSE', 'CHITTORGARH', undefined)).toEqual(['BSE']);
  });
});

describe('#938 mechanism: the set-merge stamps a widened union with the PRIOR source', () => {
  it('an NSE [NSE] reaching the union of a DRHP [BSE] yields EXACTLY the staging provenance row', async () => {
    // Why the fix is at the boundary and not here: data-consolidation-service
    // Case 2b records a union under `existingSource || incomingSource` (there is
    // no MERGED source), so whoever adds a member, the row reads "DRHP said
    // [BSE,NSE]". That is the staging row for the NSE IPO, byte for byte. Stopping
    // the bidding-venue [NSE] from being produced is what keeps it out.
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
      .find((row: any) => row.fieldName === 'listingExchanges');
    expect(tracked).toMatchObject({
      fieldName: 'listingExchanges',
      source: 'DRHP',
      value: ['BSE', 'NSE'],
      previousValue: '["BSE"]', // serialised, as field_sources.previous_value stores it
      previousSource: 'DRHP',
    });
  });
});
