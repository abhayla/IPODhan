/**
 * Unit Tests for NCD Service
 *
 * Tests the NCD service layer data fetching and transformation logic.
 *
 * Story 9.6: NCD Issue Page
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNCDIssues, clearNCDCache } from '@/lib/services/ncd-service';
import * as apiClient from '@/lib/api-client';
import * as redisClient from '@/lib/cache/redis-client';

// Mock modules
vi.mock('@/lib/api-client');
vi.mock('@/lib/cache/redis-client');

describe('NCD Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getNCDIssues()', () => {
    it('should fetch NCD issues with correct category filter', async () => {
      // Mock API response
      const mockNCDData = [
        {
          id: '1',
          companyName: 'Test Company NCD',
          slug: 'test-company-ncd',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-20',
          priceRangeMax: 1000,
          issueSize: '5000',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockNCDData,
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
      const result = await getNCDIssues();

      // Assertions
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'NCD',
        limit: 100,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: '1',
        companyName: 'Test Company NCD',
        slug: 'test-company-ncd',
        openDate: '2025-03-15',
        closeDate: '2025-03-20',
      });
    });

    it('should return empty array on API error (graceful degradation)', async () => {
      // Mock API error
      vi.mocked(apiClient.getIPOs).mockRejectedValue(new Error('API Error'));
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);

      // Call service
      const result = await getNCDIssues();

      // Assertions - should not throw, return empty array
      expect(result).toEqual([]);
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'NCD',
        limit: 100,
      });
    });

    it('should sort NCD issues by openDate descending (newest first)', async () => {
      // Mock API response with unsorted data
      const mockNCDData = [
        {
          id: '1',
          companyName: 'NCD March',
          slug: 'ncd-march',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-20',
          priceRangeMax: 1000,
          issueSize: '5000',
        },
        {
          id: '2',
          companyName: 'NCD January',
          slug: 'ncd-january',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-01-10',
          closeDate: '2025-01-15',
          priceRangeMax: 1000,
          issueSize: '3000',
        },
        {
          id: '3',
          companyName: 'NCD February',
          slug: 'ncd-february',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-02-20',
          closeDate: '2025-02-25',
          priceRangeMax: 1000,
          issueSize: '4000',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockNCDData,
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
      const result = await getNCDIssues();

      // Assertions - should be sorted by date descending (newest first)
      expect(result).toHaveLength(3);
      expect(result[0].companyName).toBe('NCD March'); // Newest (latest date)
      expect(result[1].companyName).toBe('NCD February');
      expect(result[2].companyName).toBe('NCD January'); // Oldest
    });

    it('should use Redis cache when available', async () => {
      // Mock cached data
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

      // Call service
      const result = await getNCDIssues();

      // Assertions - should use cache, NOT call API
      expect(redisClient.safeGet).toHaveBeenCalledWith('ncd:all');
      expect(apiClient.getIPOs).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should handle items with null dates gracefully', async () => {
      // Mock API response with null dates
      const mockNCDData = [
        {
          id: '1',
          companyName: 'NCD With Dates',
          slug: 'ncd-with-dates',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: '2025-03-15',
          closeDate: '2025-03-20',
          priceRangeMax: 1000,
          issueSize: '5000',
        },
        {
          id: '2',
          companyName: 'NCD Without Dates',
          slug: 'ncd-without-dates',
          category: 'NCD' as const,
          status: 'UPCOMING' as const,
          openDate: null,
          closeDate: null,
          priceRangeMax: 1000,
          issueSize: '3000',
        },
      ] as unknown as apiClient.IPO[];

      vi.mocked(apiClient.getIPOs).mockResolvedValue({
        data: mockNCDData,
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
      const result = await getNCDIssues();

      // Assertions - should handle null dates, sort nulls last (0 timestamp)
      expect(result).toHaveLength(2);
      expect(result[0].companyName).toBe('NCD With Dates'); // Has date, comes first
      expect(result[1].companyName).toBe('NCD Without Dates'); // Null date (0), comes last
      expect(result[1].openDate).toBeNull();
      expect(result[1].closeDate).toBeNull();
    });
  });

  describe('clearNCDCache()', () => {
    it('should clear NCD cache using Redis del command', async () => {
      const mockRedis = {
        del: vi.fn().mockResolvedValue(1),
      };

      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Call service
      await clearNCDCache();

      // Assertions
      expect(redisClient.getRedisClient).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('ncd:all');
    });

    it('should handle Redis errors gracefully', async () => {
      const mockRedis = {
        del: vi.fn().mockRejectedValue(new Error('Redis Error')),
      };

      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Call service - should not throw
      await expect(clearNCDCache()).resolves.not.toThrow();
    });
  });
});
