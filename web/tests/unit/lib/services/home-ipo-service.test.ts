/**
 * Unit Tests for Home IPO Service
 *
 * Tests all four data fetching functions for Story 9.1:
 * - getMainboardIPOs()
 * - getSMEIPOs()
 * - getUpcomingMainboardIPOs()
 * - getUpcomingSMEIPOs()
 *
 * Coverage includes:
 * - Successful data fetch (AC#1, AC#2)
 * - Correct category/status filtering (AC#2)
 * - Limit to 10 items (AC#3)
 * - Redis caching behavior (AC#4)
 * - Error handling without throwing (AC#5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMainboardIPOs,
  getSMEIPOs,
  getUpcomingMainboardIPOs,
  getUpcomingSMEIPOs,
  clearHomeIPOCaches,
  type HomeIPOTableData,
} from '@/lib/services/home-ipo-service';
import * as apiClient from '@/lib/api-client';
import * as redisClient from '@/lib/cache/redis-client';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

// ==================== MOCK DATA ====================

const mockMainboardOpenIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'mb-1',
  companyName: 'Mainboard Company Open',
  slug: 'mainboard-company-open',
  category: 'MAINBOARD' as const,
  openDate: '2025-10-01',
  closeDate: '2025-10-03',
  priceRangeMin: 90,
  priceRangeMax: 100,
  issueSize: '500',
  lotSize: 100,
  listingDate: null,
  allotmentDate: null,
  status: 'OPEN' as const,
  sector: 'Technology',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-09-15'),
  updatedAt: new Date('2025-09-15'),
};

const mockMainboardClosedRecentIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'mb-2',
  companyName: 'Mainboard Company Recently Closed',
  slug: 'mainboard-company-closed',
  category: 'MAINBOARD' as const,
  openDate: '2025-09-20',
  closeDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 10 days ago
  priceRangeMin: 180,
  priceRangeMax: 200,
  issueSize: '1000',
  lotSize: 50,
  listingDate: null,
  allotmentDate: null,
  status: 'CLOSED' as const,
  sector: 'Finance',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-09-10'),
  updatedAt: new Date('2025-09-10'),
};

const mockMainboardClosedOldIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'mb-3',
  companyName: 'Mainboard Company Old Closed',
  slug: 'mainboard-company-old-closed',
  category: 'MAINBOARD' as const,
  openDate: '2025-08-01',
  closeDate: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 35 days ago
  priceRangeMin: 140,
  priceRangeMax: 150,
  issueSize: '750',
  lotSize: 75,
  listingDate: null,
  allotmentDate: null,
  status: 'CLOSED' as const,
  sector: 'Healthcare',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-07-20'),
  updatedAt: new Date('2025-07-20'),
};

const mockSMEOpenIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'sme-1',
  companyName: 'SME Company Open',
  slug: 'sme-company-open',
  category: 'SME' as const,
  openDate: '2025-10-05',
  closeDate: '2025-10-07',
  priceRangeMin: 45,
  priceRangeMax: 50,
  issueSize: '100',
  lotSize: 200,
  listingDate: null,
  allotmentDate: null,
  status: 'OPEN' as const,
  sector: 'Manufacturing',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-09-25'),
  updatedAt: new Date('2025-09-25'),
};

const mockMainboardUpcomingIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'mb-up-1',
  companyName: 'Mainboard Upcoming Company',
  slug: 'mainboard-upcoming',
  category: 'MAINBOARD' as const,
  openDate: '2025-10-15',
  closeDate: '2025-10-18',
  priceRangeMin: 280,
  priceRangeMax: 300,
  issueSize: '1500',
  lotSize: 30,
  listingDate: null,
  allotmentDate: null,
  status: 'UPCOMING' as const,
  sector: 'Energy',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-09-01'),
  updatedAt: new Date('2025-09-01'),
};

const mockSMEUpcomingIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: 'sme-up-1',
  companyName: 'SME Upcoming Company',
  slug: 'sme-upcoming',
  category: 'SME' as const,
  openDate: '2025-10-20',
  closeDate: '2025-10-22',
  priceRangeMin: 75,
  priceRangeMax: 80,
  issueSize: '200',
  lotSize: 150,
  listingDate: null,
  allotmentDate: null,
  status: 'UPCOMING' as const,
  sector: 'Retail',
  companyDescription: null,
  faceValue: 10,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date('2025-09-05'),
  updatedAt: new Date('2025-09-05'),
};

// ==================== MOCK SETUP ====================

vi.mock('@/lib/api-client');
vi.mock('@/lib/cache/redis-client');

const mockGetIPOs = vi.mocked(apiClient.getIPOs);
const mockSafeGet = vi.mocked(redisClient.safeGet);
const mockSafeSet = vi.mocked(redisClient.safeSet);
const mockGetRedisClient = vi.mocked(redisClient.getRedisClient);

// ==================== TEST SUITES ====================

describe('Home IPO Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no cached data
    mockSafeGet.mockResolvedValue(null);
    mockSafeSet.mockResolvedValue(undefined);

    // Mock Redis client
    mockGetRedisClient.mockReturnValue({
      del: vi.fn().mockResolvedValue(1),
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ==================== getMainboardIPOs() ====================

  describe('getMainboardIPOs', () => {
    it('should fetch and return mainboard IPOs with OPEN status', async () => {
      // AC#1: Returns properly typed IPO data
      // AC#2: Fetches correct category (MAINBOARD) and status (OPEN)

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [mockMainboardOpenIPO],
          pagination: { page: 1, limit: 10, total: 1, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, hasMore: false },
        });

      const result = await getMainboardIPOs();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'mb-1',
        companyName: 'Mainboard Company Open',
        slug: 'mainboard-company-open',
        category: 'MAINBOARD',
        status: 'OPEN',
      });

      // Verify API calls
      expect(mockGetIPOs).toHaveBeenCalledWith({
        category: 'MAINBOARD',
        status: 'OPEN',
        limit: 10,
      });
      expect(mockGetIPOs).toHaveBeenCalledWith({
        category: 'MAINBOARD',
        status: 'CLOSED',
        limit: 50,
      });
    });

    it('should include CLOSED IPOs from last 30 days only', async () => {
      // AC#2: Filters CLOSED IPOs to last 30 days

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 10, total: 0, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [mockMainboardClosedRecentIPO, mockMainboardClosedOldIPO],
          pagination: { page: 1, limit: 50, total: 2, hasMore: false },
        });

      const result = await getMainboardIPOs();

      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Mainboard Company Recently Closed');
      // Old closed IPO should be filtered out
      expect(result.find((ipo) => ipo.id === 'mb-3')).toBeUndefined();
    });

    it('should limit results to 10 items', async () => {
      // AC#3: Results limited to 10 items

      const manyIPOs = Array.from({ length: 15 }, (_, i) => ({
        ...mockMainboardOpenIPO,
        id: `mb-${i}`,
        companyName: `Mainboard Company ${i}`,
      }));

      mockGetIPOs
        .mockResolvedValueOnce({
          data: manyIPOs.slice(0, 10),
          pagination: { page: 1, limit: 10, total: 15, hasMore: true },
        })
        .mockResolvedValueOnce({
          data: manyIPOs.slice(10, 15),
          pagination: { page: 1, limit: 50, total: 5, hasMore: false },
        });

      const result = await getMainboardIPOs();

      expect(result).toHaveLength(10);
    });

    it('should cache results in Redis with proper key and TTL', async () => {
      // AC#4: Data cached in Redis with proper cache key

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [mockMainboardOpenIPO],
          pagination: { page: 1, limit: 10, total: 1, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, hasMore: false },
        });

      await getMainboardIPOs();

      expect(mockSafeSet).toHaveBeenCalledWith(
        'home:mainboard:active',
        expect.any(String),
        300 // 5-minute TTL
      );
    });

    it('should return cached data if available', async () => {
      // AC#4: Uses cached data when available

      const cachedData = [
        {
          id: 'cached-1',
          companyName: 'Cached Mainboard IPO',
          slug: 'cached-mainboard',
          category: 'MAINBOARD',
          openDate: '2025-10-01',
          closeDate: '2025-10-03',
          issuePrice: 100,
          issueSize: '500',
          listingDate: null,
          status: 'OPEN',
        },
      ];

      mockSafeGet.mockResolvedValue(JSON.stringify(cachedData));

      const result = await getMainboardIPOs();

      expect(result).toEqual(cachedData);
      expect(mockGetIPOs).not.toHaveBeenCalled(); // Should not call API
    });

    it('should handle API errors gracefully without throwing', async () => {
      // AC#5: Handles API errors without throwing

      mockGetIPOs.mockRejectedValue(new Error('API Error'));

      const result = await getMainboardIPOs();

      expect(result).toEqual([]); // Should return empty array
      expect(result).toHaveLength(0);
    });

    it('should sort combined results by openDate (most recent first)', async () => {
      const olderIPO = {
        ...mockMainboardOpenIPO,
        id: 'mb-old',
        openDate: '2025-09-01',
      };
      const newerIPO = {
        ...mockMainboardOpenIPO,
        id: 'mb-new',
        openDate: '2025-10-01',
      };

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [olderIPO],
          pagination: { page: 1, limit: 10, total: 1, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [newerIPO],
          pagination: { page: 1, limit: 50, total: 1, hasMore: false },
        });

      const result = await getMainboardIPOs();

      expect(result[0].id).toBe('mb-new'); // Newer should be first
      expect(result[1].id).toBe('mb-old');
    });
  });

  // ==================== getSMEIPOs() ====================

  describe('getSMEIPOs', () => {
    it('should fetch and return SME IPOs with correct category', async () => {
      // AC#1: Returns properly typed IPO data
      // AC#2: Fetches correct category (SME)

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [mockSMEOpenIPO],
          pagination: { page: 1, limit: 10, total: 1, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, hasMore: false },
        });

      const result = await getSMEIPOs();

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('SME');
      expect(result[0].status).toBe('OPEN');

      expect(mockGetIPOs).toHaveBeenCalledWith({
        category: 'SME',
        status: 'OPEN',
        limit: 10,
      });
    });

    it('should limit results to 10 items', async () => {
      // AC#3: Results limited to 10 items

      const manyIPOs = Array.from({ length: 12 }, (_, i) => ({
        ...mockSMEOpenIPO,
        id: `sme-${i}`,
      }));

      mockGetIPOs
        .mockResolvedValueOnce({
          data: manyIPOs.slice(0, 10),
          pagination: { page: 1, limit: 10, total: 12, hasMore: true },
        })
        .mockResolvedValueOnce({
          data: manyIPOs.slice(10),
          pagination: { page: 1, limit: 50, total: 2, hasMore: false },
        });

      const result = await getSMEIPOs();

      expect(result).toHaveLength(10);
    });

    it('should cache results with SME cache key', async () => {
      // AC#4: Proper cache key

      mockGetIPOs
        .mockResolvedValueOnce({
          data: [mockSMEOpenIPO],
          pagination: { page: 1, limit: 10, total: 1, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, hasMore: false },
        });

      await getSMEIPOs();

      expect(mockSafeSet).toHaveBeenCalledWith(
        'home:sme:active',
        expect.any(String),
        300
      );
    });

    it('should handle errors gracefully', async () => {
      // AC#5: Error handling

      mockGetIPOs.mockRejectedValue(new Error('Network Error'));

      const result = await getSMEIPOs();

      expect(result).toEqual([]);
    });
  });

  // ==================== getUpcomingMainboardIPOs() ====================

  describe('getUpcomingMainboardIPOs', () => {
    it('should fetch UPCOMING mainboard IPOs', async () => {
      // AC#2: Correct category and status

      mockGetIPOs.mockResolvedValueOnce({
        data: [mockMainboardUpcomingIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      const result = await getUpcomingMainboardIPOs();

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('MAINBOARD');
      expect(result[0].status).toBe('UPCOMING');

      expect(mockGetIPOs).toHaveBeenCalledWith({
        category: 'MAINBOARD',
        status: 'UPCOMING',
        limit: 10,
      });
    });

    it('should limit results to 10 items', async () => {
      // AC#3

      const manyIPOs = Array.from({ length: 15 }, (_, i) => ({
        ...mockMainboardUpcomingIPO,
        id: `mb-up-${i}`,
      }));

      mockGetIPOs.mockImplementationOnce(async (options) => {
        const limit = options?.limit || 10;
        return {
          data: manyIPOs.slice(0, limit),
          pagination: { page: 1, limit, total: 15, hasMore: true },
        };
      });

      const result = await getUpcomingMainboardIPOs();

      expect(result).toHaveLength(10);
    });

    it('should cache with upcoming mainboard cache key', async () => {
      // AC#4

      mockGetIPOs.mockResolvedValueOnce({
        data: [mockMainboardUpcomingIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      await getUpcomingMainboardIPOs();

      expect(mockSafeSet).toHaveBeenCalledWith(
        'home:mainboard:upcoming',
        expect.any(String),
        300
      );
    });

    it('should sort by openDate (soonest first)', async () => {
      const laterIPO = {
        ...mockMainboardUpcomingIPO,
        id: 'later',
        openDate: '2025-10-20',
      };
      const soonerIPO = {
        ...mockMainboardUpcomingIPO,
        id: 'sooner',
        openDate: '2025-10-10',
      };

      mockGetIPOs.mockResolvedValueOnce({
        data: [laterIPO, soonerIPO],
        pagination: { page: 1, limit: 10, total: 2, hasMore: false },
      });

      const result = await getUpcomingMainboardIPOs();

      expect(result[0].id).toBe('sooner');
      expect(result[1].id).toBe('later');
    });

    it('should handle errors gracefully', async () => {
      // AC#5

      mockGetIPOs.mockRejectedValue(new Error('Timeout'));

      const result = await getUpcomingMainboardIPOs();

      expect(result).toEqual([]);
    });
  });

  // ==================== getUpcomingSMEIPOs() ====================

  describe('getUpcomingSMEIPOs', () => {
    it('should fetch UPCOMING SME IPOs', async () => {
      // AC#2

      mockGetIPOs.mockResolvedValueOnce({
        data: [mockSMEUpcomingIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      const result = await getUpcomingSMEIPOs();

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('SME');
      expect(result[0].status).toBe('UPCOMING');

      expect(mockGetIPOs).toHaveBeenCalledWith({
        category: 'SME',
        status: 'UPCOMING',
        limit: 10,
      });
    });

    it('should limit results to 10 items', async () => {
      // AC#3

      const manyIPOs = Array.from({ length: 20 }, (_, i) => ({
        ...mockSMEUpcomingIPO,
        id: `sme-up-${i}`,
      }));

      mockGetIPOs.mockImplementationOnce(async (options) => {
        const limit = options?.limit || 10;
        return {
          data: manyIPOs.slice(0, limit),
          pagination: { page: 1, limit, total: 20, hasMore: true },
        };
      });

      const result = await getUpcomingSMEIPOs();

      expect(result).toHaveLength(10);
    });

    it('should cache with upcoming SME cache key', async () => {
      // AC#4

      mockGetIPOs.mockResolvedValueOnce({
        data: [mockSMEUpcomingIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      await getUpcomingSMEIPOs();

      expect(mockSafeSet).toHaveBeenCalledWith(
        'home:sme:upcoming',
        expect.any(String),
        300
      );
    });

    it('should handle errors gracefully', async () => {
      // AC#5

      mockGetIPOs.mockRejectedValue(new Error('Service Unavailable'));

      const result = await getUpcomingSMEIPOs();

      expect(result).toEqual([]);
    });
  });

  // ==================== clearHomeIPOCaches() ====================

  describe('clearHomeIPOCaches', () => {
    it('should clear all four cache keys', async () => {
      const mockDel = vi.fn().mockResolvedValue(4);
      mockGetRedisClient.mockReturnValue({
        del: mockDel,
      } as any);

      await clearHomeIPOCaches();

      expect(mockDel).toHaveBeenCalledWith(
        'home:mainboard:active',
        'home:sme:active',
        'home:mainboard:upcoming',
        'home:sme:upcoming'
      );
    });

    it('should handle Redis errors gracefully', async () => {
      const mockDel = vi.fn().mockRejectedValue(new Error('Redis error'));
      mockGetRedisClient.mockReturnValue({
        del: mockDel,
      } as any);

      await expect(clearHomeIPOCaches()).resolves.not.toThrow();
    });
  });

  // ==================== TYPE COMPATIBILITY ====================

  describe('Type Compatibility with DataTable', () => {
    it('should return data compatible with DataTable columns', async () => {
      mockGetIPOs.mockResolvedValueOnce({
        data: [mockMainboardOpenIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      const result = await getUpcomingMainboardIPOs();

      // Verify required fields for DataTable
      expect(result[0]).toHaveProperty('companyName');
      expect(result[0]).toHaveProperty('openDate');
      expect(result[0]).toHaveProperty('closeDate');
      expect(typeof result[0].companyName).toBe('string');
    });
  });

  // ==================== EDGE CASES ====================

  describe('Edge Cases', () => {
    it('should handle empty API responses', async () => {
      mockGetIPOs
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 10, total: 0, hasMore: false },
        })
        .mockResolvedValueOnce({
          data: [],
          pagination: { page: 1, limit: 50, total: 0, hasMore: false },
        });

      const result = await getMainboardIPOs();

      expect(result).toEqual([]);
    });

    it('should handle IPOs with null dates', async () => {
      const ipoWithNullDate = {
        ...mockMainboardOpenIPO,
        openDate: null,
        closeDate: null,
      };

      mockGetIPOs.mockResolvedValueOnce({
        data: [ipoWithNullDate],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      const result = await getUpcomingMainboardIPOs();

      expect(result[0].openDate).toBeNull();
      expect(result[0].closeDate).toBeNull();
    });

    it('should handle cache parse errors gracefully', async () => {
      mockSafeGet.mockResolvedValue('invalid-json{');

      mockGetIPOs.mockResolvedValueOnce({
        data: [mockMainboardOpenIPO],
        pagination: { page: 1, limit: 10, total: 1, hasMore: false },
      });

      // Should fallback to API fetch
      const result = await getUpcomingMainboardIPOs();

      expect(result).toHaveLength(1);
    });
  });
});
