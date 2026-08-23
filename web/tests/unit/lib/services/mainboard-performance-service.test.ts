/**
 * Unit tests for mainboard-performance-service (T-302 / P3-13)
 *
 * The service is what lets `/mainboard-ipo-performance-tracker` server-render
 * real rows on first paint instead of shipping an empty client shell.
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

import { getMainboardPerformanceData, getSMEPerformanceData } from '@/lib/services/mainboard-performance-service';

describe('getMainboardPerformanceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only MAINBOARD rows with a real (non-null) listing gain', async () => {
    mockFindHistorical.mockResolvedValue({
      data: [
        {
          id: 'mb-1',
          companyName: 'Real Mainboard Co Ltd',
          slug: 'real-mainboard-co-ltd',
          segment: 'MAINBOARD',
          listingDate: '2026-01-10',
          issuePrice: '120.00',
          listingClose: '130.50',
          listingGainPercent: 8.75,
        },
        {
          id: 'sme-1',
          companyName: 'Real SME Co Ltd',
          slug: 'real-sme-co-ltd',
          segment: 'SME',
          listingDate: '2026-01-05',
          issuePrice: '60.00',
          listingClose: '65.00',
          listingGainPercent: 8.33,
        },
        {
          id: 'no-perf',
          companyName: 'No Performance Data Ltd',
          slug: 'no-performance-data-ltd',
          segment: 'MAINBOARD',
          listingDate: '2026-01-08',
          issuePrice: null,
          listingClose: null,
          listingGainPercent: null,
        },
      ],
      meta: { page: 1, limit: 100, total: 3, hasNext: false },
    });
    mockFindByIPOIds.mockResolvedValue([
      { ipoId: 'mb-1', currentPrice: '145.20', currentGainPercent: '21.00' },
    ]);

    const result = await getMainboardPerformanceData('2026');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'mb-1',
      companyName: 'Real Mainboard Co Ltd',
      currentPrice: 145.2,
      profitLoss: 21,
    });
  });

  it('F4: returns undefined (never throws, never a false-empty []) when the repository errors', async () => {
    // T-302C checker F4: `[]` must mean "genuinely zero rows". Returning `[]`
    // on error made the client treat a transient DB/Redis failure as
    // "server data present, zero rows" and skip its own client-side fetch —
    // undefined is the only signal that tells the client to fetch itself.
    mockFindHistorical.mockRejectedValue(new Error('db down'));

    const result = await getMainboardPerformanceData('2026');

    expect(result).toBeUndefined();
  });
});

describe('getSMEPerformanceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only SME rows with a real (non-null) listing gain', async () => {
    mockFindHistorical.mockResolvedValue({
      data: [
        {
          id: 'sme-1',
          companyName: 'Real SME Co Ltd',
          slug: 'real-sme-co-ltd',
          segment: 'SME',
          listingDate: '2026-01-05',
          issuePrice: '60.00',
          listingClose: '65.00',
          listingGainPercent: 8.33,
        },
        {
          id: 'mb-1',
          companyName: 'Real Mainboard Co Ltd',
          slug: 'real-mainboard-co-ltd',
          segment: 'MAINBOARD',
          listingDate: '2026-01-10',
          issuePrice: '120.00',
          listingClose: '130.50',
          listingGainPercent: 8.75,
        },
      ],
      meta: { page: 1, limit: 100, total: 2, hasNext: false },
    });
    mockFindByIPOIds.mockResolvedValue([]);

    const result = await getSMEPerformanceData('2026');

    expect(result).toHaveLength(1);
    expect(result[0].companyName).toBe('Real SME Co Ltd');
  });

  it('F4: returns undefined (never a false-empty []) when the repository errors', async () => {
    mockFindHistorical.mockRejectedValue(new Error('db down'));

    const result = await getSMEPerformanceData('2026');

    expect(result).toBeUndefined();
  });
});
