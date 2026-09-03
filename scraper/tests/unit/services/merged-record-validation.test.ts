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
import logger from '../../../src/utils/logger.js';

const consolidateIPODataMock = vi.fn();
const upsertConflictMock = vi.fn().mockResolvedValue({});
/**
 * One shared field_sources double so a test can assert on the provenance the
 * REAL consolidation service would write (test (g)).
 */
const fieldSourcesMock = {
  findByIPOId: vi.fn().mockResolvedValue([]),
  findByField: vi.fn().mockResolvedValue(null),
  trackFieldUpdate: vi.fn().mockResolvedValue({}),
  bulkTrackFieldUpdates: vi.fn().mockResolvedValue(1),
};

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
    FieldSourcesRepository: vi.fn().mockImplementation(() => fieldSourcesMock),
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

// The REAL consolidation service (mocks bypassed for this module only) — used by
// test (g) to prove what provenance a dropped field does/does not leave behind.
const { DataConsolidationService: RealDataConsolidationService } = await vi.importActual<
  typeof import('../../../src/services/data-consolidation-service.js')
>('../../../src/services/data-consolidation-service.js');

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
    consolidateIPODataMock.mockReset();
    upsertConflictMock.mockResolvedValue({});
    fieldSourcesMock.findByIPOId.mockResolvedValue([]);
    // Default stored owner for the merged-validation conflict lookup: a
    // source distinct from every test's incoming source (BSE/CHITTORGARH),
    // so tests that don't care about provenance still get a conflict row.
    // Tests (l)/(m) override this per-case.
    fieldSourcesMock.findByField.mockResolvedValue({ source: 'NSE' });
    fieldSourcesMock.trackFieldUpdate.mockResolvedValue({});
    fieldSourcesMock.bulkTrackFieldUpdates.mockResolvedValue(1);
  });

  it('(a) drops a 25% band on a MAINBOARD row arriving from BSE with no segment, and records a CRITICAL conflict', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 125,
      symbol: 'ACME',
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [id, patch] = ipoRepository.update.mock.calls[0];
    expect(id).toBe('ipo-id');
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');
    // The rest of the update still proceeds.
    expect(patch.symbol).toBe('ACME');

    expect(fieldSourcesMock.findByField).toHaveBeenCalledWith('ipo-id', 'ipos', 'priceRangeMin');
    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      ipoId: 'ipo-id',
      tableName: 'ipos',
      fieldName: 'priceBand',
      source1: 'NSE',
      source2: 'BSE',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:PRICE_BAND_TOO_WIDE_MAINBOARD',
    });
    expect(conflict.source1).not.toBe(conflict.source2);
  });

  it('(b) writes a 35% band on an SME row (within the 40% SME limit)', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 135,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 135 }),
      'BSE',
      existingRow({ segment: 'SME', lotSize: 1200 })
    );

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
      scrape({ listingExchange: 'NSE', status: 'CLOSED', priceRangeMin: 100, priceRangeMax: 110 }),
      'NSE',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMin).toBe(100);
    expect(patch.priceRangeMax).toBe(110);
    expect(patch.status).toBe('CLOSED');
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });

  it('(d) drops a below-threshold lot from CHITTORGARH and records a CRITICAL conflict', async () => {
    // lot_size = 1 never reaches this pass: `validateLotSize` already nulls it
    // while the incoming payload is built. The invalid-lot class that DOES reach
    // the merged view is a below-threshold lot (< 10) - LOT_SIZE_TOO_LOW.
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 5,
      priceRangeMin: 100,
      priceRangeMax: 110,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'BSE', lotSize: 5, priceRangeMin: 100, priceRangeMax: 110 }),
      'CHITTORGARH',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('lotSize');
    expect(patch.priceRangeMin).toBe(100);

    expect(fieldSourcesMock.findByField).toHaveBeenCalledWith('ipo-id', 'ipos', 'lotSize');
    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      fieldName: 'lotSize',
      source1: 'NSE',
      source2: 'CHITTORGARH',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:LOT_SIZE_TOO_LOW',
    });
    expect(conflict.source1).not.toBe(conflict.source2);
  });

  it('(e) an ADMIN-sourced band is never dropped, even at 30%', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 130,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 130 }),
      'ADMIN' as any,
      existingRow()
    );

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
    await upsertIPO(
      ipoRepository,
      scrape({ lotSize: 40, priceRangeMin: 100, priceRangeMax: 110 }),
      'BSE',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.lotSize).toBe(40);
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });
  it('(g) a band dropped by the merged pass leaves NO field_sources provenance, while an accepted field still does', async () => {
    // Real consolidation, mocked repositories: the service is the single writer
    // of `field_sources`, and it runs BEFORE the old in-branch validation did —
    // so a field the pass drops must never reach it (else provenance claims this
    // source owns a value the row does not hold).
    const realService = new RealDataConsolidationService(
      fieldSourcesMock as any,
      { upsertConflict: upsertConflictMock, logConflict: vi.fn(), autoResolveConverged: vi.fn(), findUnresolvedForIPO: vi.fn() } as any
    );
    consolidateIPODataMock.mockImplementation((input: any) => realService.consolidateIPOData(input));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    const trackedFields = fieldSourcesMock.trackFieldUpdate.mock.calls.map((c: any[]) => c[0]?.fieldName);
    expect(trackedFields).not.toContain('priceRangeMax');
    expect(trackedFields).not.toContain('priceRangeMin');
    expect(trackedFields).toContain('symbol');
  });

  it('(h) the legacy fallback door (consolidation threw) never writes the 25% band either', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation exploded'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMax).not.toBe(125);
    expect(patch).not.toHaveProperty('priceRangeMax');
    expect(patch.symbol).toBe('ACME');
  });
  it('(i) a failed conflict upsert is non-fatal: the primary update still runs once and the band is still dropped', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 125,
      symbol: 'ACME',
    });
    upsertConflictMock.mockRejectedValue(new Error('data_conflicts insert failed'));

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');
    expect(patch.symbol).toBe('ACME');
  });

  it('(j) an incoming row cannot flip segment to SME and relax the band gate for its own band in the same write', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      segment: 'SME',
      priceRangeMin: 100,
      priceRangeMax: 130,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ segment: 'SME', priceRangeMin: 100, priceRangeMax: 130 }),
      'BSE',
      existingRow() // stored segment MAINBOARD - it governs
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');

    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    expect(upsertConflictMock.mock.calls[0][0]).toMatchObject({
      fieldName: 'priceBand',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:PRICE_BAND_TOO_WIDE_MAINBOARD',
    });
  });

  it('(k) a stored row with NO segment takes the incoming SME classification, so a 30% band is accepted', async () => {
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      segment: 'SME',
      priceRangeMin: 100,
      priceRangeMax: 130,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ segment: 'SME', priceRangeMin: 100, priceRangeMax: 130 }),
      'BSE',
      existingRow({ segment: null, lotSize: 1200 })
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.priceRangeMin).toBe(100);
    expect(patch.priceRangeMax).toBe(130);
    expect(upsertConflictMock).not.toHaveBeenCalled();
  });

  it('(l) no field_sources provenance for the stored value: no conflict written, field still dropped, warn logged', async () => {
    fieldSourcesMock.findByField.mockResolvedValue(null);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 125,
      symbol: 'ACME',
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');
    expect(patch.symbol).toBe('ACME');

    expect(upsertConflictMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'merged_validation_no_stored_owner' }),
      expect.any(String)
    );

    warnSpy.mockRestore();
  });

  it('(m) stored owner equals the incoming source: no conflict written, field still dropped, warn logged', async () => {
    fieldSourcesMock.findByField.mockResolvedValue({ source: 'BSE' });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    mockConsolidated({
      companyName: 'Acme Industries Limited',
      priceRangeMin: 100,
      priceRangeMax: 125,
      symbol: 'ACME',
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ priceRangeMin: 100, priceRangeMax: 125, symbol: 'ACME' }),
      'BSE',
      existingRow()
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('priceRangeMin');
    expect(patch).not.toHaveProperty('priceRangeMax');
    expect(patch.symbol).toBe('ACME');

    expect(upsertConflictMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'merged_validation_same_source' }),
      expect.any(String)
    );

    warnSpy.mockRestore();
  });
});
