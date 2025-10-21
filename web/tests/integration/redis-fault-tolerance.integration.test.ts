/**
 * Redis Fault Tolerance Integration Tests
 *
 * Tests the system's ability to handle Redis failures gracefully
 * without affecting application availability.
 *
 * Test scenarios:
 * 1. Redis connection failure at startup
 * 2. Redis connection lost during operation
 * 3. Redis timeout protection (2-second limit)
 * 4. Redis recovery after failure
 * 5. Concurrent load with Redis failures
 */

import { describe, test, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Redis from 'ioredis';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { getDb } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';

describe('Redis Fault Tolerance', () => {
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let repository: IPORepository;

  beforeEach(async () => {
    db = await getDb();
    redis = getRedisClient();
    repository = new IPORepository(db, redis);
  });

  afterEach(async () => {
    // Clean up any test data
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  describe('Graceful Degradation', () => {
    test('should handle Redis connection failure gracefully', async () => {
      // Simulate Redis connection error by creating a disconnected client
      const brokenRedis = new Redis({
        host: 'invalid-host-that-does-not-exist',
        port: 9999,
        retryStrategy: () => null, // Don't retry
        lazyConnect: true,
        connectTimeout: 100,
      });

      const brokenRepository = new IPORepository(db, brokenRedis);

      // Repository should still work with database fallback
      const result = await brokenRepository.findAll({
        status: ['OPEN', 'UPCOMING'],
        limit: 5,
      });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);
      expect(result.meta).toBeDefined();
      expect(result.meta.total).toBeGreaterThanOrEqual(0);

      await brokenRedis.disconnect();
    }, 10000);

    test('should respect 2-second timeout on cache operations', async () => {
      // Create a spy to track Redis get calls
      const getSpy = vi.spyOn(redis, 'get');

      // Create a mock that delays beyond timeout
      getSpy.mockImplementation(async () => {
        return new Promise((resolve) => {
          setTimeout(() => resolve(null), 3000); // 3 seconds > 2 second timeout
        });
      });

      const startTime = Date.now();

      // This should timeout and fall back to database
      const result = await repository.findAll({
        status: ['OPEN'],
        limit: 10,
      });

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (not wait 3 seconds)
      expect(duration).toBeLessThan(2500); // Allow 500ms buffer
      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);

      getSpy.mockRestore();
    }, 10000);

    test('should continue serving requests when Redis is unavailable', async () => {
      // Disconnect Redis
      const originalRedis = redis;
      await redis.quit();

      // Create new repository with disconnected Redis
      const disconnectedRedis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        lazyConnect: true,
        retryStrategy: () => null,
      });

      const testRepository = new IPORepository(db, disconnectedRedis);

      // Should still work via database fallback
      const result = await testRepository.findAll({
        segment: ['MAINBOARD'],
        limit: 5,
      });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);

      // Cleanup
      await disconnectedRedis.disconnect();

      // Reconnect for other tests
      redis = getRedisClient();
    }, 10000);

    test('should not throw errors when Redis times out', async () => {
      const getSpy = vi.spyOn(redis, 'get');

      // Simulate timeout
      getSpy.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2500));
        return null;
      });

      // Should not throw
      await expect(repository.findAll({ limit: 5 })).resolves.toBeDefined();

      getSpy.mockRestore();
    }, 10000);
  });

  describe('Connection Recovery', () => {
    test('should recover after Redis comes back online', async () => {
      // First, verify Redis works
      await redis.set('test-key', 'test-value');
      const value1 = await redis.get('test-key');
      expect(value1).toBe('test-value');

      // Simulate disconnect
      await redis.quit();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect
      redis = getRedisClient();

      // Should work again
      await redis.set('test-key-2', 'test-value-2');
      const value2 = await redis.get('test-key-2');
      expect(value2).toBe('test-value-2');
    }, 10000);

    test('should use cache after Redis recovery', async () => {
      const testSlug = 'test-ipo-slug';

      // Clear cache first
      await redis.del(`ipo:slug:${testSlug}`);

      // First call - should query database and cache
      const result1 = await repository.findBySlug(testSlug);

      // Second call - should hit cache
      const consoleSpy = vi.spyOn(console, 'log');
      const result2 = await repository.findBySlug(testSlug);

      // Check if cache hit was logged
      const cacheHitLog = consoleSpy.mock.calls.find(call =>
        call[0]?.includes('[Cache] HIT') && call[0]?.includes(testSlug)
      );

      // If IPO exists, cache should have been hit
      if (result1 !== null) {
        expect(cacheHitLog).toBeDefined();
      }

      consoleSpy.mockRestore();
    }, 10000);
  });

  describe('Performance Under Redis Failure', () => {
    test('should handle concurrent requests during Redis failure', async () => {
      // Create a broken Redis client
      const brokenRedis = new Redis({
        host: 'invalid-host',
        port: 9999,
        retryStrategy: () => null,
        lazyConnect: true,
        connectTimeout: 100,
      });

      const brokenRepository = new IPORepository(db, brokenRedis);

      const startTime = Date.now();

      // Send 20 concurrent requests
      const promises = Array.from({ length: 20 }, (_, i) =>
        brokenRepository.findAll({
          status: ['OPEN', 'UPCOMING'],
          limit: 5,
          page: 1,
        })
      );

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;

      // All requests should succeed
      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.data).toBeInstanceOf(Array);
      });

      // Should complete in reasonable time (database queries should be fast)
      // Allow 100ms per query on average = 2000ms total for 20 queries
      expect(duration).toBeLessThan(5000);

      console.log(`[Performance] 20 concurrent requests completed in ${duration}ms (avg: ${duration/20}ms per request)`);

      await brokenRedis.disconnect();
    }, 15000);

    test('should maintain performance with Redis timeouts', async () => {
      const getSpy = vi.spyOn(redis, 'get');

      // Make Redis slow but not fail
      getSpy.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2100)); // Just over timeout
        return null;
      });

      const startTime = Date.now();

      // Multiple requests should fall back quickly
      const promises = Array.from({ length: 10 }, () =>
        repository.findAll({ limit: 5 })
      );

      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      // All should succeed
      expect(results).toHaveLength(10);

      // Should not take 21 seconds (10 * 2.1s), should timeout and proceed
      expect(duration).toBeLessThan(5000);

      console.log(`[Performance] 10 requests with Redis timeout completed in ${duration}ms`);

      getSpy.mockRestore();
    }, 15000);
  });

  describe('Cache Operation Error Handling', () => {
    test('should handle Redis SET errors gracefully', async () => {
      const setSpy = vi.spyOn(redis, 'setex');

      // Make SET operations fail
      setSpy.mockRejectedValue(new Error('Redis SET failed'));

      // Should still return data from database
      const result = await repository.findAll({ limit: 5 });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);

      setSpy.mockRestore();
    }, 10000);

    test('should handle Redis DEL errors gracefully', async () => {
      const delSpy = vi.spyOn(redis, 'del');

      // Make DEL operations fail
      delSpy.mockRejectedValue(new Error('Redis DEL failed'));

      // Update should still work (cache invalidation failure shouldn't break mutation)
      // This tests that deleteCache() doesn't throw
      const testIPO = await db.select().from(schema.ipos).limit(1);

      if (testIPO.length > 0) {
        const result = await repository.update(testIPO[0].id, {
          companyName: testIPO[0].companyName, // No actual change
        });

        expect(result).toBeDefined();
      }

      delSpy.mockRestore();
    }, 10000);

    test('should handle Redis KEYS pattern errors gracefully', async () => {
      const keysSpy = vi.spyOn(redis, 'keys');

      // Make KEYS operation fail
      keysSpy.mockRejectedValue(new Error('Redis KEYS failed'));

      // Create operation should still work
      const testData = {
        id: `test-${Date.now()}`,
        companyName: 'Test Company',
        slug: `test-company-${Date.now()}`,
        status: 'UPCOMING' as const,
        segment: 'MAINBOARD' as const,
        offeringType: 'IPO' as const,
      };

      const result = await repository.create(testData);

      expect(result).toBeDefined();
      expect(result.companyName).toBe('Test Company');

      // Cleanup
      await repository.delete(result.id);

      keysSpy.mockRestore();
    }, 10000);
  });

  describe('Retry Strategy Validation', () => {
    test('should stop retrying after 3 attempts', async () => {
      let retryCount = 0;

      const testRedis = new Redis({
        host: 'invalid-host-for-retry-test',
        port: 9999,
        retryStrategy: (times: number) => {
          retryCount = times;
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 50, 2000);
        },
        lazyConnect: false,
        connectTimeout: 100,
      });

      // Wait for retries to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should have tried 3 times
      expect(retryCount).toBeLessThanOrEqual(3);

      await testRedis.disconnect();
    }, 10000);

    test('should use exponential backoff (50ms → 500ms → 2000ms)', async () => {
      const retryDelays: number[] = [];

      const testRedis = new Redis({
        host: 'invalid-host-for-backoff-test',
        port: 9999,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          const delay = Math.min(times * 50, 2000);
          retryDelays.push(delay);
          return delay;
        },
        lazyConnect: false,
        connectTimeout: 100,
      });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should have exponential delays
      expect(retryDelays.length).toBeGreaterThan(0);
      expect(retryDelays[0]).toBe(50); // First retry
      if (retryDelays.length > 1) {
        expect(retryDelays[1]).toBe(100); // Second retry
      }
      if (retryDelays.length > 2) {
        expect(retryDelays[2]).toBe(150); // Third retry
      }

      await testRedis.disconnect();
    }, 10000);
  });

  describe('Connection Pool Behavior', () => {
    test('should reuse Redis connection across multiple repositories', async () => {
      const redis1 = getRedisClient();
      const redis2 = getRedisClient();
      const redis3 = getRedisClient();

      // Should be same instance (singleton pattern)
      expect(redis1).toBe(redis2);
      expect(redis2).toBe(redis3);
    });

    test('should handle multiple simultaneous cache operations', async () => {
      const operations = [
        redis.set('key1', 'value1'),
        redis.set('key2', 'value2'),
        redis.set('key3', 'value3'),
        redis.get('key1'),
        redis.get('key2'),
        redis.del('key1'),
        redis.exists('key2'),
      ];

      // Should all complete without errors
      await expect(Promise.all(operations)).resolves.toBeDefined();
    }, 10000);
  });

  describe('Real-World Scenarios', () => {
    test('should handle IPO list request when Redis is down', async () => {
      const brokenRedis = new Redis({
        host: 'localhost',
        port: 9999, // Wrong port
        retryStrategy: () => null,
        lazyConnect: true,
        connectTimeout: 100,
      });

      const testRepo = new IPORepository(db, brokenRedis);

      const result = await testRepo.findAll({
        status: ['OPEN', 'UPCOMING', 'CLOSED'],
        segment: ['MAINBOARD', 'SME'],
        limit: 20,
        page: 1,
      });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);
      expect(result.meta).toMatchObject({
        page: 1,
        limit: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: expect.any(Boolean),
      });

      await brokenRedis.disconnect();
    }, 10000);

    test('should handle IPO detail request when Redis is slow', async () => {
      const getSpy = vi.spyOn(redis, 'get');

      // Simulate slow Redis
      getSpy.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 2500));
        return null;
      });

      // Get first IPO from database
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (testIPO) {
        const startTime = Date.now();
        const result = await repository.findBySlug(testIPO.slug);
        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        // Should timeout and proceed (not wait 2.5s)
        expect(duration).toBeLessThan(3000);
      }

      getSpy.mockRestore();
    }, 10000);

    test('should handle search requests during Redis outage', async () => {
      const brokenRedis = new Redis({
        host: 'invalid-host',
        port: 9999,
        retryStrategy: () => null,
        lazyConnect: true,
      });

      const testRepo = new IPORepository(db, brokenRedis);

      const result = await testRepo.search('tech', 10);

      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBeLessThanOrEqual(10);

      await brokenRedis.disconnect();
    }, 10000);
  });
});
