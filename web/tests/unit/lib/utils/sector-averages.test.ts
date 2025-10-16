/**
 * Unit Tests: getSectorAverage Utility
 *
 * Tests for sector average calculation utility (Story 6.3)
 * Coverage: Database queries, caching, error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSectorAverage, invalidateSectorAverageCache } from '@/lib/utils/sector-averages';

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
  })),
}));

// Import mocked dependencies
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('getSectorAverage', () => {
  let mockRedis: any;
  let mockDb: any;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    mockRedis = {
      get: vi.fn(),
      setex: vi.fn(),
      del: vi.fn(),
      keys: vi.fn(),
    };

    mockDb = {
      select: vi.fn(() => mockDb),
      from: vi.fn(() => mockDb),
      innerJoin: vi.fn(() => mockDb),
      where: vi.fn(() => Promise.resolve([{ average: '15.75' }])),
    };

    (getRedisClient as any).mockReturnValue(mockRedis);
    (db.select as any).mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Cache Behavior', () => {
    it('returns cached value if available', async () => {
      mockRedis.get.mockResolvedValue('15.75');

      const result = await getSectorAverage('Technology');

      expect(result).toBe(15.75);
      expect(mockRedis.get).toHaveBeenCalledWith(
        'sector:average:listing-gain:Technology'
      );
      // Should not query database if cache hit
      expect(mockDb.where).not.toHaveBeenCalled();
    });

    it('queries database on cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await getSectorAverage('Technology');

      expect(result).toBe(15.75);
      expect(mockRedis.get).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('caches result with 7-day TTL after database query', async () => {
      mockRedis.get.mockResolvedValue(null);

      await getSectorAverage('Technology');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'sector:average:listing-gain:Technology',
        604800, // 7 days in seconds
        '15.75'
      );
    });
  });

  describe('Database Query', () => {
    it('calculates sector average correctly with sample data', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.where.mockResolvedValue([{ average: '12.5' }]);

      const result = await getSectorAverage('Healthcare');

      expect(result).toBe(12.5);
    });

    it('returns 0 if no data for sector', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.where.mockResolvedValue([{ average: null }]);

      const result = await getSectorAverage('NonExistentSector');

      expect(result).toBe(0);
    });

    it('returns 0 for empty sector name', async () => {
      const result = await getSectorAverage('');

      expect(result).toBe(0);
      expect(mockRedis.get).not.toHaveBeenCalled();
      expect(mockDb.where).not.toHaveBeenCalled();
    });

    it('returns 0 for whitespace-only sector name', async () => {
      const result = await getSectorAverage('   ');

      expect(result).toBe(0);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('returns 0 on database error', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.where.mockRejectedValue(new Error('Database connection failed'));

      const result = await getSectorAverage('Technology');

      expect(result).toBe(0);
    });

    it('returns 0 on cache error', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));
      mockDb.where.mockResolvedValue([{ average: '15.75' }]);

      const result = await getSectorAverage('Technology');

      // Should still query database despite cache error
      expect(result).toBe(15.75);
    });

    it('handles cache set error gracefully', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockRejectedValue(new Error('Redis write failed'));
      mockDb.where.mockResolvedValue([{ average: '15.75' }]);

      const result = await getSectorAverage('Technology');

      // Should return result despite cache write error
      expect(result).toBe(15.75);
    });
  });

  describe('Different Sectors', () => {
    const sectors = [
      { name: 'Technology', average: '18.5' },
      { name: 'Healthcare', average: '12.3' },
      { name: 'Finance', average: '8.7' },
      { name: 'Real Estate', average: '-2.5' },
      { name: 'Energy', average: '15.0' },
    ];

    sectors.forEach(({ name, average }) => {
      it(`calculates average for ${name} sector`, async () => {
        mockRedis.get.mockResolvedValue(null);
        mockDb.where.mockResolvedValue([{ average }]);

        const result = await getSectorAverage(name);

        expect(result).toBe(parseFloat(average));
        expect(mockRedis.setex).toHaveBeenCalledWith(
          `sector:average:listing-gain:${name}`,
          604800,
          average
        );
      });
    });
  });

  describe('Negative Averages', () => {
    it('handles negative sector averages', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.where.mockResolvedValue([{ average: '-5.25' }]);

      const result = await getSectorAverage('Real Estate');

      expect(result).toBe(-5.25);
    });
  });
});

describe('invalidateSectorAverageCache', () => {
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRedis = {
      del: vi.fn(),
      keys: vi.fn(),
    };

    (getRedisClient as any).mockReturnValue(mockRedis);
  });

  it('invalidates cache for specific sector', async () => {
    await invalidateSectorAverageCache('Technology');

    expect(mockRedis.del).toHaveBeenCalledWith(
      'sector:average:listing-gain:Technology'
    );
  });

  it('does not invalidate for empty sector', async () => {
    await invalidateSectorAverageCache('');

    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('handles cache deletion errors gracefully', async () => {
    mockRedis.del.mockRejectedValue(new Error('Redis delete failed'));

    // Should not throw error
    await expect(invalidateSectorAverageCache('Technology')).resolves.not.toThrow();
  });
});
