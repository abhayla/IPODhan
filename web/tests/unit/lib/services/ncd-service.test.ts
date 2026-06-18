/**
 * Unit Tests for NCD Service
 *
 * Tests the NCD service layer data fetching and transformation logic.
 *
 * Story 9.6: NCD Issue Page
 *
 * NOTE: the service uses the repository layer directly (Service → Repository),
 * NOT the HTTP api-client. These tests mock `IPORepository.findAll` accordingly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNCDIssues, clearNCDCache } from '@/lib/services/ncd-service';
import * as redisClient from '@/lib/cache/redis-client';

// The service constructs `new IPORepository(db, redis).findAll(...)`; mock it.
const mockFindAll = vi.fn();
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client');
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));

// Repository findAll returns a paginated envelope; build one from rows.
const paginated = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, limit: 100, total: rows.length, hasMore: false },
});

const EXPECTED_FILTER = {
  segment: ['MAINBOARD'],
  offeringType: 'NCD',
  limit: 100,
  sortBy: 'openDate',
  sortOrder: 'desc',
  page: 1,
};

describe('NCD Service', () => {
  beforeEach(() => {
    // NOTE: do NOT use vi.restoreAllMocks() here — it wipes the IPORepository
    // factory's mockImplementation, leaving later tests with a no-op repo.
    vi.clearAllMocks();
    mockFindAll.mockReset();
    vi.mocked(redisClient.safeGet).mockResolvedValue(null);
    vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);
  });

  describe('getNCDIssues()', () => {
    it('should fetch NCD issues from the repository with correct filter', async () => {
      const rows = [
        {
          id: '1',
          companyName: 'Test Company NCD',
          slug: 'test-company-ncd',
          status: 'UPCOMING',
          openDate: '2025-03-15',
          closeDate: '2025-03-20',
          priceRangeMax: 1000,
          issueSize: '5000',
        },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getNCDIssues();

      expect(mockFindAll).toHaveBeenCalledWith(EXPECTED_FILTER);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '1',
        companyName: 'Test Company NCD',
        slug: 'test-company-ncd',
        openDate: '2025-03-15',
        closeDate: '2025-03-20',
        issuePrice: 1000, // transformNCDData maps priceRangeMax → issuePrice
      });
    });

    it('should return empty array on repository error (graceful degradation)', async () => {
      mockFindAll.mockRejectedValue(new Error('DB Error'));

      const result = await getNCDIssues();

      expect(result).toEqual([]);
      expect(mockFindAll).toHaveBeenCalledWith(EXPECTED_FILTER);
    });

    it('should request descending openDate sort from the repository and preserve its order', async () => {
      // Sorting is delegated to the repository (sortBy/sortOrder); the service
      // returns the repo order unchanged. Verify the params + order passthrough.
      const rows = [
        { id: '1', companyName: 'NCD March', slug: 'ncd-march', status: 'UPCOMING', openDate: '2025-03-15', closeDate: '2025-03-20', priceRangeMax: 1000, issueSize: '5000' },
        { id: '3', companyName: 'NCD February', slug: 'ncd-february', status: 'UPCOMING', openDate: '2025-02-20', closeDate: '2025-02-25', priceRangeMax: 1000, issueSize: '4000' },
        { id: '2', companyName: 'NCD January', slug: 'ncd-january', status: 'UPCOMING', openDate: '2025-01-10', closeDate: '2025-01-15', priceRangeMax: 1000, issueSize: '3000' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getNCDIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'openDate', sortOrder: 'desc' })
      );
      expect(result.map((r) => r.companyName)).toEqual([
        'NCD March',
        'NCD February',
        'NCD January',
      ]);
    });

    it('should use Redis cache when available (and not hit the repository)', async () => {
      const cachedData = [
        {
          id: '1',
          companyName: 'Cached NCD',
          slug: 'cached-ncd',
          openDate: '2025-03-15',
          closeDate: '2025-03-20',
          issuePrice: 1000,
          issueSize: '5000',
          status: 'UPCOMING',
        },
      ];
      vi.mocked(redisClient.safeGet).mockResolvedValue(JSON.stringify(cachedData));

      const result = await getNCDIssues();

      expect(redisClient.safeGet).toHaveBeenCalledWith('ncd:all');
      expect(mockFindAll).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should handle items with null dates gracefully', async () => {
      const rows = [
        { id: '1', companyName: 'NCD With Dates', slug: 'ncd-with-dates', status: 'UPCOMING', openDate: '2025-03-15', closeDate: '2025-03-20', priceRangeMax: 1000, issueSize: '5000' },
        { id: '2', companyName: 'NCD Without Dates', slug: 'ncd-without-dates', status: 'UPCOMING', openDate: null, closeDate: null, priceRangeMax: 1000, issueSize: '3000' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getNCDIssues();

      expect(result).toHaveLength(2);
      expect(result[1].openDate).toBeNull();
      expect(result[1].closeDate).toBeNull();
    });
  });

  describe('clearNCDCache()', () => {
    it('should clear NCD cache using Redis del command', async () => {
      const mockRedis = { del: vi.fn().mockResolvedValue(1) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);

      await clearNCDCache();

      expect(redisClient.getRedisClient).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('ncd:all');
    });

    it('should handle Redis errors gracefully', async () => {
      const mockRedis = { del: vi.fn().mockRejectedValue(new Error('Redis Error')) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);

      await expect(clearNCDCache()).resolves.not.toThrow();
    });
  });
});
