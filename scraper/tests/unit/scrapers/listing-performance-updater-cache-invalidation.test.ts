import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * F1 (T-264 P1-4) — updateListingPerformance() is the write that produces the
 * issue price / listing gain % rendered on /history, but nothing purged
 * `ipos:history:*` afterward, so a stale (up to 24h) snapshot could survive
 * a real write. This test proves the fix is event-driven: the history cache
 * is purged only when the cycle actually changed something.
 */

const mockRedisClient = { __marker: 'redis' };
const mockUpsert = vi.fn().mockResolvedValue(undefined);
const invalidateHistoryCache = vi.fn().mockResolvedValue(undefined);

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
  invalidateHistoryCache,
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

const oneListedIPO = {
  id: 'ipo-1',
  companyName: 'Test Co',
  slug: 'test-co',
  symbol: 'TEST',
  isin: 'INE000000001',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'LISTED',
  openDate: '2026-01-01',
  closeDate: '2026-01-03',
  listingDate: '2026-01-10',
  priceRangeMax: 100,
  issueSize: '10.00',
};

const planRecord = {
  ipo: oneListedIPO,
  record: { ipoId: 'ipo-1', listingPrice: '105', issuePrice: '100', listingGainPercent: '5' },
  matchMethod: 'isin',
};

vi.mock('../../../src/scrapers/chittorgarh-listing-scraper.js', () => ({
  fetchChittorgarhListingRows: vi.fn(async () => [{ isin: 'INE000000001' }]),
}));

let planResult: { records: unknown[]; skipped: Array<{ reason: string }> } = {
  records: [],
  skipped: [],
};

vi.mock('../../../src/scrapers/listing-performance-plan.js', () => ({
  planListingPerformanceUpdates: vi.fn(() => planResult),
}));

describe('updateListingPerformance — history cache invalidation (F1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listedIPOs = [oneListedIPO];
    existingPerformanceRecords = [];
    planResult = { records: [], skipped: [] };
  });

  it('purges the history cache when a record is created', async () => {
    planResult = { records: [planRecord], skipped: [] };

    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance();

    expect(result.newRecordsCreated).toBe(1);
    expect(invalidateHistoryCache).toHaveBeenCalledTimes(1);
    expect(invalidateHistoryCache).toHaveBeenCalledWith(mockRedisClient);
  });

  it('purges the history cache when an existing record is updated', async () => {
    existingPerformanceRecords = [{ ipoId: 'ipo-1' }];
    planResult = { records: [planRecord], skipped: [] };

    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance();

    expect(result.recordsUpdated).toBe(1);
    expect(invalidateHistoryCache).toHaveBeenCalledTimes(1);
  });

  it('does NOT purge the history cache when nothing changed (all skipped)', async () => {
    planResult = { records: [], skipped: [{ reason: 'no-listing-price' }] };

    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance();

    expect(result.newRecordsCreated).toBe(0);
    expect(result.recordsUpdated).toBe(0);
    expect(invalidateHistoryCache).not.toHaveBeenCalled();
  });

  it('does NOT purge the history cache when the write fails', async () => {
    mockUpsert.mockRejectedValueOnce(new Error('db down'));
    planResult = { records: [planRecord], skipped: [] };

    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance();

    expect(result.failures).toBe(1);
    expect(result.newRecordsCreated).toBe(0);
    expect(result.recordsUpdated).toBe(0);
    expect(invalidateHistoryCache).not.toHaveBeenCalled();
  });
});
