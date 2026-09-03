/**
 * W-14 (Deepa walk, 2026-09-02) — merged-record validation on the consolidation
 * write door.
 *
 * `validateIPOData` runs PER SOURCE inside each orchestrator, on whatever fields
 * that one source happens to carry. BSE list rows never carry `segment`, so the
 * SEBI band-width rules (which are segment-conditional) never fire for BSE data;
 * NSE list rows carry no lot size, so the lot-size rules never fire for NSE rows.
 * A 25% band on a mainboard IPO arriving from BSE was therefore accepted.
 *
 * The MERGED record (post-consolidation, pre-update) has segment + band + lot
 * together, so the same rules are run ONCE more there. ERROR-severity hits drop
 * the offending fields from the update (the stored values survive) and record a
 * CRITICAL data_conflicts row; WARNING-severity hits log only; an ADMIN-sourced
 * write is exempt entirely.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const consolidateIPODataMock = vi.fn();
const upsertConflictMock = vi.fn().mockResolvedValue({});

vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) =>
  await importOriginal<typeof import('@ipodhan/shared/db/schema')>()
);

vi.mock('@ipodhan/shared/utils/registrar-matcher', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/utils/registrar-matcher')>()),
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: vi.fn().mockResolvedValue(1),
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({
      upsertConflict: upsertConflictMock,
    })),
    RegistrarRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([]),
    })),
  };
});

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => true,
}));

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn().mockImplementation(() => ({
    consolidateIPOData: consolidateIPODataMock,
  })),
}));

const { upsertIPO } = await import('../../../src/services/data-persister.js');

function existingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'ipo-id',
    slug: 'acme-industries-ltd',
    companyName: 'Acme Industries Limited',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    priceRangeMin: 100,
    priceRangeMax: 110,
    lotSize: 84,
    listingExchanges: ['BSE'],
    status: 'OPEN',
    ...overrides,
  } as any;
}

/** An incoming scrape that carries NO segment (the BSE list-row shape). */
function scrape(overrides: Record<string, any> = {}) {
  return {
    companyName: 'Acme Industries Limited',
    listingExchange: 'BSE',
    offeringType: 'IPO',
    status: 'OPEN',
    ...overrides,
  } as any;
}

function mockConsolidated(consolidatedData: Record<string, any>) {
  consolidateIPODataMock.mockResolvedValue({
    ipoId: 'ipo-id',
    fieldsProcessed: Object.keys(consolidatedData).length,
    fieldsUpdated: 0,
    conflictsDetected: 0,
    conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
    fieldResults: [],
    consolidatedData,
    errors: [],
    performanceMs: 1,
  });
}

function makeIpoRepository() {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

describe('upsertIPO consolidation path — merged-record validation (W-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertConflictMock.mockResolvedValue({});
  });

  it('(a) drops a 25% band on a MAINBOARD row arriving from BSE with no segment, and records a CRITICAL conflict', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 125,
      symbol: 'ACME',
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('ipo-id');
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');
    // The rest of the update still proceeds.
    expect(patch.symbol).toBe('ACME');

    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      ipoId: 'ipo-id',
      tableName: 'ipos',
      fieldName: 'priceBand',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:PRICE_BAND_TOO_WIDE_MAINBOARD',
    });
  });

  it('(b) writes a 35% band on an SME row (within the 40% SME limit)', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 135,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow({ segment: 'SME', lotSize: 1200 }));

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMin).toBe(100);
    expect(patch.priceRangeMax).toBe(135);
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });

  it('(c) an NSE scrape with no lot size fires no lot rule and drops nothing', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 110,
      status: 'CLOSED',
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE', status: 'CLOSED' }),
      'NSE',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMin).toBe(100);
    expect(patch.priceRangeMax).toBe(110);
    expect(patch.status).toBe('CLOSED');
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });

  it('(d) drops lot_size = 1 from CHITTORGARH and records a CRITICAL conflict', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 1,
      priceRangeMin: 100,
      priceRangeMax: 110,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape({ listingExchange: 'BSE' }), 'CHITTORGARH', existingRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('lotSize');
    expect(patch.priceRangeMin).toBe(100);

    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      fieldName: 'lotSize',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:LOT_SIZE_INVALID',
    });
  });

  it('(e) an ADMIN-sourced band is never dropped, even at 30%', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 130,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape(), 'ADMIN' as any, existingRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMin).toBe(100);
    expect(patch.priceRangeMax).toBe(130);
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });

  it('(f) an unusual-but-valid MAINBOARD lot of 40 is written (WARNING only)', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 40,
      priceRangeMin: 100,
      priceRangeMax: 110,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow());

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.lotSize).toBe(40);
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });
});
