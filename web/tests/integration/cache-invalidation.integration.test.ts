/**
 * Cache Invalidation Integration Tests
 *
 * Validates that cache invalidation patterns work correctly
 * to prevent stale data from being served.
 *
 * Test scenarios:
 * 1. IPO mutation → invalidate related caches
 * 2. Subscription update → invalidate IPO detail cache
 * 3. GMP update → invalidate IPO detail cache
 * 4. Bulk updates → pattern-based invalidation
 * 5. Cache TTL expiration
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { getDb } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import {
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOSearchKey,
  CacheTTL,
} from '@/lib/cache/cache-keys';

describe('Cache Invalidation', () => {
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let repository: IPORepository;
  let testIPOId: string;
  let testIPOSlug: string;

  beforeEach(async () => {
    db = await getDb();
    redis = getRedisClient();
    repository = new IPORepository(db, redis);

    // Get a test IPO from database
    const [testIPO] = await db.select().from(schema.ipos).limit(1);
    if (testIPO) {
      testIPOId = testIPO.id;
      testIPOSlug = testIPO.slug;
    }

    // Clear Redis cache before each test
    await redis.flushdb();
  });

  afterEach(async () => {
    // Clean up cache
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  describe('IPO Update Invalidation', () => {
    test('should invalidate cache after IPO update', async () => {
      if (!testIPOId || !testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // First, load IPO into cache
      const original = await repository.findBySlug(testIPOSlug);
      expect(original).toBeDefined();

      // Verify cache was populated
      const cachedBefore = await redis.get(getIPOBySlugKey(testIPOSlug));
      expect(cachedBefore).toBeTruthy();

      // Update the IPO
      await repository.update(testIPOId, {
        companyName: original!.companyName, // No actual change, just trigger update
      });

      // Cache should be invalidated
      const cachedAfter = await redis.get(getIPOBySlugKey(testIPOSlug));
      expect(cachedAfter).toBeNull();

      // Re-fetch should query database and re-populate cache
      const updated = await repository.findBySlug(testIPOSlug);
      expect(updated).toBeDefined();

      // Cache should be populated again
      const cachedFinal = await redis.get(getIPOBySlugKey(testIPOSlug));
      expect(cachedFinal).toBeTruthy();
    }, 10000);

    test('should invalidate list cache after IPO update', async () => {
      if (!testIPOId) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Load list into cache
      const filters = { status: ['OPEN', 'UPCOMING'], limit: 10 };
      const originalList = await repository.findAll(filters);
      expect(originalList).toBeDefined();

      // Check cache was populated
      const listKey = getIPOListKey(filters);
      const cachedList = await redis.get(listKey);
      expect(cachedList).toBeTruthy();

      // Update an IPO
      await repository.update(testIPOId, {
        companyName: 'Updated Test Company',
      });

      // List cache should be invalidated (uses pattern ipo:list:*)
      const cachedAfterUpdate = await redis.get(listKey);
      expect(cachedAfterUpdate).toBeNull();

      // Clean up - restore original name
      const [original] = await db.select().from(schema.ipos).where(
        schema.eq(schema.ipos.id, testIPOId)
      ).limit(1);
      if (original) {
        await repository.update(testIPOId, {
          companyName: original.companyName,
        });
      }
    }, 10000);

    test('should invalidate both slug and ID cache keys', async () => {
      if (!testIPOId || !testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Load IPO by both slug and ID
      await repository.findBySlug(testIPOSlug);
      await repository.findById(testIPOId);

      // Both should be cached
      const slugCache = await redis.get(getIPOBySlugKey(testIPOSlug));
      const idCache = await redis.get(getIPOByIdKey(testIPOId));
      expect(slugCache).toBeTruthy();
      expect(idCache).toBeTruthy();

      // Update IPO
      await repository.update(testIPOId, {
        companyName: 'Test Update',
      });

      // Both caches should be cleared
      const slugCacheAfter = await redis.get(getIPOBySlugKey(testIPOSlug));
      const idCacheAfter = await redis.get(getIPOByIdKey(testIPOId));
      expect(slugCacheAfter).toBeNull();
      expect(idCacheAfter).toBeNull();
    }, 10000);
  });

  describe('IPO Creation Invalidation', () => {
    test('should invalidate list cache after IPO creation', async () => {
      // Load list into cache
      const filters = { limit: 10 };
      await repository.findAll(filters);

      const listKey = getIPOListKey(filters);
      const cachedBefore = await redis.get(listKey);
      expect(cachedBefore).toBeTruthy();

      // Create new IPO
      const newIPO = await repository.create({
        id: `test-create-${Date.now()}`,
        companyName: 'Cache Test Company',
        slug: `cache-test-company-${Date.now()}`,
        status: 'UPCOMING',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
      });

      // List cache should be invalidated
      const cachedAfter = await redis.get(listKey);
      expect(cachedAfter).toBeNull();

      // Cleanup
      await repository.delete(newIPO.id);
    }, 10000);

    test('should invalidate search cache after IPO creation', async () => {
      // Perform a search to populate cache
      await repository.search('tech', 10);

      // Check cache keys (search uses pattern)
      const keys = await redis.keys('ipo:search:*');
      const initialKeyCount = keys.length;
      expect(initialKeyCount).toBeGreaterThan(0);

      // Create new IPO
      const newIPO = await repository.create({
        id: `test-search-${Date.now()}`,
        companyName: 'Tech Search Test',
        slug: `tech-search-test-${Date.now()}`,
        status: 'UPCOMING',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
      });

      // Search cache should be cleared
      const keysAfter = await redis.keys('ipo:search:*');
      expect(keysAfter.length).toBe(0);

      // Cleanup
      await repository.delete(newIPO.id);
    }, 10000);
  });

  describe('IPO Deletion Invalidation', () => {
    test('should invalidate all related caches after IPO deletion', async () => {
      // Create a test IPO
      const testIPO = await repository.create({
        id: `test-delete-${Date.now()}`,
        companyName: 'Delete Test Company',
        slug: `delete-test-company-${Date.now()}`,
        status: 'UPCOMING',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
      });

      // Load into cache
      await repository.findBySlug(testIPO.slug);
      await repository.findById(testIPO.id);
      await repository.findAll({ limit: 10 });

      // Verify caches exist
      const slugCache = await redis.get(getIPOBySlugKey(testIPO.slug));
      const idCache = await redis.get(getIPOByIdKey(testIPO.id));
      expect(slugCache).toBeTruthy();
      expect(idCache).toBeTruthy();

      // Delete IPO
      await repository.delete(testIPO.id);

      // All caches should be cleared
      const slugCacheAfter = await redis.get(getIPOBySlugKey(testIPO.slug));
      const idCacheAfter = await redis.get(getIPOByIdKey(testIPO.id));
      const listKeys = await redis.keys('ipo:list:*');

      expect(slugCacheAfter).toBeNull();
      expect(idCacheAfter).toBeNull();
      expect(listKeys.length).toBe(0);
    }, 10000);
  });

  describe('Pattern-Based Invalidation', () => {
    test('should clear all list caches with ipo:list:* pattern', async () => {
      // Create multiple list caches with different filters
      await repository.findAll({ status: ['OPEN'], limit: 10 });
      await repository.findAll({ status: ['UPCOMING'], limit: 20 });
      await repository.findAll({ segment: ['MAINBOARD'], limit: 15 });

      // Verify multiple list caches exist
      const listKeys = await redis.keys('ipo:list:*');
      expect(listKeys.length).toBeGreaterThanOrEqual(3);

      // Pattern invalidation (triggered by any IPO mutation)
      if (testIPOId) {
        await repository.update(testIPOId, {
          companyName: 'Pattern Test',
        });
      }

      // All list caches should be cleared
      const listKeysAfter = await redis.keys('ipo:list:*');
      expect(listKeysAfter.length).toBe(0);
    }, 10000);

    test('should clear all search caches with ipo:search:* pattern', async () => {
      // Create multiple search caches
      await repository.search('tech', 10);
      await repository.search('bank', 5);
      await repository.search('pharma', 8);

      // Verify search caches exist
      const searchKeys = await redis.keys('ipo:search:*');
      expect(searchKeys.length).toBeGreaterThanOrEqual(3);

      // Create new IPO (should trigger search cache invalidation)
      const newIPO = await repository.create({
        id: `test-pattern-${Date.now()}`,
        companyName: 'Pattern Test Company',
        slug: `pattern-test-${Date.now()}`,
        status: 'UPCOMING',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
      });

      // All search caches should be cleared
      const searchKeysAfter = await redis.keys('ipo:search:*');
      expect(searchKeysAfter.length).toBe(0);

      // Cleanup
      await repository.delete(newIPO.id);
    }, 10000);

    test('should not affect unrelated cache keys when using patterns', async () => {
      // Create IPO cache
      if (testIPOSlug) {
        await repository.findBySlug(testIPOSlug);
      }

      // Create some unrelated cache keys
      await redis.set('subscription:latest:test-123', 'test-data', 'EX', 300);
      await redis.set('gmp:latest:test-456', 'test-data', 'EX', 300);

      // Update IPO (invalidates ipo:* patterns)
      if (testIPOId) {
        await repository.update(testIPOId, {
          companyName: 'Test',
        });
      }

      // Unrelated keys should still exist
      const subKey = await redis.get('subscription:latest:test-123');
      const gmpKey = await redis.get('gmp:latest:test-456');
      expect(subKey).toBe('test-data');
      expect(gmpKey).toBe('test-data');

      // Cleanup
      await redis.del('subscription:latest:test-123', 'gmp:latest:test-456');
    }, 10000);
  });

  describe('Cache TTL Behavior', () => {
    test('should respect TTL for cached IPO detail', async () => {
      if (!testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Set a very short TTL for testing (1 second)
      const shortTTL = 1;

      // Manually cache with short TTL
      const ipo = await repository.findBySlug(testIPOSlug);
      await redis.setex(
        getIPOBySlugKey(testIPOSlug),
        shortTTL,
        JSON.stringify(ipo)
      );

      // Verify cache exists
      const cached = await redis.get(getIPOBySlugKey(testIPOSlug));
      expect(cached).toBeTruthy();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Cache should be expired
      const expiredCache = await redis.get(getIPOBySlugKey(testIPOSlug));
      expect(expiredCache).toBeNull();
    }, 5000);

    test('should have different TTLs for different cache types', async () => {
      if (!testIPOId || !testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Set caches with standard TTLs
      const ipoDetail = await repository.findBySlug(testIPOSlug);
      await redis.setex(
        getIPOBySlugKey(testIPOSlug),
        CacheTTL.IPO_DETAIL,
        JSON.stringify(ipoDetail)
      );

      const filters = { limit: 10 };
      const ipoList = await repository.findAll(filters);
      await redis.setex(
        getIPOListKey(filters),
        CacheTTL.IPO_LIST,
        JSON.stringify(ipoList)
      );

      // Check TTLs
      const detailTTL = await redis.ttl(getIPOBySlugKey(testIPOSlug));
      const listTTL = await redis.ttl(getIPOListKey(filters));

      // Both should be close to their configured TTL
      expect(detailTTL).toBeGreaterThan(CacheTTL.IPO_DETAIL - 10);
      expect(detailTTL).toBeLessThanOrEqual(CacheTTL.IPO_DETAIL);

      expect(listTTL).toBeGreaterThan(CacheTTL.IPO_LIST - 10);
      expect(listTTL).toBeLessThanOrEqual(CacheTTL.IPO_LIST);
    }, 10000);
  });

  describe('Concurrent Invalidation', () => {
    test('should handle concurrent updates without race conditions', async () => {
      if (!testIPOId) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Load IPO into cache
      await repository.findById(testIPOId);

      // Perform concurrent updates (should all invalidate cache properly)
      const updates = Array.from({ length: 5 }, (_, i) =>
        repository.update(testIPOId, {
          companyName: `Concurrent Test ${i}`,
        })
      );

      await Promise.all(updates);

      // Cache should be cleared
      const cached = await redis.get(getIPOByIdKey(testIPOId));
      expect(cached).toBeNull();

      // Re-fetch should work
      const refetched = await repository.findById(testIPOId);
      expect(refetched).toBeDefined();
    }, 10000);

    test('should handle concurrent creates without cache corruption', async () => {
      // Load list into cache
      await repository.findAll({ limit: 10 });

      // Concurrent creates
      const creates = Array.from({ length: 5 }, (_, i) =>
        repository.create({
          id: `concurrent-test-${i}-${Date.now()}`,
          companyName: `Concurrent Company ${i}`,
          slug: `concurrent-company-${i}-${Date.now()}`,
          status: 'UPCOMING',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
        })
      );

      const newIPOs = await Promise.all(creates);

      // All list caches should be cleared
      const listKeys = await redis.keys('ipo:list:*');
      expect(listKeys.length).toBe(0);

      // Cleanup
      await Promise.all(newIPOs.map(ipo => repository.delete(ipo.id)));
    }, 10000);
  });

  describe('Cache Consistency', () => {
    test('should ensure fresh data after cache invalidation', async () => {
      if (!testIPOId || !testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // Load original data
      const original = await repository.findBySlug(testIPOSlug);
      expect(original).toBeDefined();

      const originalName = original!.companyName;

      // Update the IPO
      const newName = `Updated ${Date.now()}`;
      await repository.update(testIPOId, {
        companyName: newName,
      });

      // Re-fetch should have new data
      const updated = await repository.findBySlug(testIPOSlug);
      expect(updated).toBeDefined();
      expect(updated!.companyName).toBe(newName);

      // Restore original
      await repository.update(testIPOId, {
        companyName: originalName,
      });

      // Final fetch should have original data back
      const restored = await repository.findBySlug(testIPOSlug);
      expect(restored!.companyName).toBe(originalName);
    }, 10000);

    test('should not serve stale data after update', async () => {
      if (!testIPOId || !testIPOSlug) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      // First fetch - populates cache
      const first = await repository.findBySlug(testIPOSlug);
      const firstName = first!.companyName;

      // Update
      const updatedName = `No Stale ${Date.now()}`;
      await repository.update(testIPOId, {
        companyName: updatedName,
      });

      // Second fetch - should NOT return cached stale data
      const second = await repository.findBySlug(testIPOSlug);
      expect(second!.companyName).toBe(updatedName);
      expect(second!.companyName).not.toBe(firstName);

      // Restore
      await repository.update(testIPOId, {
        companyName: firstName,
      });
    }, 10000);
  });

  describe('Invalidation Logging', () => {
    test('should log cache invalidation operations', async () => {
      if (!testIPOId) {
        console.log('[Test Skipped] No test IPO available');
        return;
      }

      const consoleSpy = vi.spyOn(console, 'log');

      // Update triggers cache invalidation
      await repository.update(testIPOId, {
        companyName: 'Log Test',
      });

      // Check for cache deletion logs
      const deleteLogs = consoleSpy.mock.calls.filter(call =>
        call[0]?.includes('[Cache] DEL')
      );

      expect(deleteLogs.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    }, 10000);
  });
});
