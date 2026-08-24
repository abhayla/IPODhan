/**
 * Unit Tests for OFS Service
 *
 * Tests the OFS service layer data fetching and transformation logic.
 *
 * NOTE: the service uses the repository layer directly (Service → Repository),
 * NOT the HTTP api-client. These tests mock `IPORepository.findAll` accordingly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOFSIssues, clearOFSCache } from '@/lib/services/ofs-service';
import * as redisClient from '@/lib/cache/redis-client';

const mockFindAll = vi.fn();
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client');
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));

const paginated = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, limit: 100, total: rows.length, hasMore: false },
});

const EXPECTED_FILTER = {
  segment: ['MAINBOARD'],
  offeringType: 'OFS',
  limit: 100,
  sortBy: 'openDate',
  sortOrder: 'desc', // T-310: most recent first — see root-cause note in ofs-service.ts
  page: 1,
};

describe('OFS Service', () => {
  beforeEach(() => {
    // Do NOT restoreAllMocks — it wipes the IPORepository factory implementation.
    vi.clearAllMocks();
    mockFindAll.mockReset();
    vi.mocked(redisClient.safeGet).mockResolvedValue(null);
    vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);
  });

  describe('getOFSIssues()', () => {
    it('should fetch OFS issues from the repository with correct filter', async () => {
      const rows = [
        {
          id: '1',
          companyName: 'Test Company OFS',
          slug: 'test-company-ofs',
          status: 'UPCOMING',
          openDate: '2025-03-15',
          closeDate: '2025-03-16',
          priceRangeMax: 1000,
          issueSize: '5000',
        },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getOFSIssues();

      expect(mockFindAll).toHaveBeenCalledWith(EXPECTED_FILTER);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '1',
        companyName: 'Test Company OFS',
        slug: 'test-company-ofs',
        nonRetailDate: '2025-03-15', // maps openDate
        retailDate: '2025-03-16', // maps closeDate
        issuePrice: 1000, // maps priceRangeMax
      });
    });

    it('should return empty array on repository error (graceful degradation)', async () => {
      mockFindAll.mockRejectedValue(new Error('DB Error'));

      const result = await getOFSIssues();

      expect(result).toEqual([]);
      expect(mockFindAll).toHaveBeenCalledWith(EXPECTED_FILTER);
    });

    it('T-310: requests descending openDate sort so a 100-row cap cannot hide current data behind old rows', async () => {
      const rows = [
        { id: '1', companyName: 'OFS March', slug: 'ofs-march', status: 'UPCOMING', openDate: '2025-03-15', closeDate: '2025-03-16', priceRangeMax: 1000, issueSize: '5000' },
        { id: '3', companyName: 'OFS February', slug: 'ofs-february', status: 'UPCOMING', openDate: '2025-02-20', closeDate: '2025-02-21', priceRangeMax: 1000, issueSize: '4000' },
        { id: '2', companyName: 'OFS January', slug: 'ofs-january', status: 'UPCOMING', openDate: '2025-01-10', closeDate: '2025-01-11', priceRangeMax: 1000, issueSize: '3000' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getOFSIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'openDate', sortOrder: 'desc' })
      );
      expect(result.map((r) => r.companyName)).toEqual([
        'OFS March',
        'OFS February',
        'OFS January',
      ]);
    });

    it('should use Redis cache when available (and not hit the repository)', async () => {
      const cachedData = [
        { id: '1', companyName: 'Cached OFS', slug: 'cached-ofs', nonRetailDate: '2025-03-15', retailDate: '2025-03-16', openDate: '2025-03-15', closeDate: '2025-03-16', issuePrice: 1000, issueSize: '5000', status: 'UPCOMING' },
      ];
      vi.mocked(redisClient.safeGet).mockResolvedValue(JSON.stringify(cachedData));

      const result = await getOFSIssues();

      expect(redisClient.safeGet).toHaveBeenCalledWith('ofs:all');
      expect(mockFindAll).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should handle items with null dates gracefully', async () => {
      const rows = [
        { id: '1', companyName: 'OFS With Dates', slug: 'ofs-with-dates', status: 'UPCOMING', openDate: '2025-03-15', closeDate: '2025-03-16', priceRangeMax: 1000, issueSize: '5000' },
        { id: '2', companyName: 'OFS Without Dates', slug: 'ofs-without-dates', status: 'UPCOMING', openDate: null, closeDate: null, priceRangeMax: 1000, issueSize: '3000' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getOFSIssues();

      expect(result).toHaveLength(2);
      expect(result[1].openDate).toBeNull();
      expect(result[1].closeDate).toBeNull();
    });
  });

  describe('clearOFSCache()', () => {
    it('should clear OFS cache using Redis del command', async () => {
      const mockRedis = { del: vi.fn().mockResolvedValue(1) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);

      await clearOFSCache();

      expect(redisClient.getRedisClient).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('ofs:all');
    });

    it('should handle Redis errors gracefully', async () => {
      const mockRedis = { del: vi.fn().mockRejectedValue(new Error('Redis Error')) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);

      await expect(clearOFSCache()).resolves.not.toThrow();
    });
  });
});
