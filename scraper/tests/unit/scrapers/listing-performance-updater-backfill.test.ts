import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P3-8 (round-4 review, T-293): the review evidence claimed "the weekend
 * cadence refreshes existing rows but never back-fills missing ones". This
 * test proves that claim is FALSE for the code as it stands (fixed earlier by
 * #139/T-264, commit 1dd6f600): `updateListingPerformance()` queries ALL
 * LISTED IPOs (not just ones that already have a listing_performance row) and
 * calls `repository.upsert()` — a real `INSERT ... ON CONFLICT DO UPDATE`
 * (see `ListingPerformanceRepository.upsert`) — for every planned record,
 * regardless of whether a row already exists. `newRecordsCreated` and
 * `recordsUpdated` are independently derived from the SAME upsert call by
 * checking membership in `existingIPOIds` — see `listing-performance-
 * updater.ts` Step 5 — so a mixed cycle (one IPO missing its row, one IPO
 * already has one) creates AND updates in the same pass, not either/or.
 *
 * Live-DB verification (2026-08-23, tunnel query): of the 4 LISTED IPOs the
 * round-4 review named as gaps, 3 (KWALITY WALLS, Sri Priyanka Geo Commex,
 * Twinkle Papers) are genuinely ABSENT from Chittorgarh report-25's raw JSON
 * (confirmed by a direct fetch bypassing the plan's match step) — a source-
 * coverage gap, not a code defect this mechanism can fix. See T-293 PR notes
 * / filed issue for the source-absence finding.
 */

const mockRedisClient = { __marker: 'redis' };
const mockUpsert = vi.fn().mockResolvedValue(undefined);

vi.mock('@ipodhan/shared/cache/redis-client', () => ({
  getRedisClient: () => mockRedisClient,
}));

vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({
    upsert: mockUpsert,
  })),
}));

vi.mock('@ipodhan/shared/errors/db-cause', () => ({
  describeDbCause: (error: unknown) => ({
    code: undefined,
    column: undefined,
    constraint: undefined,
    detail: undefined,
    chain: error instanceof Error ? error.message : String(error),
  }),
}));

vi.mock('../../../src/services/cache-invalidator.js', () => ({
  invalidateHistoryCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let listedIPOs: unknown[] = [];
let existingPerformanceRecords: unknown[] = [];

vi.mock('@ipodhan/shared/db', () => ({
  db: {
    query: {
      ipos: { findMany: vi.fn(async () => listedIPOs) },
      listingPerformance: { findMany: vi.fn(async () => existingPerformanceRecords) },
    },
  },
}));

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: { status: 'status' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ a, b }),
}));

const missingRowIpo = {
  id: 'ipo-missing',
  companyName: 'Kwality Walls (India) Ltd',
  slug: 'kwality-walls-india-ltd',
  symbol: 'KWIL',
  isin: 'INE2KCE01013',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'LISTED',
  openDate: '2026-04-23',
  closeDate: '2026-05-07',
  listingDate: '2026-02-16',
  priceRangeMax: 21,
  issueSize: '13030363240.00',
};

const existingRowIpo = {
  id: 'ipo-existing',
  companyName: 'Already Listed Ltd.',
  slug: 'already-listed-ltd',
  symbol: 'ALREADY',
  isin: 'INE000000099',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'LISTED',
  openDate: '2026-01-01',
  closeDate: '2026-01-03',
  listingDate: '2026-01-10',
  priceRangeMax: 100,
  issueSize: '10.00',
};

vi.mock('../../../src/scrapers/chittorgarh-listing-scraper.js', () => ({
  fetchChittorgarhListingRows: vi.fn(async () => [
    { isin: missingRowIpo.isin },
    { isin: existingRowIpo.isin },
  ]),
}));

let planResult: { records: unknown[]; skipped: Array<{ reason: string }> } = {
  records: [],
  skipped: [],
};

vi.mock('../../../src/scrapers/listing-performance-plan.js', () => ({
  planListingPerformanceUpdates: vi.fn(() => planResult),
}));

describe('updateListingPerformance — backfills missing rows AND refreshes existing ones in the same cycle (P3-8, T-293)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listedIPOs = [missingRowIpo, existingRowIpo];
    // Only `existingRowIpo` already has a listing_performance row — exactly
    // the mixed scenario the round-4 review claimed the job could not handle.
    existingPerformanceRecords = [{ ipoId: existingRowIpo.id }];
    planResult = {
      records: [
        { ipo: missingRowIpo, matchMethod: 'isin', record: { ipoId: missingRowIpo.id, listingPrice: '120', issuePrice: '100', listingGainPercent: '20' } },
        { ipo: existingRowIpo, matchMethod: 'isin', record: { ipoId: existingRowIpo.id, listingPrice: '150', issuePrice: '100', listingGainPercent: '50' } },
      ],
      skipped: [],
    };
  });

  it('calls repository.upsert() for the MISSING row (backfill), not only the existing one', async () => {
    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance();

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ ipoId: missingRowIpo.id }));
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ ipoId: existingRowIpo.id }));
    // Independently counted: one CREATE, one UPDATE, from the SAME cycle.
    expect(result.newRecordsCreated).toBe(1);
    expect(result.recordsUpdated).toBe(1);
    expect(result.failures).toBe(0);
  });
});
