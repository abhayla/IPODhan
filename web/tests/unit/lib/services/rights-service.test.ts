/**
 * Rights Service Unit Tests
 *
 * Tests for rights-service.ts
 *
 * NOTE: the service uses the repository layer directly (Service → Repository),
 * NOT the HTTP api-client. These tests mock `IPORepository.findAll` accordingly.
 * Sorting is delegated to the repository (sortBy/sortOrder), so these tests assert
 * the requested sort params and that the service preserves the repo's order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getUpcomingRightsIssues,
  getLiveRightsIssues,
  getRightsIssues,
  clearRightsIssuesCaches,
  type RightsIssueData,
} from '@/lib/services/rights-service';
import type * as apiClient from '@/lib/api-client';
import * as redisClient from '@/lib/cache/redis-client';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

// ==================== MOCKS ====================

const mockFindAll = vi.fn();
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({ del: vi.fn().mockResolvedValue(1) })),
  safeGet: vi.fn(),
  safeSet: vi.fn(),
}));

// ==================== TEST DATA ====================

const mockUpcomingRightsIPO: apiClient.IPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: '1',
  companyName: 'Test Company Rights',
  slug: 'test-company-rights',
  segment: 'MAINBOARD' as const,
  offeringType: 'RIGHTS' as const,
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

const paginated = (rows: unknown[]) => ({
  data: rows,
  pagination: { page: 1, limit: 100, total: rows.length, hasMore: false },
});

// ==================== TESTS ====================

describe('Rights Service', () => {
  beforeEach(() => {
    // Do NOT restoreAllMocks — it wipes the IPORepository factory implementation.
    vi.clearAllMocks();
    mockFindAll.mockReset();
    vi.mocked(redisClient.safeGet).mockResolvedValue(null);
    vi.mocked(redisClient.safeSet).mockResolvedValue(undefined);
  });

  describe('getUpcomingRightsIssues', () => {
    it('should fetch upcoming rights issues from the repository when cache is empty', async () => {
      mockFindAll.mockResolvedValue(paginated([mockUpcomingRightsIPO]));

      const result = await getUpcomingRightsIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          segment: ['MAINBOARD'],
          offeringType: 'RIGHTS',
          status: ['UPCOMING'],
          limit: 100,
          sortBy: 'openDate',
          sortOrder: 'asc',
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Test Company Rights');
      expect(result[0].recordDate).toBe('2025-03-01'); // Maps to openDate
      expect(result[0].renunciationDate).toBe('2025-03-10'); // Maps to closeDate
    });

    it('should return cached data when available', async () => {
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

      const result = await getUpcomingRightsIssues();

      expect(mockFindAll).not.toHaveBeenCalled();
      expect(result).toEqual(cachedData);
    });

    it('should request ascending openDate sort and preserve repository order', async () => {
      const rows = [
        { ...mockUpcomingRightsIPO, id: '2', openDate: '2025-03-01' },
        { ...mockUpcomingRightsIPO, id: '3', openDate: '2025-03-10' },
        { ...mockUpcomingRightsIPO, id: '1', openDate: '2025-03-15' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getUpcomingRightsIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'openDate', sortOrder: 'asc' })
      );
      expect(result.map((r) => r.openDate)).toEqual([
        '2025-03-01',
        '2025-03-10',
        '2025-03-15',
      ]);
    });

    it('should handle repository errors gracefully and return empty array', async () => {
      mockFindAll.mockRejectedValue(new Error('DB Error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getUpcomingRightsIssues();

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should cache the fetched data with correct TTL', async () => {
      mockFindAll.mockResolvedValue(paginated([mockUpcomingRightsIPO]));

      await getUpcomingRightsIssues();

      expect(redisClient.safeSet).toHaveBeenCalledWith(
        'rights:upcoming',
        expect.any(String),
        300 // 5 minutes TTL
      );
    });
  });

  describe('getLiveRightsIssues', () => {
    it('should fetch live rights issues from the repository when cache is empty', async () => {
      mockFindAll.mockResolvedValue(paginated([mockLiveRightsIPO]));

      const result = await getLiveRightsIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({
          segment: ['MAINBOARD'],
          offeringType: 'RIGHTS',
          status: ['OPEN'],
          limit: 100,
          sortBy: 'openDate',
          sortOrder: 'desc',
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].companyName).toBe('Live Rights Company');
      expect(result[0].status).toBe('OPEN');
    });

    it('should request descending openDate sort and preserve repository order', async () => {
      const rows = [
        { ...mockLiveRightsIPO, id: '2', openDate: '2025-02-20' },
        { ...mockLiveRightsIPO, id: '3', openDate: '2025-02-10' },
        { ...mockLiveRightsIPO, id: '1', openDate: '2025-02-01' },
      ];
      mockFindAll.mockResolvedValue(paginated(rows));

      const result = await getLiveRightsIssues();

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'openDate', sortOrder: 'desc' })
      );
      expect(result.map((r) => r.openDate)).toEqual([
        '2025-02-20',
        '2025-02-10',
        '2025-02-01',
      ]);
    });

    it('should handle repository errors gracefully and return empty array', async () => {
      mockFindAll.mockRejectedValue(new Error('DB Error'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getLiveRightsIssues();

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getRightsIssues', () => {
    it('should call getUpcomingRightsIssues when status is "upcoming"', async () => {
      mockFindAll.mockResolvedValue(paginated([mockUpcomingRightsIPO]));

      const result = await getRightsIssues('upcoming');

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: ['UPCOMING'], sortOrder: 'asc' })
      );
      expect(result).toHaveLength(1);
    });

    it('should call getLiveRightsIssues when status is "live"', async () => {
      mockFindAll.mockResolvedValue(paginated([mockLiveRightsIPO]));

      const result = await getRightsIssues('live');

      expect(mockFindAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: ['OPEN'], sortOrder: 'desc' })
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('clearRightsIssuesCaches', () => {
    it('should delete both upcoming and live cache keys', async () => {
      const mockRedis = { del: vi.fn().mockResolvedValue(2) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);

      await clearRightsIssuesCaches();

      expect(mockRedis.del).toHaveBeenCalledWith('rights:upcoming', 'rights:live');
    });

    it('should handle errors gracefully when clearing caches', async () => {
      const mockRedis = { del: vi.fn().mockRejectedValue(new Error('Redis error')) };
      vi.mocked(redisClient.getRedisClient).mockReturnValue(mockRedis as never);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await clearRightsIssuesCaches();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Data Transformation', () => {
    it('should correctly map fields from IPO to RightsIssueData', async () => {
      mockFindAll.mockResolvedValue(paginated([mockUpcomingRightsIPO]));

      const result = await getUpcomingRightsIssues();

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
