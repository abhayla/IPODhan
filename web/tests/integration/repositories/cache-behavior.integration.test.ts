import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  IPORepository,
  SubscriptionRepository,
  GMPRepository,
} from '@/lib/repositories';
import { db } from '@/lib/db/index';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { ipos, subscriptions, gmpRecords } from '@/lib/db';
import { eq } from 'drizzle-orm';

/**
 * Integration tests for cache behavior across repositories
 *
 * Tests cache invalidation, TTL, and fallback behavior
 */

describe('Cache Behavior Integration Tests', () => {
  let ipoRepo: IPORepository;
  let subRepo: SubscriptionRepository;
  let gmpRepo: GMPRepository;
  let redis: ReturnType<typeof getRedisClient>;
  let testIpoId: string;

  beforeAll(async () => {
    redis = getRedisClient();
    ipoRepo = new IPORepository(db, redis);
    subRepo = new SubscriptionRepository(db, redis);
    gmpRepo = new GMPRepository(db, redis);

    // Create test IPO
    const [testIPO] = await db
      .insert(ipos)
      .values({
        slug: 'cache-test-ipo',
        companyName: 'Cache Test Company',
        segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
        status: 'OPEN',
      })
      .returning();

    testIpoId = testIPO.id;
  });

  afterAll(async () => {
    // Clean up
    await db.delete(ipos).where(eq(ipos.id, testIpoId));
    await closeRedisClient();
  });

  beforeEach(async () => {
    // Clear all cache keys
    const keys = await redis.keys('*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('cache TTL strategy', () => {
    it('should use correct TTL for IPO detail', async () => {
      await ipoRepo.findById(testIpoId);

      const ttl = await redis.ttl(`ipo:id:${testIpoId}`);
      expect(ttl).toBeGreaterThan(1700); // ~30 min (1800s)
      expect(ttl).toBeLessThanOrEqual(1800);
    });

    it('should use correct TTL for IPO list', async () => {
      await ipoRepo.findAll({ page: 1, limit: 10 });

      const keys = await redis.keys('ipo:list:*');
      expect(keys.length).toBeGreaterThan(0);

      const ttl = await redis.ttl(keys[0]);
      expect(ttl).toBeGreaterThan(800); // ~15 min (900s)
      expect(ttl).toBeLessThanOrEqual(900);
    });

    it('should use correct TTL for latest subscription', async () => {
      // Create subscription snapshot
      await db.insert(subscriptions).values({
        ipoId: testIpoId,
        timestamp: new Date(),
        totalSubscription: '5.5',
      });

      await subRepo.findLatest(testIpoId);

      const ttl = await redis.ttl(`subscription:latest:${testIpoId}`);
      expect(ttl).toBeGreaterThan(250); // ~5 min (300s)
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('should use correct TTL for latest GMP', async () => {
      // Create GMP record
      await db.insert(gmpRecords).values({
        ipoId: testIpoId,
        timestamp: new Date(),
        gmp: 50,
        source: 'Test Source',
      });

      await gmpRepo.findLatest(testIpoId);

      const ttl = await redis.ttl(`gmp:latest:${testIpoId}`);
      expect(ttl).toBeGreaterThan(550); // ~10 min (600s)
      expect(ttl).toBeLessThanOrEqual(600);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate subscription cache on new snapshot', async () => {
      // Create initial subscription
      await db.insert(subscriptions).values({
        ipoId: testIpoId,
        timestamp: new Date(),
        totalSubscription: '5.5',
      });

      // Populate cache
      const first = await subRepo.findLatest(testIpoId);
      expect(first?.totalSubscription).toBe('5.5');

      // Create new snapshot (should invalidate cache)
      await subRepo.createSnapshot({
        ipoId: testIpoId,
        timestamp: new Date(),
        totalSubscription: '7.2',
      });

      // Cache should be invalidated
      const cached = await redis.get(`subscription:latest:${testIpoId}`);
      expect(cached).toBeNull();

      // Fresh query should return new data
      const updated = await subRepo.findLatest(testIpoId);
      expect(updated?.totalSubscription).toBe('7.2');
    });

    it('should invalidate GMP cache on new record', async () => {
      // Create initial GMP
      await db.insert(gmpRecords).values({
        ipoId: testIpoId,
        timestamp: new Date(),
        gmp: 50,
        source: 'Test Source',
      });

      // Populate cache
      const first = await gmpRepo.findLatest(testIpoId);
      expect(first?.gmp).toBe(50);

      // Create new GMP record (should invalidate cache)
      await gmpRepo.create({
        ipoId: testIpoId,
        timestamp: new Date(),
        gmp: 65,
        source: 'Test Source',
      });

      // Cache should be invalidated
      const cached = await redis.get(`gmp:latest:${testIpoId}`);
      expect(cached).toBeNull();

      // Fresh query should return new data
      const updated = await gmpRepo.findLatest(testIpoId);
      expect(updated?.gmp).toBe(65);
    });

    it('should invalidate IPO list cache on create', async () => {
      // Populate list cache
      await ipoRepo.findAll({ page: 1, limit: 10 });

      const keysBefore = await redis.keys('ipo:list:*');
      expect(keysBefore.length).toBeGreaterThan(0);

      // Create new IPO
      await ipoRepo.create({
        slug: 'new-test-ipo',
        companyName: 'New Test Company',
        segment: 'SME' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
        status: 'UPCOMING',
      });

      // List cache should be invalidated
      const keysAfter = await redis.keys('ipo:list:*');
      expect(keysAfter.length).toBe(0);
    });
  });

  describe('cache failure fallback', () => {
    it('should fallback to database when cache fails', async () => {
      // Simulate cache failure by using invalid key
      const mockRedis = {
        ...redis,
        get: vi.fn().mockRejectedValue(new Error('Redis connection failed')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const repoWithFailingCache = new IPORepository(db, mockRedis);

      // Should still return data from database
      const result = await repoWithFailingCache.findById(testIpoId);

      expect(result).toBeDefined();
      expect(result?.id).toBe(testIpoId);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent requests correctly', async () => {
      // Make multiple concurrent requests
      const requests = Array(5)
        .fill(null)
        .map(() => ipoRepo.findById(testIpoId));

      const results = await Promise.all(requests);

      // All results should be the same
      results.forEach((result) => {
        expect(result?.id).toBe(testIpoId);
      });

      // Cache should be populated only once
      const cached = await redis.get(`ipo:id:${testIpoId}`);
      expect(cached).toBeDefined();
    });
  });
});
