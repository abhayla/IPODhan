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
    // S-02 §5: the persister now SKIPS `ipoRepository.update()` when
    // `fieldsUpdated === 0` (no-op write suppression). This double stands in
    // for a real consolidation result, which reports the fields it actually
    // resolved a value for — never 0 while `consolidatedData` is non-empty.
    // A hardcoded 0 here would make every one of this file's assertions on
    // `ipoRepository.update`'s call arguments silently stop being exercised.
    fieldsUpdated: Object.keys(consolidatedData).length,
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
      // F-181/#818 class: `fieldName` must be a real `ipos` column
      // (`fieldsToDrop[0]`, the same field `findByField` above was queried
      // with) - `error.field` ('priceBand') is validateIPOData's own grouping
      // label, never a column, so the admin queue could not resolve the row.
      fieldName: 'priceRangeMin',
      source1: 'NSE',
      source2: 'BSE',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:PRICE_BAND_TOO_WIDE_MAINBOARD',
    });
    expect(conflict.source1).not.toBe(conflict.source2);
    // value1/value2 carry the owner column's stored-vs-rejected values.
    expect(JSON.parse(conflict.value1).priceRangeMin).toBe(100);
    expect(JSON.parse(conflict.value2).priceRangeMin).toBe(100);
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
      // Round-3 C1: the band on the stored row differs from the consolidated
      // one, so there IS a real change to write. Without that, the whole patch
      // equals the row (lotSize having been dropped) and the write is correctly
      // suppressed — which would leave nothing to assert the dropped lot against.
      existingRow({ priceRangeMax: 105 })
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
    // #721: band raised to 260-300 (min investment 40 x 300 = ₹12,000) so the
    // pair sits INSIDE the MAINBOARD SEBI window (₹10,000-₹16,000) - the old
    // fixture (100-110, min investment ₹4,400) was actually an impossible
    // pair that Rule 9 simply had nowhere to report before this fix; keeping
    // it would have turned this "valid, WARNING only" test into a false
    // negative for the very rule #721 wires up. Lot 40 still trips
    // LOT_SIZE_UNUSUAL_MAINBOARD (WARNING, <50) - that is the case under test.
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 40,
      priceRangeMin: 260,
      priceRangeMax: 300,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ lotSize: 40, priceRangeMin: 260, priceRangeMax: 300 }),
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
      fieldName: 'priceRangeMin',
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

  it('(n) #721: an arithmetically impossible lot/band pair for the STORED (MAINBOARD) segment is dropped, even though the BSE payload carries no segment', async () => {
    // Lot 100 x band-cap ₹2,165 = ₹2,16,500 minimum investment — inside no
    // SEBI window at all, but nowhere near MAINBOARD's ₹10,000-₹16,000 (the
    // ICICI Prudential AMC shape the Rule 9 comment names). Chosen so Rule 1
    // (LOT_SIZE_TOO_LOW, already mapped) does NOT also fire: lot=100 is >= 10,
    // so only Rule 9 (LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD) is in play — this
    // isolates the class this test guards (the unmapped rule), rather than
    // accidentally passing off an already-mapped rule's drop.
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 100,
      priceRangeMin: 1900,
      priceRangeMax: 2165,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ lotSize: 100, priceRangeMin: 1900, priceRangeMax: 2165 }), // no segment - BSE shape
      'BSE',
      existingRow() // stored segment MAINBOARD governs
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('lotSize');
    // The band itself is not the suspect field here (it is well within the
    // 20% MAINBOARD width limit) - only the lot is dropped.
    expect(patch.priceRangeMin).toBe(1900);
    expect(patch.priceRangeMax).toBe(2165);

    expect(fieldSourcesMock.findByField).toHaveBeenCalledWith('ipo-id', 'ipos', 'lotSize');
    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      // F-181/#818 class: 'lotEconomics' (error.field, validateIPOData's own
      // grouping label) is not an `ipos` column - fieldName is the real
      // owner column (fieldsToDrop[0]) so the admin queue can resolve it.
      fieldName: 'lotSize',
      source1: 'NSE',
      source2: 'BSE',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD',
    });
    expect(conflict.source1).not.toBe(conflict.source2);
    expect(JSON.parse(conflict.value1).lotSize).toBe(84); // stored (existingRow default)
    expect(JSON.parse(conflict.value2).lotSize).toBe(100); // rejected (incoming)
  });

  it('(o) #721: an impossible lot/band pair for a stored SME segment is dropped', async () => {
    // Lot 10 x band-cap ₹50 = ₹500 minimum investment for an SME row:
    // nowhere near the ₹1,00,000-₹2,00,000 SME window. lot=10 is chosen (not
    // <10) so Rule 1's LOT_SIZE_TOO_LOW branch never fires here — this
    // isolates LOT_ECONOMICS_IMPOSSIBLE_SME the same way test (n) isolates
    // the MAINBOARD arm, so a reviewer can trace this drop to Rule 9's own
    // rule name and message, not an already-mapped sibling rule.
    mockConsolidated({
      companyName: 'Acme Industries Limited',
      lotSize: 10,
      priceRangeMin: 40,
      priceRangeMax: 50,
    });

    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ lotSize: 10, priceRangeMin: 40, priceRangeMax: 50 }),
      'BSE',
      existingRow({ segment: 'SME', lotSize: 1200, priceRangeMin: 70, priceRangeMax: 80 })
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch).not.toHaveProperty('lotSize');
    expect(patch.priceRangeMin).toBe(40);
    expect(patch.priceRangeMax).toBe(50);

    expect(upsertConflictMock).toHaveBeenCalledTimes(1);
    const conflict = upsertConflictMock.mock.calls[0][0];
    expect(conflict).toMatchObject({
      fieldName: 'lotSize',
      severity: 'CRITICAL',
      resolutionReason: 'MERGED_RECORD_VALIDATION:LOT_ECONOMICS_IMPOSSIBLE_SME',
    });
    expect(JSON.parse(conflict.value1).lotSize).toBe(1200); // stored
    expect(JSON.parse(conflict.value2).lotSize).toBe(10); // rejected
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
