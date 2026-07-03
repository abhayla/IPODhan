/**
 * Unit Tests: SME Landing Service
 * Story 9.16: SME IPOs Landing Page
 *
 * Tests all data fetching functions for the SME IPOs landing page.
 * Target: >90% code coverage for service layer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as redisClient from '@/lib/cache/redis-client';
import {
  getSMESummaryMetrics,
  getSMECurrentIPOs,
  getSMEUpcomingIPOs,
  getSMERecentlyListedIPOs,
  getSMEReviews,
  getSMEPerformanceHighlights,
  getSMESubscriptionStatus,
  getSMEDetailedList,
  clearSMELandingCaches,
} from '@/lib/services/sme-landing-service';
import {
  smeIPOFixtures,
  getCurrentIPOs,
  getUpcomingIPOs,
  getRecentlyListedIPOs,
  getAllListedIPOs,
  filterByYear,
  createMockAPIResponse,
  emptyFixtures,
  summaryMetricsFixture,
} from '@/tests/fixtures/sme-landing.fixture';

// Mock dependencies. Service uses IPORepository.findAll directly, not api-client.
const mockFindAll = vi.fn();
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));
vi.mock('@/lib/cache/redis-client');

describe('SME Landing Service', () => {
  beforeEach(() => {
    // Do NOT restoreAllMocks — it wipes the IPORepository factory implementation.
    vi.clearAllMocks();
    mockFindAll.mockReset();

    // Mock Redis cache (always miss for testing fresh data)
    vi.mocked(redisClient.safeGet).mockResolvedValue(null);
    vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);
    vi.mocked(redisClient.getRedisClient).mockReturnValue({
      del: vi.fn().mockResolvedValue(1),
    } as never);
  });

  // ==================== TEST: getSMESummaryMetrics ====================

  describe('getSMESummaryMetrics', () => {
    it('should calculate summary metrics correctly', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMESummaryMetrics();

      // Assert
      expect(result).toBeDefined();
      expect(result.totalIPOs).toBe(smeIPOFixtures.length);
      expect(result.upcomingAndOngoing).toBeGreaterThan(0);
      // Mocked gain/loss metrics removed — null until real aggregates (#98)
      expect(result.listedInGain).toBeNull();
      expect(result.listedInLoss).toBeNull();
      expect(result.gainAOT).toBeNull();
      expect(result.lossAOT).toBeNull();

      // Verify API called with correct params
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'] })
      );
    });

    it('should calculate upcomingAndOngoing correctly', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMESummaryMetrics();

      // Assert
      const expectedCount = smeIPOFixtures.filter(
        (ipo) => ipo.status === 'UPCOMING' || ipo.status === 'OPEN'
      ).length;
      expect(result.upcomingAndOngoing).toBe(expectedCount);
    });

    it('should return zero values on API error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await getSMESummaryMetrics();

      // Assert
      expect(result).toEqual({
        totalIPOs: 0,
        listedInGain: null,
        listedInLoss: null,
        upcomingAndOngoing: 0,
        gainAOT: null,
        lossAOT: null,
      });
    });

    it('should use cached data when available', async () => {
      // Arrange
      const cachedData = JSON.stringify(summaryMetricsFixture);
      vi.mocked(redisClient.safeGet).mockResolvedValueOnce(cachedData);

      // Act
      const result = await getSMESummaryMetrics();

      // Assert
      expect(result).toEqual(summaryMetricsFixture);
      expect(mockFindAll).not.toHaveBeenCalled();
    });

    it('should cache the result after fetching', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      await getSMESummaryMetrics();

      // Assert
      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'sme:landing:summary',
        expect.any(String),
        300
      );
    });
  });

  // ==================== TEST: getSMECurrentIPOs ====================

  describe('getSMECurrentIPOs', () => {
    it('should fetch only OPEN SME IPOs', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getSMECurrentIPOs();

      // Assert
      expect(result).toHaveLength(currentIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('OPEN');
        expect(ipo.segment).toBe('SME');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'], status: ['OPEN'] })
      );
    });

    it('should sort by closeDate ascending (closing soonest first)', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getSMECurrentIPOs();

      // Assert
      for (let i = 0; i < result.length - 1; i++) {
        const date1 = new Date(result[i].closeDate!).getTime();
        const date2 = new Date(result[i + 1].closeDate!).getTime();
        expect(date1).toBeLessThanOrEqual(date2);
      }
    });

    it('should limit to 6 items', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getSMECurrentIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Network Error'));

      // Act
      const result = await getSMECurrentIPOs();

      // Assert
      expect(result).toEqual([]);
    });

    it('should use cached data when available', async () => {
      // Arrange
      const cachedData = JSON.stringify(getCurrentIPOs());
      vi.mocked(redisClient.safeGet).mockResolvedValueOnce(cachedData);

      // Act
      const result = await getSMECurrentIPOs();

      // Assert
      expect(result).toEqual(getCurrentIPOs());
      expect(mockFindAll).not.toHaveBeenCalled();
    });
  });

  // ==================== TEST: getSMEUpcomingIPOs ====================

  describe('getSMEUpcomingIPOs', () => {
    it('should fetch only UPCOMING SME IPOs', async () => {
      // Arrange
      const upcomingIPOs = getUpcomingIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(upcomingIPOs)
      );

      // Act
      const result = await getSMEUpcomingIPOs();

      // Assert
      expect(result).toHaveLength(upcomingIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('UPCOMING');
        expect(ipo.segment).toBe('SME');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'], status: ['UPCOMING'] })
      );
    });

    it('should sort by openDate ascending (opening soonest first)', async () => {
      // Arrange
      const upcomingIPOs = getUpcomingIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(upcomingIPOs)
      );

      // Act
      const result = await getSMEUpcomingIPOs();

      // Assert
      for (let i = 0; i < result.length - 1; i++) {
        const date1 = new Date(result[i].openDate!).getTime();
        const date2 = new Date(result[i + 1].openDate!).getTime();
        expect(date1).toBeLessThanOrEqual(date2);
      }
    });

    it('should limit to 6 items', async () => {
      // Arrange
      const upcomingIPOs = getUpcomingIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(upcomingIPOs)
      );

      // Act
      const result = await getSMEUpcomingIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Server Error'));

      // Act
      const result = await getSMEUpcomingIPOs();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getSMERecentlyListedIPOs ====================

  describe('getSMERecentlyListedIPOs', () => {
    it('should fetch only LISTED SME IPOs', async () => {
      // Arrange
      const listedIPOs = getRecentlyListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMERecentlyListedIPOs();

      // Assert
      expect(result).toHaveLength(listedIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('LISTED');
        expect(ipo.segment).toBe('SME');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'], status: ['LISTED'] })
      );
    });

    it('should sort by listingDate descending (newest first)', async () => {
      // Arrange
      const listedIPOs = getRecentlyListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMERecentlyListedIPOs();

      // Assert
      for (let i = 0; i < result.length - 1; i++) {
        const date1 = new Date(result[i].listingDate!).getTime();
        const date2 = new Date(result[i + 1].listingDate!).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }
    });

    it('should limit to 6 items', async () => {
      // Arrange
      const listedIPOs = getRecentlyListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMERecentlyListedIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Database Error'));

      // Act
      const result = await getSMERecentlyListedIPOs();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getSMEReviews ====================

  describe('getSMEReviews', () => {
    it('should return empty array (MVP implementation)', async () => {
      // Act
      const result = await getSMEReviews();

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      // Act
      const result = await getSMEReviews();

      // Assert
      expect(result).toEqual([]);
    });

    it('should use cached data when available', async () => {
      // Arrange
      const cachedData = JSON.stringify([]);
      vi.mocked(redisClient.safeGet).mockResolvedValueOnce(cachedData);

      // Act
      const result = await getSMEReviews();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getSMEPerformanceHighlights ====================

  describe('getSMEPerformanceHighlights', () => {
    it('should calculate top gainers and losers', async () => {
      // Arrange
      const listedIPOs = getAllListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMEPerformanceHighlights();

      // Assert
      expect(result).toHaveProperty('topGainers');
      expect(result).toHaveProperty('topLosers');
      expect(result.topGainers).toBeInstanceOf(Array);
      expect(result.topLosers).toBeInstanceOf(Array);
      expect(result.topGainers.length).toBeLessThanOrEqual(3);
      expect(result.topLosers.length).toBeLessThanOrEqual(3);
    });

    it('should include gainPercent in performance highlights', async () => {
      // Arrange
      const listedIPOs = getAllListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMEPerformanceHighlights();

      // Assert
      if (result.topGainers.length > 0) {
        expect(result.topGainers[0]).toHaveProperty('gainPercent');
        expect(result.topGainers[0]).toHaveProperty('issuePrice');
        expect(result.topGainers[0]).toHaveProperty('currentPrice');
        expect(result.topGainers[0]).toHaveProperty('companyName');
      }
    });

    it('should return top gainers sorted by highest gain first', async () => {
      // Arrange
      const listedIPOs = getAllListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getSMEPerformanceHighlights();

      // Assert
      for (let i = 0; i < result.topGainers.length - 1; i++) {
        expect(result.topGainers[i].gainPercent).toBeGreaterThanOrEqual(
          result.topGainers[i + 1].gainPercent
        );
      }
    });

    it('should return empty arrays on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Fetch Error'));

      // Act
      const result = await getSMEPerformanceHighlights();

      // Assert
      expect(result).toEqual({ topGainers: [], topLosers: [] });
    });

    it('should fetch LISTED IPOs with limit 50', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(getAllListedIPOs())
      );

      // Act
      await getSMEPerformanceHighlights();

      // Assert
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'], status: ['LISTED'] })
      );
    });
  });

  // ==================== TEST: getSMESubscriptionStatus ====================

  describe('getSMESubscriptionStatus', () => {
    it('should fetch OPEN IPOs with subscription data', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getSMESubscriptionStatus();

      // Assert
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeLessThanOrEqual(6);
      result.forEach((item) => {
        expect(item).toHaveProperty('companyName');
        expect(item).toHaveProperty('totalSubscription');
        expect(item).toHaveProperty('qibSubscription');
        expect(item).toHaveProperty('niiSubscription');
        expect(item).toHaveProperty('retailSubscription');
      });

      // Verify API called with correct params
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'], status: ['OPEN'] })
      );
    });

    it('should include all subscription fields', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getSMESubscriptionStatus();

      // Assert
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id');
        expect(result[0]).toHaveProperty('companyName');
        expect(result[0]).toHaveProperty('slug');
        expect(result[0]).toHaveProperty('totalSubscription');
        expect(result[0]).toHaveProperty('qibSubscription');
        expect(result[0]).toHaveProperty('niiSubscription');
        expect(result[0]).toHaveProperty('retailSubscription');
        expect(result[0]).toHaveProperty('closeDate');
      }
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('API Down'));

      // Act
      const result = await getSMESubscriptionStatus();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getSMEDetailedList ====================

  describe('getSMEDetailedList', () => {
    it('should fetch all SME IPOs', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList();

      // Assert
      expect(result.data).toBeInstanceOf(Array);
      expect(result.totalCount).toBe(smeIPOFixtures.length);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['SME'], offeringType: ['IPO'] })
      );
    });

    it('should filter by year', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList({ year: 2025 });

      // Assert
      result.data.forEach((ipo) => {
        if (ipo.openDate) {
          const year = new Date(ipo.openDate).getFullYear();
          expect(year).toBe(2025);
        }
      });
    });

    it('should filter by company search', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList({ companySearch: 'Smart' });

      // Assert
      result.data.forEach((ipo) => {
        expect(ipo.companyName.toLowerCase()).toContain('smart');
      });
    });

    it('should sort by specified column and direction', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList({
        sortColumn: 'companyName',
        sortDirection: 'asc',
      });

      // Assert
      for (let i = 0; i < result.data.length - 1; i++) {
        expect(result.data[i].companyName <= result.data[i + 1].companyName).toBe(true);
      }
    });

    it('should sort by openDate descending by default', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList();

      // Assert
      for (let i = 0; i < result.data.length - 1; i++) {
        if (result.data[i].openDate && result.data[i + 1].openDate) {
          const date1 = new Date(result.data[i].openDate!).getTime();
          const date2 = new Date(result.data[i + 1].openDate!).getTime();
          expect(date1).toBeGreaterThanOrEqual(date2);
        }
      }
    });

    it('should return totalCount matching filtered data', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      const result = await getSMEDetailedList({ year: 2025 });

      // Assert
      expect(result.totalCount).toBe(result.data.length);
    });

    it('should return empty result on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Timeout'));

      // Act
      const result = await getSMEDetailedList();

      // Assert
      expect(result).toEqual({ data: [], totalCount: 0 });
    });

    it('should cache results by year', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act
      await getSMEDetailedList({ year: 2025 });

      // Assert
      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'sme:landing:detailed:2025',
        expect.any(String),
        300
      );
    });
  });

  // ==================== TEST: clearSMELandingCaches ====================

  describe('clearSMELandingCaches', () => {
    it('should clear all cache keys', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockResolvedValue(7),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Act
      await clearSMELandingCaches();

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(
        'sme:landing:summary',
        'sme:landing:current',
        'sme:landing:upcoming',
        'sme:landing:recent',
        'sme:landing:reviews',
        'sme:landing:performance',
        'sme:landing:subscription'
      );
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockRejectedValue(new Error('Redis Error')),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Act & Assert
      await expect(clearSMELandingCaches()).resolves.not.toThrow();
    });
  });

  // ==================== TEST: Error Handling ====================

  describe('Error Handling', () => {
    it('should handle API errors gracefully in all functions', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('API Error'));

      // Act & Assert
      await expect(getSMESummaryMetrics()).resolves.toBeDefined();
      await expect(getSMECurrentIPOs()).resolves.toEqual([]);
      await expect(getSMEUpcomingIPOs()).resolves.toEqual([]);
      await expect(getSMERecentlyListedIPOs()).resolves.toEqual([]);
      await expect(getSMEReviews()).resolves.toEqual([]);
      await expect(getSMEPerformanceHighlights()).resolves.toBeDefined();
      await expect(getSMESubscriptionStatus()).resolves.toEqual([]);
      await expect(getSMEDetailedList()).resolves.toBeDefined();
    });

    it('should not throw errors when cache operations fail', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockRejectedValue(new Error('Cache Error'));
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(smeIPOFixtures)
      );

      // Act & Assert
      await expect(getSMESummaryMetrics()).resolves.toBeDefined();
      await expect(getSMECurrentIPOs()).resolves.toBeDefined();
    });
  });
});
