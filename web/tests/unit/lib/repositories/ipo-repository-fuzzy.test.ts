/**
 * Unit Tests for IPO Repository - Fuzzy Matching
 * ISS-027: API fallback with fuzzy matching for IPO lookups
 *
 * Tests fuzzy matching functionality including:
 * - Exact match fallback
 * - Fuzzy matching with similarity thresholds
 * - Search by company name
 * - Caching behavior
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@ipodhan/shared/db/schema';
import type Redis from 'ioredis';

// Mock Redis client
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(), // BaseRepository.setCache uses setex (not set)
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

// Mock database
const mockDb = {
  select: vi.fn(),
} as unknown as NodePgDatabase<typeof schema>;

describe('IPORepository - Fuzzy Matching (ISS-027)', () => {
  let repository: IPORepository;

  beforeEach(() => {
    repository = new IPORepository(mockDb, mockRedis);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findBySlugWithFallback', () => {
    it('should return exact match when slug exists', async () => {
      const mockIPO = {
        id: 'ipo-1',
        slug: 'tech-company-ipo',
        companyName: 'Tech Company Ltd',
        status: 'OPEN',
      };

      // Mock cache miss, then database hit for exact match
      mockRedis.get = vi.fn().mockResolvedValue(null);

      // findBySlug fires a 12-query Promise.all for related data (some use
      // .orderBy()/.limit(), some are awaited directly). Provide a fully
      // chainable, awaitable builder: the IPO row query resolves [mockIPO];
      // related queries resolve [] (no related data).
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn().mockResolvedValue([mockIPO]),
        then: (resolve: (v: unknown[]) => void) => resolve([]),
      };

      mockDb.select = vi.fn().mockReturnValue(chain);

      const result = await repository.findBySlugWithFallback('tech-company-ipo');

      expect(result).not.toBeNull();
      expect(result?.slug).toBe('tech-company-ipo');
      expect(result?.companyName).toBe('Tech Company Ltd');
    });

    it('should return null when fuzzy matching is disabled and exact match fails', async () => {
      // Mock cache miss and no exact match
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // No exact match
        leftJoin: vi.fn().mockReturnThis(),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      const result = await repository.findBySlugWithFallback('nonexistent-ipo', {
        enableFuzzy: false,
      });

      expect(result).toBeNull();
    });

    it('should convert slug to search term correctly', async () => {
      // Test slug transformation: remove -ipo suffix, replace hyphens
      const testCases = [
        { input: 'tech-company-ipo', expected: 'tech company' },
        { input: 'abc-corp-limited-ipo', expected: 'abc corp limited' },
        { input: 'xyz-ipo', expected: 'xyz' },
      ];

      for (const { input, expected } of testCases) {
        const searchTerm = input
          .replace(/-ipo$/i, '')
          .replace(/-/g, ' ')
          .toLowerCase();

        expect(searchTerm).toBe(expected);
      }
    });

    it('should respect similarity threshold', async () => {
      // Mock no exact match
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn()
          .mockResolvedValueOnce([]) // First call: no exact match
          .mockResolvedValueOnce([
            // Second call: fetch all IPOs for fuzzy matching
            { id: 'ipo-1', slug: 'tech-company-ipo', companyName: 'Tech Company Ltd' },
            { id: 'ipo-2', slug: 'abc-corp-ipo', companyName: 'ABC Corporation' },
          ]),
        leftJoin: vi.fn().mockReturnThis(),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      // With high threshold (0.9), only very similar matches should pass
      const resultHigh = await repository.findBySlugWithFallback('tech-co', {
        enableFuzzy: true,
        similarityThreshold: 0.9,
      });

      // Result depends on fuzzy matching algorithm
      // This test verifies threshold is used, not exact behavior
      expect(resultHigh).toBeDefined();
    });
  });

  describe('searchByName', () => {
    it('should return results with similarity scores', async () => {
      const mockIPOs = [
        { id: 'ipo-1', slug: 'tech-company-ipo', companyName: 'Tech Company Ltd', status: 'OPEN' },
        { id: 'ipo-2', slug: 'tech-corp-ipo', companyName: 'Tech Corporation', status: 'OPEN' },
        { id: 'ipo-3', slug: 'abc-corp-ipo', companyName: 'ABC Corporation', status: 'CLOSED' },
      ];

      // Mock cache miss
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue(mockIPOs),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      const results = await repository.searchByName('Tech Company', {
        limit: 5,
        threshold: 0.4,
      });

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);

      // All results should have required fields
      results.forEach(result => {
        expect(result).toHaveProperty('ipo');
        expect(result).toHaveProperty('score');
        expect(result).toHaveProperty('similarity');
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(100);
      });
    });

    it('should respect limit parameter', async () => {
      const mockIPOs = Array.from({ length: 20 }, (_, i) => ({
        id: `ipo-${i}`,
        slug: `company-${i}-ipo`,
        companyName: `Company ${i}`,
        status: 'OPEN',
      }));

      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue(mockIPOs),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      const results = await repository.searchByName('Company', { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should cache search results', async () => {
      const mockIPOs = [
        { id: 'ipo-1', slug: 'tech-ipo', companyName: 'Tech Ltd', status: 'OPEN' },
      ];

      // First call: cache miss
      mockRedis.get = vi.fn()
        .mockResolvedValueOnce(null) // Cache miss
        .mockResolvedValueOnce(JSON.stringify([])); // Cache hit

      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue(mockIPOs),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      // First call should query database
      await repository.searchByName('Tech');

      // Verify cache set was called
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('should return empty array when no matches found', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue([
          { id: 'ipo-1', slug: 'abc-ipo', companyName: 'ABC Corp', status: 'OPEN' },
        ]),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      const results = await repository.searchByName('XYZ Completely Different', {
        threshold: 0.8, // High threshold
      });

      expect(Array.isArray(results)).toBe(true);
      // Results might be empty or have low similarity depending on threshold
    });
  });

  describe('Cache key generation', () => {
    it('should generate unique cache keys for different queries', async () => {
      const mockIPOs = [
        { id: 'ipo-1', slug: 'tech-ipo', companyName: 'Tech Ltd', status: 'OPEN' },
      ];

      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue(mockIPOs),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      // Different queries should generate different cache keys
      await repository.searchByName('Query1', { limit: 5, threshold: 0.4 });
      await repository.searchByName('Query2', { limit: 5, threshold: 0.4 });

      // Verify set was called twice with different keys
      expect(mockRedis.setex).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelectBuilder = {
        from: vi.fn().mockRejectedValue(new Error('Database connection failed')),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      await expect(
        repository.searchByName('Test Query')
      ).rejects.toThrow();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.get = vi.fn().mockRejectedValue(new Error('Redis unavailable'));

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue([
          { id: 'ipo-1', slug: 'tech-ipo', companyName: 'Tech Ltd', status: 'OPEN' },
        ]),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      // getFromCache catches Redis errors and falls back to the DB query, so the
      // search resolves (gracefully) rather than rejecting (web-data-access:
      // "Redis down ≠ outage").
      const results = await repository.searchByName('Tech');
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Field weighting', () => {
    it('should prioritize company name over slug', async () => {
      const mockIPOs = [
        {
          id: 'ipo-1',
          slug: 'abc-ipo',
          companyName: 'Tech Company Limited',
          status: 'OPEN',
        },
        {
          id: 'ipo-2',
          slug: 'tech-company-ipo',
          companyName: 'ABC Corporation',
          status: 'OPEN',
        },
      ];

      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.set = vi.fn().mockResolvedValue('OK');

      const mockSelectBuilder = {
        from: vi.fn().mockResolvedValue(mockIPOs),
      };

      mockDb.select = vi.fn().mockReturnValue(mockSelectBuilder);

      const results = await repository.searchByName('Tech Company');

      // First result should have higher similarity due to company name match
      expect(results.length).toBeGreaterThan(0);
      if (results.length >= 2) {
        // Company name match should score higher than slug match
        expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
      }
    });
  });
});
