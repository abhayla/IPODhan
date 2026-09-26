/**
 * #938 echo — a listing exchange re-sent as CONTEXT is never re-claimed.
 *
 * `filing-persister.ts` seeds its `upsertIPO` payload with the STORED row's
 * boards (`scraped.listingExchange = 'BOTH'` for a two-board row, else the one
 * board) so the row resolves, and declares that key as context (OD-66). But it
 * names the PAYLOAD key, `listingExchange`; `upsertIPO` maps it to
 * `listingExchanges` before `consolidateIPOData`, whose context filter compares
 * keys literally. The stored boards therefore entered consolidation as a fresh
 * DRHP claim (and the persister's own union re-merged them) — the echo of a
 * value is recorded as a new DRHP-sourced value.
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

const { upsertIPO } = await import('../../../src/services/data-persister.js');

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
      chosenSource: 'DRHP',
      hadConflict: false,
    })),
    consolidatedData,
    errors: [],
    performanceMs: 1,
  };
}

describe('#938 echo: the filing persister\'s stored-board echo is context under either key spelling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRegistrarIdMock.mockReturnValue(null);
  });

  const FILING_CONTEXT = ['companyName', 'segment', 'offeringType', 'status', 'listingExchange'];

  it('consolidation is told listingExchanges is context, and the stored board is written unchanged', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ issueSize: 5_000_000_000 }, 1));
    const ipoRepository = makeIpoRepository();

    // A DRHP write whose ONLY claim is issueSize; the row stores ['BSE'] but the
    // echo says BOTH (the filing read a two-board row before a correction).
    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'BOTH', segment: 'MAINBOARD', issueSize: 5_000_000_000 }),
      'DRHP',
      existingRow({ listingExchanges: ['BSE'], segment: 'MAINBOARD' }),
      FILING_CONTEXT
    );

    const call = consolidateIPODataMock.mock.calls[0][0] as { contextFields?: string[] };
    expect(call.contextFields).toEqual(expect.arrayContaining(['listingExchange', 'listingExchanges']));
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.listingExchanges).toEqual(['BSE']);
  });

  it('the legacy fallback door (consolidation threw) does not re-merge the echo either', async () => {
    consolidateIPODataMock.mockRejectedValue(new Error('consolidation exploded'));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'BOTH', segment: 'MAINBOARD', issueSize: 5_000_000_000 }),
      'DRHP',
      existingRow({ listingExchanges: ['BSE'], segment: 'MAINBOARD' }),
      FILING_CONTEXT
    );

    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.listingExchanges).toEqual(['BSE']);
  });

  it('without the context declaration a DRHP BOTH is still a real claim and widens (unchanged)', async () => {
    consolidateIPODataMock.mockResolvedValue(consolidationResult({ issueSize: 5_000_000_000 }, 1));
    const ipoRepository = makeIpoRepository();

    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'BOTH', segment: 'MAINBOARD', issueSize: 5_000_000_000 }),
      'DRHP',
      existingRow({ listingExchanges: ['BSE'], segment: 'MAINBOARD' })
    );

    const call = consolidateIPODataMock.mock.calls[0][0] as { contextFields?: string[] };
    expect(call.contextFields).toBeUndefined();
    const [, patch] = ipoRepository.update.mock.calls[0];
    expect(patch.listingExchanges).toEqual(['BSE', 'NSE']);
  });
});
