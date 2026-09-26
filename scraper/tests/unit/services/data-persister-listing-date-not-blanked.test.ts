/**
 * #70 round 2 — absence is not a value: the merged-record date sanitizer must
 * never write NULL over a stored ipos.listing_date when the merged record simply
 * has none; a present date the sanitizer rejects is still written as NULL.
 *
 * Staging 2026-09-26 (supervisor, read-only): glass-wall-systems-india-ltd and
 * lumino-industries-ltd each have listingDate provenance in field_sources
 * (CHITTORGARH 2026-09-03 / NSE 2026-09-03) yet ipos.listing_date is NULL, with
 * no provenance row for the NULL. The consolidation-update write in
 * data-persister.ts builds `finalData = sanitizeIpoWriteFields(rawConsolidated)`;
 * when sanitizeIpoDates rejects the listing date (validators.ts:451 no open/close,
 * :469 close >= listing) sanitizeIpoWriteFields writes `listingDate: null`
 * (validators.ts:607) and the update blanks the column — a write consolidation
 * never decided and field_sources never saw.
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


describe('#70: absence is not a value, a rejection is', () => {
  beforeEach(() => { vi.clearAllMocks(); resolveRegistrarIdMock.mockReturnValue(null); });

  it('ABSENT: the merged record carries listingDate null -> the stored listing_date is not blanked', async () => {
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({ status: 'LISTED', openDate: '2026-08-27', closeDate: '2026-08-29', listingDate: null }, 1)
    );
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE', status: 'LISTED' }),
      'NSE',
      existingRow({ status: 'LISTED', listingExchanges: ['NSE'], openDate: '2026-08-27', closeDate: '2026-08-29', listingDate: '2026-09-03' })
    );
    const patches = ipoRepository.update.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);
    for (const p of patches) expect(p.listingDate === null).toBe(false);
  });

  it('REJECTED: a present listing date the sanitizer rejects (close >= listing) is still written as NULL', async () => {
    consolidateIPODataMock.mockResolvedValue(
      consolidationResult({ status: 'CLOSED', openDate: '2026-09-09', closeDate: '2026-09-11', listingDate: '2026-09-03' }, 1)
    );
    const ipoRepository = makeIpoRepository();
    await upsertIPO(
      ipoRepository,
      scrape({ listingExchange: 'NSE', status: 'CLOSED', openDate: '2026-09-09', closeDate: '2026-09-11' }),
      'NSE',
      existingRow({ status: 'CLOSED', listingExchanges: ['NSE'], openDate: '2026-09-09', closeDate: '2026-09-11', listingDate: '2026-09-03' })
    );
    const patches = ipoRepository.update.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);
    expect(patches.some((p) => p.listingDate === null)).toBe(true);
  });
});
