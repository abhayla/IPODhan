/**
 * #180 / T-459 — failing-test-first regression guards for both follow-up gaps
 * the T-292C checker found on the real `upsertIPO` UPDATE path (not a
 * re-implementation): the SME/FPO guard only ever rewrote an INCOMING
 * offeringType, never an existing stored FPO value (F1); the hard-date trust
 * guard was gated on `!existingIPO`, so a single non-authoritative source
 * (e.g. MONEYCONTROL) could write open_date/close_date straight through an
 * UPDATE onto a previously-null field (F2).
 *
 * Same harness as data-persister-write-diff.test.ts: consolidation ENABLED,
 * consolidateIPOData mocked to return a controlled consolidatedData snapshot
 * (standing in for "the merged view carries the stored value through since
 * this scrape reported nothing new for this field").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const consolidateIPODataMock = vi.fn();
const resolveRegistrarIdMock = vi.fn().mockReturnValue(null);
const findByFieldMock = vi.fn().mockResolvedValue(null);

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
      findByField: (...args: unknown[]) => findByFieldMock(...args),
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
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

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ipo-180',
    slug: 'western-overseas-study-abroad-ltd',
    symbol: 'WOSA',
    companyName: 'Western Overseas Study Abroad Ltd',
    segment: 'SME',
    offeringType: 'FPO',
    openDate: null,
    closeDate: null,
    status: 'UPCOMING',
    listingExchanges: ['BSE'],
    ...overrides,
  } as any;
}

function scrape(overrides: Record<string, unknown> = {}) {
  return {
    companyName: 'Western Overseas Study Abroad Ltd',
    listingExchange: 'BSE',
    status: 'UPCOMING',
    // offeringType deliberately OMITTED — the real shape of the 3 rows the
    // T-292C checker found (last_scraped_at Dec 2025, zero field_sources rows
    // for offeringType): a scrape that never reports offeringType at all.
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
    findByIdUncached: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
}

function consolidationResult(consolidatedData: Record<string, unknown>) {
  return {
    ipoId: 'ipo-180',
    fieldsProcessed: Object.keys(consolidatedData).length,
    fieldsUpdated: 0,
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

describe('#180 F1 — SME row never keeps a stale FPO across an update that omits offeringType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
    findByFieldMock.mockResolvedValue(null);
  });

  it('existing SME row stored FPO + a scrape omitting offeringType => the update corrects it to IPO (red before the guard extension)', async () => {
    // Consolidation's merged snapshot carries the STORED value through even
    // though this scrape reported nothing new for the field — this is what
    // proved the guard never fired for the 3 real rows (T-292C).
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({ status: 'UPCOMING', offeringType: 'FPO' })
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(ipoRepository, scrape(), 'BSE', existingRow());

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.offeringType).toBe('IPO');
  });

  it('MAINBOARD row stored FPO stays FPO (guard is SME-scoped only)', async () => {
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({ status: 'UPCOMING', offeringType: 'FPO' })
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape(),
      'BSE',
      existingRow({ segment: 'MAINBOARD' })
    );

    // No-op write suppression: nothing actually changed (FPO stays FPO), so
    // either update is not called, or if called, offeringType is unchanged.
    if (ipoRepository.update.mock.calls.length > 0) {
      const [, patch] = ipoRepository.update.mock.calls[0];
      expect(patch.offeringType).not.toBe('IPO');
    }
  });
});

describe('#180 F2 — a single non-authoritative source cannot assert a null hard date on UPDATE either', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
    findByFieldMock.mockResolvedValue(null);
  });

  it('existing row with openDate/closeDate NULL + a single MONEYCONTROL payload => dates are NOT written straight through (red before the fix)', async () => {
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({
        status: 'UPCOMING',
        openDate: '2026-12-01',
        closeDate: '2026-12-04',
      })
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ openDate: '2026-12-01', closeDate: '2026-12-04' }),
      'MONEYCONTROL',
      existingRow({ segment: 'MAINBOARD', offeringType: 'IPO', openDate: null, closeDate: null })
    );

    if (ipoRepository.update.mock.calls.length > 0) {
      const [, patch] = ipoRepository.update.mock.calls[0];
      expect(patch.openDate).toBeUndefined();
      expect(patch.closeDate).toBeUndefined();
    }
  });

  it('a SECOND source touching the row (prior field_sources row exists) => the date IS allowed through (corroborated)', async () => {
    findByFieldMock.mockResolvedValue({ id: 'fs-1', fieldName: 'openDate', source: 'MONEYCONTROL' });
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({
        status: 'UPCOMING',
        openDate: '2026-12-01',
        closeDate: '2026-12-04',
      })
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ openDate: '2026-12-01', closeDate: '2026-12-04' }),
      'MONEYCONTROL',
      existingRow({ segment: 'MAINBOARD', offeringType: 'IPO', openDate: null, closeDate: null })
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.openDate).toBeTruthy();
  });

  it('an AUTHORITATIVE source (NSE) writes a null hard date through on the first touch, no corroboration required', async () => {
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({
        status: 'UPCOMING',
        openDate: '2026-12-01',
        closeDate: '2026-12-04',
      })
    );
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ openDate: '2026-12-01', closeDate: '2026-12-04' }),
      'NSE',
      existingRow({ segment: 'MAINBOARD', offeringType: 'IPO', openDate: null, closeDate: null })
    );

    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.openDate).toBeTruthy();
  });
});
