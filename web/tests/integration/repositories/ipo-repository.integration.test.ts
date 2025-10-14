import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { db } from '@/lib/db/index';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for IPORepository
 *
 * These tests require:
 * - PostgreSQL test database (ipodhan_test)
 * - Redis instance running
 * - TEST_DATABASE_URL environment variable
 * - REDIS_HOST, REDIS_PORT environment variables
 */

describe('IPORepository Integration Tests', () => {
  let repository: IPORepository;
  let redis: ReturnType<typeof getRedisClient>;

  beforeAll(async () => {
    redis = getRedisClient();
    repository = new IPORepository(db, redis);

    // Clean up any existing test data
    await db.delete(ipos).where(eq(ipos.slug, 'test-integration-ipo'));
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(ipos).where(eq(ipos.slug, 'test-integration-ipo'));
    await closeRedisClient();
  });

  beforeEach(async () => {
    // Clear cache before each test
    const keys = await redis.keys('ipo:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('create and findById', () => {
    it('should create IPO and retrieve it by ID', async () => {
      const ipoData = {
        slug: 'test-integration-ipo',
        companyName: 'Test Integration Company',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
        sector: 'Technology',
        issueSize: '500',
        priceRangeMin: 100,
        priceRangeMax: 120,
        lotSize: 125,
      };

      const createdIPO = await repository.create(ipoData);

      expect(createdIPO.id).toBeDefined();
      expect(createdIPO.slug).toBe('test-integration-ipo');

      // Verify cache was invalidated
      const listKeys = await redis.keys('ipo:list:*');
      expect(listKeys.length).toBe(0);

      // Retrieve by ID (should query DB and populate cache)
      const retrievedIPO = await repository.findById(createdIPO.id);

      expect(retrievedIPO).toBeDefined();
      expect(retrievedIPO?.slug).toBe('test-integration-ipo');

      // Verify cache was populated
      const cacheKey = `ipo:id:${createdIPO.id}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      // Retrieve again (should hit cache)
      const cachedIPO = await repository.findById(createdIPO.id);
      expect(cachedIPO).toEqual(retrievedIPO);
    });
  });

  describe('findBySlug', () => {
    it('should find IPO by slug with relations', async () => {
      const ipoData = {
        slug: 'test-integration-ipo',
        companyName: 'Test Integration Company',
        category: 'MAINBOARD' as const,
        status: 'OPEN' as const,
      };

      await repository.create(ipoData);

      const result = await repository.findBySlug('test-integration-ipo');

      expect(result).toBeDefined();
      expect(result?.slug).toBe('test-integration-ipo');
      expect(result?.financialData).toBeDefined();
      expect(result?.documents).toBeDefined();
      expect(result?.subscriptions).toBeDefined();
      expect(result?.gmpRecords).toBeDefined();
    });
  });

  describe('cache behavior', () => {
    it('should cache IPO detail and serve from cache on subsequent requests', async () => {
      const ipoData = {
        slug: 'test-integration-ipo',
        companyName: 'Test Integration Company',
        category: 'SME' as const,
        status: 'UPCOMING' as const,
      };

      const createdIPO = await repository.create(ipoData);

      // First request - cache miss
      const firstRequest = await repository.findById(createdIPO.id);

      // Verify cache was populated
      const cacheKey = `ipo:id:${createdIPO.id}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      // Second request - cache hit
      const secondRequest = await repository.findById(createdIPO.id);

      expect(firstRequest).toEqual(secondRequest);
    });

    it('should invalidate cache on update', async () => {
      const ipoData = {
        slug: 'test-integration-ipo',
        companyName: 'Test Integration Company',
        category: 'MAINBOARD' as const,
        status: 'UPCOMING' as const,
      };

      const createdIPO = await repository.create(ipoData);

      // Populate cache
      await repository.findById(createdIPO.id);

      // Update IPO
      await repository.update(createdIPO.id, {
        status: 'OPEN' as const,
      });

      // Verify cache was invalidated
      const cacheKey = `ipo:id:${createdIPO.id}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeNull();
    });
  });

  describe('search', () => {
    it('should search IPOs by company name', async () => {
      const ipoData = {
        slug: 'test-integration-ipo',
        companyName: 'Reliance Power Limited',
        category: 'MAINBOARD' as const,
        status: 'LISTED' as const,
      };

      await repository.create(ipoData);

      const results = await repository.search('Reliance', 10);

      expect(results.length).toBeGreaterThan(0);
      const found = results.find((ipo) => ipo.slug === 'test-integration-ipo');
      expect(found).toBeDefined();
    });
  });

  describe('pagination', () => {
    it('should return paginated results', async () => {
      const result = await repository.findAll({
        page: 1,
        limit: 5,
      });

      expect(result.data).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(5);
      expect(result.data.length).toBeLessThanOrEqual(5);
    });
  });
});
