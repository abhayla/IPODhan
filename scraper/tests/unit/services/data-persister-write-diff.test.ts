/**
 * Round-3 C1/C2/M3 (Tier-A review of the due-step scheduler round 1).
 *
 * The no-op write skip used to key on `consolidationResult.fieldsUpdated`.
 * That number counts PROVENANCE rows (`field_sources`) and is computed BEFORE
 * the persister adds `listingExchanges`, `registrarId`, `offeringType` and the
 * re-applied write sanitizers — so:
 *   (a) a cycle where the merged exchange list gained 'BSE', or a null
 *       `registrarId` finally resolved, was skipped and the row never got it;
 *   (b) a row repaired by a direct write (provenance says 100, the row says 90)
 *       never converged, because provenance already agreed with the incoming
 *       value and `fieldsUpdated` stayed 0 forever.
 * The skip is now decided by a field-by-field diff of the final payload against
 * the stored row, with WRITE-gate-strict equality (M3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const consolidateIPODataMock = vi.fn();
const resolveRegistrarIdMock = vi.fn().mockReturnValue(null);

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
  resolveRegistrarId: (...args: unknown[]) => resolveRegistrarIdMock(...args),
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: vi.fn().mockResolvedValue(1),
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    RegistrarRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([{ id: 'registrar-1', name: 'Bigshare Services Private Limited', shortName: 'Bigshare' }]),
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

const { upsertIPO, valuesEqualForWrite, diffFieldsForWrite } = await import('../../../src/services/data-persister.js');

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ipo-1',
    slug: 'acme-industries-limited',
    symbol: 'ACME',
    companyName: 'Acme Industries Limited',
    segment: 'SME',
    offeringType: 'IPO',
    faceValue: 2,
    listingExchanges: ['NSE'],
    registrar: 'Bigshare Services Private Limited',
    registrarId: null,
    status: 'OPEN',
    ...overrides,
  } as any;
}

function scrape(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Acme Industries Limited',
    listingExchange: 'BSE',
    segment: 'SME',
    offeringType: 'IPO',
    status: 'OPEN',
    ...overrides,
  } as any;
}

function makeIpoRepository() {
  return {
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    // Round-4 M-LOW: defaults to "no uncached row available" (null), which
    // makes `upsertIPO` fall back to the already-resolved row — i.e. the
    // pre-fix behavior — so every OTHER test in this file is unaffected.
    findByIdUncached: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

/** Consolidation result whose `fieldsUpdated` deliberately disagrees with reality. */
function consolidationResult(consolidatedData: Record<string, unknown>, fieldsUpdated: number) {
  return {
    ipoId: 'ipo-1',
    fieldsProcessed: Object.keys(consolidatedData).length,
    fieldsUpdated,
    conflictsDetected: 0,
    conflictsBySeverity: { INFO: 0, WARNING: 0, CRITICAL: 0 },
    fieldResults: Object.entries(consolidatedData).map(([fieldName, finalValue]) => ({
      fieldName,
      finalValue,
      chosenSource: 'BSE',
      hadConflict: false,
    })),
    consolidatedData,
    errors: [],
    performanceMs: 1,
  };
}

describe('round-3 C1/C2: the write skip is decided by a diff against the ROW, not by fieldsUpdated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
  });

  it('(1) fieldsUpdated 0 but the merged exchange list gains BSE => update IS called with listingExchanges', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN' }, 0));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, scrape({ listingExchange: 'BSE' }), 'BSE', existingRow({ listingExchanges: ['NSE'] }));

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.listingExchanges).toEqual(expect.arrayContaining(['NSE', 'BSE']));
  });

  it('(2) fieldsUpdated 0 but registrarId resolves from null => update IS called with the resolved id', async () => {
    resolveRegistrarIdMock.mockReturnValue('registrar-1');
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({ status: 'OPEN', registrar: 'Bigshare Services Private Limited' }, 0)
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      existingRow({ listingExchanges: ['NSE'], registrarId: null })
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.registrarId).toBe('registrar-1');
  });

  it('(3) provenance says 100 and the ROW says 90 with incoming 100 => update IS called (the row converges)', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN', faceValue: 100 }, 0));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      existingRow({ listingExchanges: ['NSE'], faceValue: 90 })
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.faceValue).toBe(100);
  });

  it('(4) truly identical (even with a non-zero fieldsUpdated) => update NOT called, so no row write and no cache invalidation', async () => {
    // fieldsUpdated 5 proves the decision is the diff, not the provenance count.
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN', faceValue: 2 }, 5));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      // faceValue as a pg NUMERIC string — representation differs, value does not.
      existingRow({ listingExchanges: ['NSE'], faceValue: '2.00' })
    );

    expect(ipoRepository.update).not.toHaveBeenCalled();
  });
});

describe('round-4 M-LOW: the write-diff gate re-reads uncached before deciding no-op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
  });

  it('cached row equals the payload but the uncached row differs => update IS called', async () => {
    // The pre-resolved row (stands in for a stale `findBySlug`/`findById`
    // cache hit) already agrees with the incoming faceValue — a diff against
    // IT alone would wrongly call this a no-op.
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN', faceValue: 100 }, 0));
    const ipoRepository = makeIpoRepository();
    // The REAL row (direct write repaired it moments ago) still says 90 —
    // this is what the uncached re-read must return and be diffed against.
    ipoRepository.findByIdUncached.mockResolvedValue(existingRow({ listingExchanges: ['NSE'], faceValue: 90 }));

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      existingRow({ listingExchanges: ['NSE'], faceValue: 100 })
    );

    expect(ipoRepository.findByIdUncached).toHaveBeenCalledWith('ipo-1');
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.faceValue).toBe(100);
  });

  it('uncached re-read also equals the payload => update is NOT called (still a real no-op)', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN', faceValue: 2 }, 0));
    const ipoRepository = makeIpoRepository();
    ipoRepository.findByIdUncached.mockResolvedValue(existingRow({ listingExchanges: ['NSE'], faceValue: 2 }));

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      existingRow({ listingExchanges: ['NSE'], faceValue: 2 })
    );

    expect(ipoRepository.update).not.toHaveBeenCalled();
  });

  it('uncached re-read throwing is non-fatal — falls back to the already-resolved row', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ status: 'OPEN', faceValue: 2 }, 0));
    const ipoRepository = makeIpoRepository();
    ipoRepository.findByIdUncached.mockRejectedValue(new Error('DB unreachable'));

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE' }),
      'NSE',
      existingRow({ listingExchanges: ['NSE'], faceValue: 2 })
    );

    // Falls back to diffing against the resolved row (identical) => no-op, no throw.
    expect(ipoRepository.update).not.toHaveBeenCalled();
  });
});

describe('round-4 L3: the write-diff gate compares pg `date` columns by calendar day', () => {
  it('a date-only string equals a full-timestamp Date on the SAME UTC calendar day', () => {
    expect(valuesEqualForWrite('2026-09-01', new Date('2026-09-01T00:00:00Z'), 'listingDate')).toBe(true);
    expect(valuesEqualForWrite('2026-09-01', new Date('2026-09-01T18:45:00Z'), 'openDate')).toBe(true);
    expect(diffFieldsForWrite({ closeDate: new Date('2026-09-01T18:45:00Z') }, { closeDate: '2026-09-01' })).toEqual([]);
  });

  it('a date-only string differs from a Date on a DIFFERENT calendar day', () => {
    expect(valuesEqualForWrite('2026-09-01', new Date('2026-09-02T00:00:00Z'), 'listingDate')).toBe(false);
    expect(diffFieldsForWrite({ allotmentDate: new Date('2026-09-02T00:00:00Z') }, { allotmentDate: '2026-09-01' })).toEqual(['allotmentDate']);
  });

  it('two full timestamps a minute apart on a non-date-only field are STILL a change (unaffected by the calendar-day rule)', () => {
    expect(valuesEqualForWrite(new Date('2026-09-01T09:00:00Z'), new Date('2026-09-01T09:01:00Z'))).toBe(false);
  });
});

describe('round-3 M3: the WRITE gate uses exact normalized equality (stricter than areEquivalent)', () => {
  it('100.00 vs 100.01 IS a change (areEquivalent tolerates 0.01; the write gate does not)', () => {
    expect(valuesEqualForWrite(100.0, 100.01)).toBe(false);
    expect(diffFieldsForWrite({ faceValue: 100.01 }, { faceValue: 100.0 })).toEqual(['faceValue']);
  });

  it('the same date with a different time IS a change (areEquivalent compares day-only)', () => {
    const morning = new Date('2026-09-03T09:00:00.000Z');
    const afternoon = new Date('2026-09-03T14:00:00.000Z');
    expect(valuesEqualForWrite(morning, afternoon)).toBe(false);
    expect(valuesEqualForWrite(morning, new Date('2026-09-03T09:00:00.000Z'))).toBe(true);
  });

  it('"6800000000.00" vs 6800000000 is NOT a change (pure pg NUMERIC representation)', () => {
    expect(valuesEqualForWrite('6800000000.00', 6800000000)).toBe(true);
    expect(diffFieldsForWrite({ issueSize: 6800000000 }, { issueSize: '6800000000.00' })).toEqual([]);
  });

  it('bookkeeping fields never make a write, and undefined never counts as a change', () => {
    expect(
      diffFieldsForWrite(
        { lastScrapedAt: new Date(), updatedAt: new Date(), registrarId: undefined },
        { lastScrapedAt: new Date(0), updatedAt: new Date(0), registrarId: null }
      )
    ).toEqual([]);
  });

  it('exchange lists compare as order-insensitive sets; a gained exchange is a change', () => {
    expect(valuesEqualForWrite(['BSE', 'NSE'], ['NSE', 'BSE'])).toBe(true);
    expect(valuesEqualForWrite(['NSE', 'BSE'], ['NSE'])).toBe(false);
  });
});
