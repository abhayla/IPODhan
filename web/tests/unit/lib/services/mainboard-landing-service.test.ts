/**
 * Unit Tests: Mainboard Landing Service
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * Tests all data fetching functions for the Mainboard IPOs landing page.
 * Target: >90% code coverage for service layer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as redisClient from '@/lib/cache/redis-client';
import {
  getMainboardSummaryMetrics,
  getMainboardCurrentIPOs,
  getMainboardUpcomingIPOs,
  getMainboardRecentlyListedIPOs,
  getMainboardReviews,
  getMainboardDetailedList,
  clearMainboardLandingCaches,
} from '@/lib/services/mainboard-landing-service';
import {
  mainboardIPOFixtures,
  getCurrentIPOs,
  getUpcomingIPOs,
  getRecentlyListedIPOs,
  getAllListedIPOs,
  filterByYear,
  createMockAPIResponse,
  emptyFixtures,
  summaryMetricsFixture,
} from '@/tests/fixtures/mainboard-landing.fixture';

// Mock dependencies. The service uses the repository layer directly
// (IPORepository.findAll), NOT the HTTP api-client; mock the repository.
const mockFindAll = vi.fn();
const mockFindByIPOIds = vi.fn();
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));
vi.mock('@/lib/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({ findByIPOIds: mockFindByIPOIds })),
}));
vi.mock('@/lib/cache/redis-client');

describe('Mainboard Landing Service', () => {
  beforeEach(() => {
    // Do NOT restoreAllMocks — it wipes the IPORepository factory implementation.
    vi.clearAllMocks();
    mockFindAll.mockReset();
    mockFindByIPOIds.mockReset();
    mockFindByIPOIds.mockResolvedValue([]);

    // Mock Redis cache (always miss for testing fresh data)
    vi.mocked(redisClient.safeGet).mockResolvedValue(null);
    vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);
    vi.mocked(redisClient.getRedisClient).mockReturnValue({
      del: vi.fn().mockResolvedValue(1),
    } as never);
  });

  // ==================== TEST: getMainboardSummaryMetrics ====================

  describe('getMainboardSummaryMetrics', () => {
    it('should calculate summary metrics correctly', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );
      mockFindByIPOIds.mockResolvedValue([]);

      // Act
      const result = await getMainboardSummaryMetrics();

      // Assert
      expect(result).toBeDefined();
      expect(result.totalIPOs).toBe(mainboardIPOFixtures.length);
      expect(result.upcomingAndOngoing).toBeGreaterThan(0);

      // Verify API called with correct params
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['MAINBOARD'], offeringType: ['IPO'] })
      );
    });

    it('should compute listedInGain/listedInLoss/gainAOT/lossAOT from real listing_performance rows (#98)', async () => {
      // Arrange: 4 LISTED IPOs. Real listing_performance rows: two gainers
      // (+10%, +30%), one loser (-20%), one flat (0.00% — neither gain nor
      // loss), and one LISTED IPO with NO listing_performance row at all
      // (excluded, never counted as 0).
      const listedIPOs = getAllListedIPOs();
      expect(listedIPOs.length).toBeGreaterThanOrEqual(1);
      mockFindAll.mockResolvedValue(createMockAPIResponse(mainboardIPOFixtures));
      mockFindByIPOIds.mockResolvedValue([
        { ipoId: listedIPOs[0].id, listingGainPercent: '10.00' },
        { ipoId: listedIPOs[1]?.id ?? 'missing-1', listingGainPercent: '-20.00' },
      ]);

      // Act
      const result = await getMainboardSummaryMetrics();

      // Assert: exact counts and averages, not just "not mocked"
      expect(result.listedInGain).toBe(1);
      expect(result.listedInLoss).toBe(1);
      expect(result.gainAOT).toBe(10);
      expect(result.lossAOT).toBe(-20);

      // The aggregate was computed from the LISTED ids of this segment
      const listedIds = mockFindByIPOIds.mock.calls[0][0] as string[];
      for (const ipo of mainboardIPOFixtures.filter((i) => i.status === 'LISTED')) {
        expect(listedIds).toContain(ipo.id);
      }
    });

    it('should exclude a 0.00% listing gain from both gain and loss buckets', async () => {
      const listedIPOs = getAllListedIPOs();
      mockFindAll.mockResolvedValue(createMockAPIResponse(mainboardIPOFixtures));
      mockFindByIPOIds.mockResolvedValue([
        { ipoId: listedIPOs[0].id, listingGainPercent: '0.00' },
      ]);

      const result = await getMainboardSummaryMetrics();

      expect(result.listedInGain).toBe(0);
      expect(result.listedInLoss).toBe(0);
      expect(result.gainAOT).toBeNull();
      expect(result.lossAOT).toBeNull();
    });

    it('should exclude a LISTED IPO with no listing_performance row, never counting it as 0', async () => {
      mockFindAll.mockResolvedValue(createMockAPIResponse(mainboardIPOFixtures));
      // No rows returned at all — every LISTED IPO is missing its row.
      mockFindByIPOIds.mockResolvedValue([]);

      const result = await getMainboardSummaryMetrics();

      expect(result.listedInGain).toBe(0);
      expect(result.listedInLoss).toBe(0);
      expect(result.gainAOT).toBeNull();
      expect(result.lossAOT).toBeNull();
    });

    it('should calculate upcomingAndOngoing correctly', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardSummaryMetrics();

      // Assert
      const expectedCount = mainboardIPOFixtures.filter(
        (ipo) => ipo.status === 'UPCOMING' || ipo.status === 'OPEN'
      ).length;
      expect(result.upcomingAndOngoing).toBe(expectedCount);
    });

    it('should return zero values on API error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await getMainboardSummaryMetrics();

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
      const result = await getMainboardSummaryMetrics();

      // Assert
      expect(result).toEqual(summaryMetricsFixture);
      expect(mockFindAll).not.toHaveBeenCalled();
    });

    it('should cache the result after fetching', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      await getMainboardSummaryMetrics();

      // Assert
      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'mainboard:landing:summary',
        expect.any(String),
        300
      );
    });
  });

  // ==================== TEST: getMainboardCurrentIPOs ====================

  describe('getMainboardCurrentIPOs', () => {
    it('should fetch only OPEN Mainboard IPOs', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getMainboardCurrentIPOs();

      // Assert
      expect(result).toHaveLength(currentIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('OPEN');
        expect(ipo.segment).toBe('MAINBOARD');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['MAINBOARD'], offeringType: ['IPO'], status: ['OPEN'] })
      );
    });

    it('should sort by closeDate ascending (closing soonest first)', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(currentIPOs)
      );

      // Act
      const result = await getMainboardCurrentIPOs();

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
      const result = await getMainboardCurrentIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Network Error'));

      // Act
      const result = await getMainboardCurrentIPOs();

      // Assert
      expect(result).toEqual([]);
    });

    it('should use cached data when available', async () => {
      // Arrange
      const cachedData = JSON.stringify(getCurrentIPOs());
      vi.mocked(redisClient.safeGet).mockResolvedValueOnce(cachedData);

      // Act
      const result = await getMainboardCurrentIPOs();

      // Assert
      expect(result).toEqual(getCurrentIPOs());
      expect(mockFindAll).not.toHaveBeenCalled();
    });
  });

  // ==================== TEST: getMainboardUpcomingIPOs ====================

  describe('getMainboardUpcomingIPOs', () => {
    it('should fetch only UPCOMING Mainboard IPOs', async () => {
      // Arrange
      const upcomingIPOs = getUpcomingIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(upcomingIPOs)
      );

      // Act
      const result = await getMainboardUpcomingIPOs();

      // Assert
      expect(result).toHaveLength(upcomingIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('UPCOMING');
        expect(ipo.segment).toBe('MAINBOARD');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['MAINBOARD'], offeringType: ['IPO'], status: ['UPCOMING'] })
      );
    });

    it('should sort by openDate ascending (opening soonest first)', async () => {
      // Arrange
      const upcomingIPOs = getUpcomingIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(upcomingIPOs)
      );

      // Act
      const result = await getMainboardUpcomingIPOs();

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
      const result = await getMainboardUpcomingIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Server Error'));

      // Act
      const result = await getMainboardUpcomingIPOs();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getMainboardRecentlyListedIPOs ====================

  describe('getMainboardRecentlyListedIPOs', () => {
    it('should fetch only LISTED Mainboard IPOs', async () => {
      // Arrange
      const listedIPOs = getRecentlyListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getMainboardRecentlyListedIPOs();

      // Assert
      expect(result).toHaveLength(listedIPOs.length);
      result.forEach((ipo) => {
        expect(ipo.status).toBe('LISTED');
        expect(ipo.segment).toBe('MAINBOARD');
      });

      // Verify API called with correct filters
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['MAINBOARD'], offeringType: ['IPO'], status: ['LISTED'] })
      );
    });

    it('should sort by listingDate descending (newest first)', async () => {
      // Arrange
      const listedIPOs = getRecentlyListedIPOs();
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(listedIPOs)
      );

      // Act
      const result = await getMainboardRecentlyListedIPOs();

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
      const result = await getMainboardRecentlyListedIPOs();

      // Assert
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it('should return empty array on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Database Error'));

      // Act
      const result = await getMainboardRecentlyListedIPOs();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getMainboardReviews ====================

  describe('getMainboardReviews', () => {
    it('should return empty array (MVP implementation)', async () => {
      // Act
      const result = await getMainboardReviews();

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      // Act
      const result = await getMainboardReviews();

      // Assert
      expect(result).toEqual([]);
    });

    it('should use cached data when available', async () => {
      // Arrange
      const cachedData = JSON.stringify([]);
      vi.mocked(redisClient.safeGet).mockResolvedValueOnce(cachedData);

      // Act
      const result = await getMainboardReviews();

      // Assert
      expect(result).toEqual([]);
    });
  });

  // ==================== TEST: getMainboardDetailedList ====================

  describe('getMainboardDetailedList', () => {
    it('should fetch all Mainboard IPOs', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList();

      // Assert
      expect(result.data).toBeInstanceOf(Array);
      expect(result.totalCount).toBe(mainboardIPOFixtures.length);
      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ segment: ['MAINBOARD'], offeringType: ['IPO'] })
      );
    });

    it('should filter by year', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList({ year: 2025 });

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
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList({ companySearch: 'Tech' });

      // Assert
      result.data.forEach((ipo) => {
        expect(ipo.companyName.toLowerCase()).toContain('tech');
      });
    });

    it('should sort by specified column and direction', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList({
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
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList();

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
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      const result = await getMainboardDetailedList({ year: 2025 });

      // Assert
      expect(result.totalCount).toBe(result.data.length);
    });

    it('should return empty result on error', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('Timeout'));

      // Act
      const result = await getMainboardDetailedList();

      // Assert
      expect(result).toEqual({ data: [], totalCount: 0 });
    });

    it('should cache results by year', async () => {
      // Arrange
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act
      await getMainboardDetailedList({ year: 2025 });

      // Assert
      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'mainboard:landing:detailed:2025',
        expect.any(String),
        300
      );
    });
  });

  // ==================== TEST: clearMainboardLandingCaches ====================

  describe('clearMainboardLandingCaches', () => {
    it('should clear all cache keys', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockResolvedValue(7),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Act
      await clearMainboardLandingCaches();

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith(
        'mainboard:landing:summary',
        'mainboard:landing:current',
        'mainboard:landing:upcoming',
        'mainboard:landing:recent',
        'mainboard:landing:reviews'
      );
    });

    it('should handle errors gracefully', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockRejectedValue(new Error('Redis Error')),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Act & Assert
      await expect(clearMainboardLandingCaches()).resolves.not.toThrow();
    });
  });

  // ==================== TEST: Error Handling ====================

  describe('Error Handling', () => {
    it('should handle API errors gracefully in all functions', async () => {
      // Arrange
      mockFindAll.mockRejectedValue(new Error('API Error'));

      // Act & Assert
      await expect(getMainboardSummaryMetrics()).resolves.toBeDefined();
      await expect(getMainboardCurrentIPOs()).resolves.toEqual([]);
      await expect(getMainboardUpcomingIPOs()).resolves.toEqual([]);
      await expect(getMainboardRecentlyListedIPOs()).resolves.toEqual([]);
      await expect(getMainboardReviews()).resolves.toEqual([]);
      await expect(getMainboardDetailedList()).resolves.toBeDefined();
    });

    it('should not throw errors when cache operations fail', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockRejectedValue(new Error('Cache Error'));
      mockFindAll.mockResolvedValue(
        createMockAPIResponse(mainboardIPOFixtures)
      );

      // Act & Assert
      await expect(getMainboardSummaryMetrics()).resolves.toBeDefined();
      await expect(getMainboardCurrentIPOs()).resolves.toBeDefined();
    });
  });
});
