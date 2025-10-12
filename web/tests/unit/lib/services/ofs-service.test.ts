/**
 * Unit Tests for OFS Service
 *
 * Tests the OFS service layer data fetching and transformation logic.
 *
 * Story 9.5: Offer for Sale (OFS) Page
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOFSIssues, clearOFSCache } from '@/lib/services/ofs-service';
import * as apiClient from '@/lib/api-client';
import * as redisClient from '@/lib/cache/redis-client';

// Mock modules
vi.mock('@/lib/api-client');
vi.mock('@/lib/cache/redis-client');

describe('OFS Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOFSIssues()', () => {
    it('should fetch OFS issues with correct category filter', async () => {
      // Mock API response
      const mockOFSData = [
        {
          id: '1',
          companyName: 'Test Company OFS',
          slug: 'test-company-ofs',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-16',
          priceRangeMax: 500,
          issueSize: '1000',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockOFSData,
        pagination: {
          page: 1,
          limit: 100,
          total: 1,
          hasMore: false,
        },
      });

      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);

      // Call service
      const result = await getOFSIssues();

      // Assertions
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'OFS',
        limit: 100,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '1',
        companyName: 'Test Company OFS',
        slug: 'test-company-ofs',
        nonRetailDate: '2025-03-15', // Maps to openDate
        retailDate: '2025-03-16', // Maps to closeDate
      });
    });

    it('should return empty array on API error (graceful degradation)', async () => {
      // Mock API error
      vi.mocked(apiClient.getIPOs).mockRejectedValue(new Error('API Error'));
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);

      // Call service
      const result = await getOFSIssues();

      // Assertions - should not throw, return empty array
      expect(result).toEqual([]);
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'OFS',
        limit: 100,
      });
    });

    it('should sort OFS issues by openDate (soonest first)', async () => {
      // Mock API response with unsorted data
      const mockOFSData = [
        {
          id: '1',
          companyName: 'OFS March',
          slug: 'ofs-march',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-16',
          priceRangeMax: 500,
          issueSize: '1000',
        },
        {
          id: '2',
          companyName: 'OFS January',
          slug: 'ofs-january',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-01-10',
          closeDate: '2025-01-11',
          priceRangeMax: 600,
          issueSize: '2000',
        },
        {
          id: '3',
          companyName: 'OFS February',
          slug: 'ofs-february',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-02-20',
          closeDate: '2025-02-21',
          priceRangeMax: 700,
          issueSize: '1500',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockOFSData,
        pagination: {
          page: 1,
          limit: 100,
          total: 3,
          hasMore: false,
        },
      });

      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);

      // Call service
      const result = await getOFSIssues();

      // Assertions - should be sorted by date
      expect(result).toHaveLength(3);
      expect(result[0].companyName).toBe('OFS January'); // Soonest
      expect(result[1].companyName).toBe('OFS February');
      expect(result[2].companyName).toBe('OFS March'); // Latest
    });

    it('should use Redis cache when available', async () => {
      // Mock cached data
      const cachedData = [
        {
          id: '1',
          companyName: 'Cached OFS',
          slug: 'cached-ofs',
          nonRetailDate: '2025-03-15',
          retailDate: '2025-03-16',
          openDate: '2025-03-15',
          closeDate: '2025-03-16',
          issuePrice: 500,
          issueSize: '1000',
          status: 'UPCOMING',
        },
      ];

      vi.mocked(redisClient.safeGet).mockResolvedValue(JSON.stringify(cachedData));

      // Call service
      const result = await getOFSIssues();

      // Assertions - should use cache, NOT call API
      expect(redisClient.safeGet).toHaveBeenCalledWith('ofs:all');
      expect(apiClient.getIPOs).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should handle items with null dates gracefully', async () => {
      // Mock API response with null dates
      const mockOFSData = [
        {
          id: '1',
          companyName: 'OFS With Dates',
          slug: 'ofs-with-dates',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-16',
          priceRangeMax: 500,
          issueSize: '1000',
        },
        {
          id: '2',
          companyName: 'OFS Without Dates',
          slug: 'ofs-without-dates',
          category: 'OFS' as const,
          status: 'UPCOMING' as const,
          openDate: null,
          closeDate: null,
          priceRangeMax: 600,
          issueSize: '2000',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockOFSData,
        pagination: {
          page: 1,
          limit: 100,
          total: 2,
          hasMore: false,
        },
      });

      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);

      // Call service
      const result = await getOFSIssues();

      // Assertions - should handle null dates, sort nulls last
      expect(result).toHaveLength(2);
      expect(result[0].companyName).toBe('OFS With Dates'); // Has date, comes first
      expect(result[1].companyName).toBe('OFS Without Dates'); // Null date, comes last
      expect(result[1].nonRetailDate).toBeNull();
      expect(result[1].retailDate).toBeNull();
    });
  });

  describe('clearOFSCache()', () => {
    it('should clear OFS cache using Redis del command', async () => {
      const mockRedis = {
        del: vi.fn().mockResolvedValue(1),
      };

      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Call service
      await clearOFSCache();

      // Assertions
      expect(redisClient.getRedisClient).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('ofs:all');
    });

    it('should handle Redis errors gracefully', async () => {
      const mockRedis = {
        del: vi.fn().mockRejectedValue(new Error('Redis Error')),
      };

      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Call service - should not throw
      await expect(clearOFSCache()).resolves.not.toThrow();
    });
  });
});
