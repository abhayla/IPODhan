/**
 * Rights Service Unit Tests
 *
 * Tests for rights-service.ts
 * Coverage Target: >= 80%
 *
 * Story 9.4: Rights Issue Page - Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getUpcomingRightsIssues,
  getLiveRightsIssues,
  getRightsIssues,
  clearRightsIssuesCaches,
  type RightsIssueData,
} from '@/lib/services/rights-service';
import * as apiClient from '@/lib/api-client';
import * as redisClient from '@/lib/cache/redis-client';

// ==================== MOCKS ====================

// Mock API client
vi.mock('@/lib/api-client', () => ({
  getIPOs: vi.fn(),
}));

// Mock Redis client
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({
    del: vi.fn().mockResolvedValue(1),
  })),
  safeGet: vi.fn(),
  safeSet: vi.fn(),
}));

// ==================== TEST DATA ====================

const mockUpcomingRightsIPO: apiClient.IPO = {
  id: '1',
  companyName: 'Test Company Rights',
  slug: 'test-company-rights',
  category: 'RIGHTS',
  status: 'UPCOMING',
  openDate: '2025-03-01',
  closeDate: '2025-03-10',
  priceRangeMin: 100,
  priceRangeMax: 150,
  issueSize: '500',
  sector: 'Technology',
  lotSize: 100,
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  leadManagers: ['ICICI Securities'],
  companyDescription: 'Test company description',
  allotmentDate: null,
  listingDate: null,
  registrarId: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  lastScrapedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockLiveRightsIPO: apiClient.IPO = {
  ...mockUpcomingRightsIPO,
  id: '2',
  companyName: 'Live Rights Company',
  slug: 'live-rights-company',
  status: 'OPEN',
  openDate: '2025-02-20',
  closeDate: '2025-02-28',
};

const mockIPOListResponse: apiClient.IPOListResponse = {
  data: [mockUpcomingRightsIPO],
  pagination: {
    page: 1,
    limit: 100,
    total: 1,
    hasMore: false,
  },
};

const mockLiveIPOListResponse: apiClient.IPOListResponse = {
  data: [mockLiveRightsIPO],
  pagination: {
    page: 1,
    limit: 100,
    total: 1,
    hasMore: false,
  },
};

// ==================== TESTS ====================

describe('Rights Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUpcomingRightsIssues', () => {
    it('should fetch upcoming rights issues from API when cache is empty', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockIPOListResponse);

      // Act
      const result = await getUpcomingRightsIssues();

      // Assert
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'RIGHTS',
        status: 'UPCOMING',
        limit: 100,
      });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Test Company Rights');
      expect(result[0].recordDate).toBe('2025-03-01'); // Maps to openDate
      expect(result[0].renunciationDate).toBe('2025-03-10'); // Maps to closeDate
    });

    it('should return cached data when available', async () => {
      // Arrange
      const cachedData: RightsIssueData[] = [{
        id: '1',
        companyName: 'Cached Rights Company',
        slug: 'cached-rights',
        recordDate: '2025-03-01',
        openDate: '2025-03-01',
        renunciationDate: '2025-03-10',
        closeDate: '2025-03-10',
        issuePrice: 150,
        issueSize: '500',
        status: 'UPCOMING',
      }];
      vi.mocked(redisClient.safeGet).mockResolvedValue(JSON.stringify(cachedData));

      // Act
      const result = await getUpcomingRightsIssues();

      // Assert
      expect(apiClient.getIPOs).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should sort results by openDate (soonest first)', async () => {
      // Arrange
      const multipleIPOs: apiClient.IPOListResponse = {
        data: [
          { ...mockUpcomingRightsIPO, id: '1', openDate: '2025-03-15' },
          { ...mockUpcomingRightsIPO, id: '2', openDate: '2025-03-01' },
          { ...mockUpcomingRightsIPO, id: '3', openDate: '2025-03-10' },
        ],
        pagination: { page: 1, limit: 100, total: 3, hasMore: false },
      };
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(multipleIPOs);

      // Act
      const result = await getUpcomingRightsIssues();

      // Assert
      expect(result[0].openDate).toBe('2025-03-01'); // Earliest
      expect(result[1].openDate).toBe('2025-03-10');
      expect(result[2].openDate).toBe('2025-03-15'); // Latest
    });

    it('should handle API errors gracefully and return empty array', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockRejectedValue(new Error('API Error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      const result = await getUpcomingRightsIssues();

      // Assert
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should cache the fetched data with correct TTL', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockIPOListResponse);

      // Act
      await getUpcomingRightsIssues();

      // Assert
      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'rights:upcoming',
        expect.any(String),
        300 // 5 minutes TTL
      );
    });
  });

  describe('getLiveRightsIssues', () => {
    it('should fetch live rights issues from API when cache is empty', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockLiveIPOListResponse);

      // Act
      const result = await getLiveRightsIssues();

      // Assert
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'RIGHTS',
        status: 'OPEN',
        limit: 100,
      });
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Live Rights Company');
      expect(result[0].status).toBe('OPEN');
    });

    it('should sort results by openDate (most recent first)', async () => {
      // Arrange
      const multipleIPOs: apiClient.IPOListResponse = {
        data: [
          { ...mockLiveRightsIPO, id: '1', openDate: '2025-02-01' },
          { ...mockLiveRightsIPO, id: '2', openDate: '2025-02-20' },
          { ...mockLiveRightsIPO, id: '3', openDate: '2025-02-10' },
        ],
        pagination: { page: 1, limit: 100, total: 3, hasMore: false },
      };
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(multipleIPOs);

      // Act
      const result = await getLiveRightsIssues();

      // Assert
      expect(result[0].openDate).toBe('2025-02-20'); // Most recent
      expect(result[1].openDate).toBe('2025-02-10');
      expect(result[2].openDate).toBe('2025-02-01'); // Oldest
    });

    it('should handle API errors gracefully and return empty array', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockRejectedValue(new Error('API Error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      const result = await getLiveRightsIssues();

      // Assert
      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getRightsIssues', () => {
    it('should call getUpcomingRightsIssues when status is "upcoming"', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockIPOListResponse);

      // Act
      const result = await getRightsIssues('upcoming');

      // Assert
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'RIGHTS',
        status: 'UPCOMING',
        limit: 100,
      });
      expect(result).toHaveLength(1);
    });

    it('should call getLiveRightsIssues when status is "live"', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockLiveIPOListResponse);

      // Act
      const result = await getRightsIssues('live');

      // Assert
      expect(apiClient.getIPOs).toHaveBeenCalledWith({
        category: 'RIGHTS',
        status: 'OPEN',
        limit: 100,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('clearRightsIssuesCaches', () => {
    it('should delete both upcoming and live cache keys', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockResolvedValue(2),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);

      // Act
      await clearRightsIssuesCaches();

      // Assert
      expect(mockRedis.del).toHaveBeenCalledWith('rights:upcoming', 'rights:live');
    });

    it('should handle errors gracefully when clearing caches', async () => {
      // Arrange
      const mockRedis = {
        del: vi.fn().mockRejectedValue(new Error('Redis error')),
      };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as any);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      await clearRightsIssuesCaches();

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('Data Transformation', () => {
    it('should correctly map fields from IPO to RightsIssueData', async () => {
      // Arrange
      vi.mocked(redisClient.safeGet).mockResolvedValue(null);
      vi.mocked(apiClient.getIPOs).mockResolvedValue(mockIPOListResponse);

      // Act
      const result = await getUpcomingRightsIssues();

      // Assert
      const transformed = result[0];
      expect(transformed.id).toBe(mockUpcomingRightsIPO.id);
      expect(transformed.companyName).toBe(mockUpcomingRightsIPO.companyName);
      expect(transformed.slug).toBe(mockUpcomingRightsIPO.slug);
      expect(transformed.recordDate).toBe(mockUpcomingRightsIPO.openDate);
      expect(transformed.openDate).toBe(mockUpcomingRightsIPO.openDate);
      expect(transformed.renunciationDate).toBe(mockUpcomingRightsIPO.closeDate);
      expect(transformed.closeDate).toBe(mockUpcomingRightsIPO.closeDate);
      expect(transformed.issuePrice).toBe(mockUpcomingRightsIPO.priceRangeMax);
      expect(transformed.issueSize).toBe(mockUpcomingRightsIPO.issueSize);
      expect(transformed.status).toBe(mockUpcomingRightsIPO.status);
    });
  });
});
