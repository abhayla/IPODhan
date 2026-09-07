/**
 * T-478 round 2 (issue #225 follow-up, Tier A CRITICAL): a Tier-A review of
 * PR #362 found that `resolveIpoRow` (packages/shared/src/repositories/ipo-identity.ts)
 * had no offering_type guard, so an incoming OFS record for a listed company
 * matched the company's historical IPO row by symbol (tier 2), and
 * `resolveOfferingTypeKeepingClassification` (data-persister.ts) then flipped
 * the real IPO row's offering_type to OFS, stomping its dates/prices/status
 * (the T-292/Mopshop class). This test exercises the REAL `resolveIpoRow`
 * AND the real `upsertIPO` offering_type resolution end-to-end — no upsert
 * mock — asserting the fix at both ends: (1) identity never crosses the
 * OFS/IPO boundary, (2) a genuinely new OFS row gets a distinct
 * `-ofs-<year>` slug so it can never collide with the IPO row's slug.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bulkTrackFieldUpdatesMock = vi.fn().mockResolvedValue(1);

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
}));

vi.mock('@ipodhan/shared/db/schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared/db/schema')>()),
  ipoDemandGraph: {},
}));

vi.mock('@ipodhan/shared/utils/registrar-matcher', () => ({
  resolveRegistrarId: () => null,
}));

vi.mock('@ipodhan/shared/repositories', async (importOriginal) => {
  // Keep the REAL resolveIpoRow (and its real OFS/IPO identity guard) — a
  // hand-copied mock would defeat the entire point of this test.
  const actual = await importOriginal<typeof import('@ipodhan/shared/repositories')>();
  return {
    ...actual,
    FieldSourcesRepository: vi.fn().mockImplementation(() => ({
      bulkTrackFieldUpdates: bulkTrackFieldUpdatesMock,
    })),
    DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
    RegistrarRepository: vi.fn().mockImplementation(() => ({
      findAll: vi.fn().mockResolvedValue([]),
    })),
  };
});

// Legacy fallback-update path (ENABLE_DATA_CONSOLIDATION: false) is the
// simplest way to observe "existingIPO was found -> update, not create"
// without also mocking the full consolidation service.
vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_DATA_CONSOLIDATION: false,
    ENABLE_SOURCE_TRACKING: true,
  },
  shouldUseFeature: () => false,
}));

vi.mock('../../../src/services/data-consolidation-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/data-consolidation-service.js')>()),
  DataConsolidationService: vi.fn(),
}));

const { upsertIPO, ofsSlugYear } = await import('../../../src/services/data-persister.js');
const { generateSlug } = await import('../../../src/utils/validators.js');

function makeIpoRepository(overrides: Record<string, any> = {}) {
  return {
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'new-ofs-id', slug: 'cochin-shipyard-ofs-2026' }),
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe('upsertIPO — OFS never resolves to the IPO row (T-478 round 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkTrackFieldUpdatesMock.mockResolvedValue(1);
  });

  it('existing row {slug: cochin-shipyard-ltd, offering_type: IPO} + incoming OFS "Cochin Shipyard" -> a NEW row with a distinct -ofs-<year> slug; the IPO row is never touched', async () => {
    const existingIpoRow = {
      id: 'existing-cochin-ipo',
      slug: 'cochin-shipyard-ltd',
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      listingExchanges: ['NSE'],
    };
    const ipoRepository = makeIpoRepository({
      // Tier 2 (symbol) is exactly the tier the Tier-A finding walked
      // through — the real bug path. Arg-aware: a real offering_type-filtered
      // retry query (item 2) finds nothing for 'OFS' since only an IPO row
      // exists under this symbol.
      findBySymbol: vi.fn(async (_symbol: string, offeringType?: string) =>
        !offeringType || offeringType === 'IPO' ? existingIpoRow : null
      ),
    });

    const scrapedOfs = {
      companyName: 'Cochin Shipyard',
      symbol: 'COCHINSHIP',
      openDate: '2026-09-10',
      closeDate: '2026-09-12',
      listingExchange: 'NSE',
      segment: 'MAINBOARD',
      offeringType: 'OFS',
      offeringTypeExplicit: true,
      status: 'UPCOMING',
    } as any;

    const resultId = await upsertIPO(ipoRepository, scrapedOfs, 'NSE');

    // The identity guard must decline the symbol match — a create, not an
    // update against the IPO row.
    expect(ipoRepository.update).not.toHaveBeenCalled();
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.offeringType).toBe('OFS');
    const expectedSlug = `${generateSlug('Cochin Shipyard')}-ofs-${ofsSlugYear(scrapedOfs)}`;
    expect(created.slug).toBe(expectedSlug);
    expect(created.slug).not.toBe('cochin-shipyard-ltd'); // never collides with the IPO row's slug
    expect(resultId).toBe('new-ofs-id');
  });

  it('reverse: existing row {slug: cochin-shipyard-ofs-2026, offering_type: OFS} + incoming IPO "Cochin Shipyard Limited" -> a NEW/separate row, the OFS row is never touched', async () => {
    const existingOfsRow = {
      id: 'existing-cochin-ofs',
      slug: 'cochin-shipyard-ofs-2026',
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      segment: 'MAINBOARD',
      offeringType: 'OFS',
      listingExchanges: ['NSE'],
    };
    const ipoRepository = makeIpoRepository({
      // Real findBySymbol(symbol, offeringType?) FILTERS by offeringType in
      // SQL when given one — an arg-aware mock so the round-3 decline+retry
      // (item 2) is tested honestly: the retry call passes offeringType:'IPO'
      // and a real, offering_type-filtered query would find nothing (only
      // an OFS row exists), not the OFS row itself.
      findBySymbol: vi.fn(async (_symbol: string, offeringType?: string) =>
        !offeringType || offeringType === 'OFS' ? existingOfsRow : null
      ),
    });

    const scrapedIpo = {
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      openDate: '2026-09-10',
      closeDate: '2026-09-15',
      listingExchange: 'NSE',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      offeringTypeExplicit: true,
      status: 'UPCOMING',
    } as any;

    const resultId = await upsertIPO(ipoRepository, scrapedIpo, 'NSE');

    expect(ipoRepository.update).not.toHaveBeenCalled();
    expect(ipoRepository.create).toHaveBeenCalledTimes(1);
    const created = ipoRepository.create.mock.calls[0][0];
    expect(created.offeringType).toBe('IPO');
    expect(created.slug).not.toBe('cochin-shipyard-ofs-2026');
    expect(resultId).toBe('new-ofs-id'); // (mock's fixed create() return id)
  });

  it('a repeat OFS scrape for the SAME company DOES resolve to (and update) its existing OFS row', async () => {
    const existingOfsRow = {
      id: 'existing-cochin-ofs',
      slug: 'cochin-shipyard-ofs-2026',
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      segment: 'MAINBOARD',
      offeringType: 'OFS',
      listingExchanges: ['NSE'],
      allotmentDate: null,
      listingDate: null,
    };
    const ipoRepository = makeIpoRepository({
      findBySymbol: vi.fn().mockResolvedValue(existingOfsRow),
    });

    const scrapedOfs = {
      companyName: 'Cochin Shipyard',
      symbol: 'COCHINSHIP',
      openDate: '2026-09-10',
      closeDate: '2026-09-12',
      listingExchange: 'NSE',
      segment: 'MAINBOARD',
      offeringType: 'OFS',
      offeringTypeExplicit: true,
      status: 'OPEN',
    } as any;

    const resultId = await upsertIPO(ipoRepository, scrapedOfs, 'NSE');

    expect(ipoRepository.create).not.toHaveBeenCalled();
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update.mock.calls[0][0]).toBe('existing-cochin-ofs');
    expect(resultId).toBe('existing-cochin-ofs');
  });

  it('T-478 round 3 CRITICAL regression: a legacy OFS row re-scraped by a DEFAULTED-IPO record (offeringTypeExplicit unset, the hard-default every non-OFS-endpoint source ships) resolves to the OFS row - no create, no 23505', async () => {
    const existingOfsRow = {
      id: 'existing-cochin-ofs',
      slug: 'cochin-shipyard-ofs-2026',
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      segment: 'MAINBOARD',
      offeringType: 'OFS',
      listingExchanges: ['NSE'],
      allotmentDate: null,
      listingDate: null,
    };
    const ipoRepository = makeIpoRepository({
      findBySymbol: vi.fn().mockResolvedValue(existingOfsRow),
    });

    // Exactly the shape moneycontrol-scraper.ts / bse-api-scraper.ts /
    // chittorgarh-scraper.ts / nse-api-client.ts's non-OFS branch emit:
    // offeringType: 'IPO' with NO offeringTypeExplicit at all.
    const defaultedIpoScrape = {
      companyName: 'Cochin Shipyard Limited',
      symbol: 'COCHINSHIP',
      openDate: '2026-09-10',
      closeDate: '2026-09-15',
      listingExchange: 'NSE',
      segment: 'MAINBOARD',
      offeringType: 'IPO',
      status: 'UPCOMING',
    } as any;

    const resultId = await upsertIPO(ipoRepository, defaultedIpoScrape, 'NSE');

    expect(ipoRepository.create).not.toHaveBeenCalled(); // no 23505-causing collision attempt
    expect(ipoRepository.update).toHaveBeenCalledTimes(1);
    expect(ipoRepository.update.mock.calls[0][0]).toBe('existing-cochin-ofs');
    // resolveOfferingTypeKeepingClassification protects the stored 'OFS'
    // classification from being demoted back to the defaulted 'IPO'.
    expect(ipoRepository.update.mock.calls[0][1].offeringType).toBe('OFS');
    expect(resultId).toBe('existing-cochin-ofs');
  });
});
