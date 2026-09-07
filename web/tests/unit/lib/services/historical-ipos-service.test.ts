/**
 * Unit tests for historical-ipos-service (T-473 / #201)
 *
 * The service is what lets /history server-render real rows on first paint
 * for its default (no-filter) view instead of shipping an empty client shell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindHistorical = vi.fn();
const mockFindByIPOIds = vi.fn();

vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findHistorical: mockFindHistorical })),
}));
vi.mock('@/lib/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({ findByIPOIds: mockFindByIPOIds })),
}));

import { getHistoricalIPOsData } from '@/lib/services/historical-ipos-service';

describe('getHistoricalIPOsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns enriched rows + pagination meta on a successful repository call', async () => {
    mockFindHistorical.mockResolvedValue({
      data: [
        {
          id: 'ipo-1',
          companyName: 'Real Historical Co Ltd',
          slug: 'real-historical-co-ltd',
          segment: 'MAINBOARD',
          listingDate: '2026-01-10',
          issuePrice: '120.00',
          listingClose: '130.50',
          listingGainPercent: 8.75,
        },
      ],
      meta: { page: 1, limit: 20, total: 1, hasNext: false },
    });
    mockFindByIPOIds.mockResolvedValue([
      { ipoId: 'ipo-1', currentPrice: '135.00', currentGainPercent: 12.5 },
    ]);

    const result = await getHistoricalIPOsData({ year: 'All', sort: 'listing_date', sortOrder: 'desc' });

    expect(result).toBeDefined();
    expect(result?.data).toHaveLength(1);
    expect(result?.data[0].companyName).toBe('Real Historical Co Ltd');
    expect(result?.data[0].currentPriceLive).toBe(135);
    expect(result?.data[0].currentGainLive).toBe(12.5);
    expect(result?.meta).toEqual({ page: 1, limit: 20, total: 1, hasNext: false });
  });

  it('returns undefined (never []) when the repository throws', async () => {
    mockFindHistorical.mockRejectedValue(new Error('db down'));

    const result = await getHistoricalIPOsData({ year: 'All' });

    expect(result).toBeUndefined();
  });

  it('degrades gracefully when the listing-performance enrichment fails', async () => {
    mockFindHistorical.mockResolvedValue({
      data: [{ id: 'ipo-1', companyName: 'X Ltd' }],
      meta: { page: 1, limit: 20, total: 1, hasNext: false },
    });
    mockFindByIPOIds.mockRejectedValue(new Error('lp down'));

    const result = await getHistoricalIPOsData({ year: 'All' });

    expect(result).toBeDefined();
    expect(result?.data[0].currentPriceLive).toBeNull();
  });
});
