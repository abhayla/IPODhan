/**
 * #70 — the listing job reads CLOSED rows too, writes ipos (LISTED + listing
 * date) BEFORE the listing row, and writes the listing row with the date ipos
 * actually stored, or not at all. Before the fix it read `status = 'LISTED'`
 * only, so glass-wall-systems-india-ltd / lumino-industries-ltd (listing rows
 * 2026-09-16 / 2026-09-03 on staging) stayed CLOSED with listing_date NULL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: string[] = [];
const mockUpsert = vi.fn(async (rec: { ipoId: string }) => { calls.push(`lp:${rec.ipoId}`); });
let findManyArgs: unknown[] = [];

vi.mock('@ipodhan/shared/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({ upsert: mockUpsert })),
}));
vi.mock('@ipodhan/shared/errors/db-cause', () => ({
  describeDbCause: (e: unknown) => ({ chain: String(e) }),
}));
vi.mock('../../../src/services/cache-invalidator.js', () => ({ invalidateHistoryCache: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const glassWall = {
  id: 'glass-wall', companyName: 'Glass Wall Systems India Ltd.', slug: 'glass-wall-systems-india-ltd',
  symbol: null, isin: null, segment: 'SME', offeringType: 'IPO', status: 'CLOSED',
  openDate: '2026-09-09', closeDate: '2026-09-11', listingDate: null, priceRangeMax: 200, issueSize: 40,
};

vi.mock('@ipodhan/shared/db', () => ({
  db: {
    query: {
      ipos: { findMany: vi.fn(async (args: unknown) => { findManyArgs.push(args); return [glassWall]; }) },
      listingPerformance: { findMany: vi.fn(async () => []) },
    },
  },
}));
vi.mock('@ipodhan/shared/db/schema', () => ({ ipos: { status: 'status' } }));
vi.mock('drizzle-orm', () => ({
  eq: (a: unknown, b: unknown) => ({ op: 'eq', a, b }),
  inArray: (a: unknown, b: unknown) => ({ op: 'inArray', a, b }),
}));
vi.mock('../../../src/scrapers/chittorgarh-listing-scraper.js', () => ({
  fetchChittorgarhListingRows: vi.fn(async () => [{
    companyName: 'Glass Wall Systems India Ltd.', slug: 'glass-wall-systems-india-ltd', isin: null,
    bseScripCode: null, nseSymbol: 'GLASSWALL', listingDate: '16-Sep-2026', issuePrice: 200,
    listingClose: 214.85, listingGainPct: 7.43, currentBse: null, currentNse: 220, currentGainPct: 10,
  }]),
}));

describe('#70: updateListingPerformance advances a CLOSED IPO whose listing it knows', () => {
  beforeEach(() => { calls.length = 0; findManyArgs = []; mockUpsert.mockClear(); });

  it('reads LISTED and CLOSED rows', async () => {
    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    await updateListingPerformance({ now: new Date('2026-09-26T06:00:00Z'), advanceListing: async () => ({ storedListingDate: '2026-09-16', storedStatus: 'LISTED' }) });
    expect(findManyArgs[0]).toMatchObject({ where: { op: 'inArray', a: 'status', b: ['LISTED', 'CLOSED'] } });
  });

  it('writes ipos first, then the listing row carrying the stored ipos date', async () => {
    const advanceListing = vi.fn(async (ipo: { id: string }, scraped: { status: string; listingDate: string }) => {
      calls.push(`ipos:${ipo.id}:${scraped.status}:${scraped.listingDate}`);
      return { storedListingDate: '2026-09-16', storedStatus: 'LISTED' };
    });
    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance({ now: new Date('2026-09-26T06:00:00Z'), advanceListing });

    expect(calls).toEqual(['ipos:glass-wall:LISTED:2026-09-16', 'lp:glass-wall']);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ ipoId: 'glass-wall', listingDate: '2026-09-16', listingPrice: 214.85 }));
    expect(result.advancedToListed).toEqual(['glass-wall-systems-india-ltd']);
    expect(result.totalListedIPOs).toBe(0);
    expect(result.failures).toBe(0);
  });

  it('writes NO listing row when ipos did not take the date', async () => {
    const { updateListingPerformance } = await import('../../../src/scrapers/listing-performance-updater.js');
    const result = await updateListingPerformance({
      now: new Date('2026-09-26T06:00:00Z'),
      advanceListing: async () => ({ storedListingDate: null, storedStatus: 'CLOSED' }),
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.advancedToListed).toEqual([]);
  });
});
