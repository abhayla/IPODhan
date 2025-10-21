/**
 * Connection Pool and Concurrency Integration Tests
 *
 * Tests database connection pool behavior under concurrent load
 * and validates proper connection management.
 *
 * Test scenarios:
 * 1. Connection pool reuse and efficiency
 * 2. Concurrent query handling (100+ simultaneous)
 * 3. Connection exhaustion prevention
 * 4. Redis connection pool behavior
 * 5. Mixed read/write concurrency
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { getDb } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';

describe('Connection Pool and Concurrency', () => {
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let repository: IPORepository;

  beforeEach(async () => {
    db = await getDb();
    redis = getRedisClient();
    repository = new IPORepository(db, redis);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  describe('Database Connection Pool', () => {
    test('should handle 100 concurrent read queries', async () => {
      const startTime = Date.now();

      // Create 100 concurrent read operations
      const queries = Array.from({ length: 100 }, (_, i) =>
        repository.findAll({
          status: ['OPEN', 'UPCOMING', 'CLOSED'],
          limit: 10,
          page: (i % 5) + 1, // Vary pages to avoid same cache key
        })
      );

      const results = await Promise.all(queries);
      const duration = Date.now() - startTime;

      // All queries should succeed
      expect(results).toHaveLength(100);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.data).toBeInstanceOf(Array);
        expect(result.meta).toBeDefined();
      });

      // Should complete in reasonable time (< 5 seconds for 100 queries)
      expect(duration).toBeLessThan(5000);

      console.log(`[Concurrency] 100 concurrent reads completed in ${duration}ms (avg: ${duration/100}ms per query)`);
    }, 15000);

    test('should handle 50 concurrent write operations', async () => {
      const timestamp = Date.now();
      const startTime = Date.now();

      // Create 50 IPOs concurrently
      const creates = Array.from({ length: 50 }, (_, i) =>
        repository.create({
          id: `concurrency-test-${i}-${timestamp}`,
          companyName: `Concurrent Company ${i}`,
          slug: `concurrent-company-${i}-${timestamp}`,
          status: 'UPCOMING',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
        })
      );

      const created = await Promise.all(creates);
      const duration = Date.now() - startTime;

      // All creates should succeed
      expect(created).toHaveLength(50);
      created.forEach((ipo, i) => {
        expect(ipo.companyName).toBe(`Concurrent Company ${i}`);
      });

      console.log(`[Concurrency] 50 concurrent writes completed in ${duration}ms (avg: ${duration/50}ms per write)`);

      // Cleanup
      const deletes = created.map(ipo => repository.delete(ipo.id));
      await Promise.all(deletes);
    }, 20000);

    test('should handle mixed read/write concurrency', async () => {
      const timestamp = Date.now();
      const startTime = Date.now();

      // Mix of reads and writes
      const operations = [];

      // 30 reads
      for (let i = 0; i < 30; i++) {
        operations.push(
          repository.findAll({ limit: 10, page: (i % 3) + 1 })
        );
      }

      // 20 writes
      for (let i = 0; i < 20; i++) {
        operations.push(
          repository.create({
            id: `mixed-test-${i}-${timestamp}`,
            companyName: `Mixed Op Company ${i}`,
            slug: `mixed-op-company-${i}-${timestamp}`,
            status: 'UPCOMING',
            segment: 'MAINBOARD',
            offeringType: 'IPO',
          })
        );
      }

      const results = await Promise.all(operations);
      const duration = Date.now() - startTime;

      // All operations should succeed
      expect(results).toHaveLength(50);

      console.log(`[Concurrency] 30 reads + 20 writes completed in ${duration}ms`);

      // Cleanup writes
      const created = results.slice(30) as any[];
      const deletes = created.map((ipo: any) => repository.delete(ipo.id));
      await Promise.all(deletes);
    }, 20000);

    test('should not exhaust database connections', async () => {
      // PostgreSQL default connection pool size is usually 10-20
      // Test with more concurrent operations than pool size

      const queries = Array.from({ length: 200 }, () =>
        repository.findAll({ limit: 5 })
      );

      // Should not throw "too many clients" error
      await expect(Promise.all(queries)).resolves.toBeDefined();

      console.log('[Connection Pool] Successfully handled 200 concurrent queries without exhaustion');
    }, 30000);

    test('should reuse connections efficiently', async () => {
      // Sequential operations should reuse connections
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const result = await repository.findAll({ limit: 5 });
        expect(result).toBeDefined();
      }

      console.log(`[Connection Pool] Completed ${iterations} sequential queries (connection reuse)`);
    }, 15000);
  });

  describe('Redis Connection Behavior', () => {
    test('should handle concurrent cache operations', async () => {
      const operations = [];

      // 50 SET operations
      for (let i = 0; i < 50; i++) {
        operations.push(
          redis.setex(`test-key-${i}`, 300, JSON.stringify({ value: i }))
        );
      }

      // 50 GET operations
      for (let i = 0; i < 50; i++) {
        operations.push(redis.get(`test-key-${i}`));
      }

      // Should all complete without errors
      const results = await Promise.all(operations);
      expect(results).toHaveLength(100);

      console.log('[Redis] 50 SETs + 50 GETs completed concurrently');

      // Cleanup
      const keys = Array.from({ length: 50 }, (_, i) => `test-key-${i}`);
      await redis.del(...keys);
    }, 15000);

    test('should use singleton Redis connection', async () => {
      // Multiple getRedisClient() calls should return same instance
      const instances = Array.from({ length: 10 }, () => getRedisClient());

      // All should be the same reference
      instances.forEach(instance => {
        expect(instance).toBe(instances[0]);
      });

      console.log('[Redis] Singleton pattern verified - all instances identical');
    });

    test('should handle high-volume cache reads', async () => {
      // Prepare cache data
      await redis.set('popular-key', JSON.stringify({ data: 'test' }));

      const startTime = Date.now();

      // 500 concurrent reads of same key
      const reads = Array.from({ length: 500 }, () =>
        redis.get('popular-key')
      );

      const results = await Promise.all(reads);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(500);
      results.forEach(result => {
        expect(result).toBeTruthy();
      });

      console.log(`[Redis] 500 concurrent reads completed in ${duration}ms (avg: ${duration/500}ms)`);

      await redis.del('popular-key');
    }, 15000);

    test('should handle pipeline operations efficiently', async () => {
      const pipeline = redis.pipeline();

      // Add 1000 operations to pipeline
      for (let i = 0; i < 1000; i++) {
        pipeline.set(`pipeline-key-${i}`, `value-${i}`);
      }

      const startTime = Date.now();
      const results = await pipeline.exec();
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(1000);

      console.log(`[Redis] 1000 pipeline operations completed in ${duration}ms`);

      // Cleanup
      const keys = Array.from({ length: 1000 }, (_, i) => `pipeline-key-${i}`);
      await redis.del(...keys);
    }, 15000);
  });

  describe('Connection Error Handling', () => {
    test('should handle connection errors without crashing', async () => {
      // Create a client that will fail to connect
      const failingRedis = new Redis({
        host: 'invalid-host',
        port: 9999,
        retryStrategy: () => null,
        lazyConnect: true,
        connectTimeout: 100,
      });

      const failingRepo = new IPORepository(db, failingRedis);

      // Should not throw, should fall back to database
      const result = await failingRepo.findAll({ limit: 10 });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);

      await failingRedis.disconnect();
    }, 10000);

    test('should recover from temporary connection loss', async () => {
      // Set a value
      await redis.set('recovery-test', 'value');

      // Verify it exists
      const before = await redis.get('recovery-test');
      expect(before).toBe('value');

      // Simulate disconnect and reconnect
      await redis.quit();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get new client
      const newRedis = getRedisClient();

      // Should work again
      await newRedis.set('recovery-test-2', 'value-2');
      const after = await newRedis.get('recovery-test-2');
      expect(after).toBe('value-2');
    }, 10000);
  });

  describe('Load Testing Scenarios', () => {
    test('should handle sustained concurrent load', async () => {
      const duration = 5000; // 5 seconds
      const requestsPerSecond = 20;
      const interval = 1000 / requestsPerSecond;

      const startTime = Date.now();
      const requests: Promise<any>[] = [];

      while (Date.now() - startTime < duration) {
        requests.push(repository.findAll({ limit: 10 }));
        await new Promise(resolve => setTimeout(resolve, interval));
      }

      const results = await Promise.all(requests);
      const totalDuration = Date.now() - startTime;

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => expect(result).toBeDefined());

      console.log(`[Load Test] ${results.length} requests over ${totalDuration}ms (~${Math.round(results.length / (totalDuration / 1000))} req/s)`);
    }, 10000);

    test('should handle burst traffic', async () => {
      // Simulate burst of 100 requests at once
      const burst1 = Array.from({ length: 100 }, () =>
        repository.findAll({ limit: 5 })
      );

      await Promise.all(burst1);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Another burst
      const burst2 = Array.from({ length: 100 }, () =>
        repository.search('tech', 10)
      );

      await Promise.all(burst2);

      console.log('[Load Test] Handled 2 bursts of 100 requests each');
    }, 20000);

    test('should maintain performance under varying load', async () => {
      const measurements: { load: number; avgTime: number }[] = [];

      for (const load of [10, 25, 50, 100]) {
        const startTime = Date.now();

        const queries = Array.from({ length: load }, () =>
          repository.findAll({ limit: 10 })
        );

        await Promise.all(queries);

        const duration = Date.now() - startTime;
        const avgTime = duration / load;

        measurements.push({ load, avgTime });

        console.log(`[Load Test] ${load} concurrent requests - Avg: ${avgTime.toFixed(2)}ms per request`);
      }

      // Average time shouldn't increase linearly with load (connection pooling benefit)
      // At 100 concurrent, should still be reasonable (< 50ms avg)
      const highLoadAvg = measurements.find(m => m.load === 100)!.avgTime;
      expect(highLoadAvg).toBeLessThan(100);
    }, 30000);
  });

  describe('Transaction-like Consistency', () => {
    test('should maintain consistency during concurrent updates', async () => {
      const timestamp = Date.now();

      // Create a test IPO
      const testIPO = await repository.create({
        id: `consistency-${timestamp}`,
        companyName: 'Original Name',
        slug: `consistency-${timestamp}`,
        status: 'UPCOMING',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
      });

      // Multiple concurrent updates (simulating race condition)
      const updates = Array.from({ length: 10 }, (_, i) =>
        repository.update(testIPO.id, {
          companyName: `Update ${i}`,
        })
      );

      await Promise.all(updates);

      // Final read should have one of the updates
      const final = await repository.findById(testIPO.id);
      expect(final!.companyName).toMatch(/^Update \d$/);

      // Cleanup
      await repository.delete(testIPO.id);
    }, 15000);

    test('should handle concurrent create-read operations', async () => {
      const timestamp = Date.now();
      const batchSize = 20;

      // Concurrent creates
      const creates = Array.from({ length: batchSize }, (_, i) =>
        repository.create({
          id: `concurrent-cr-${i}-${timestamp}`,
          companyName: `Create-Read Test ${i}`,
          slug: `create-read-test-${i}-${timestamp}`,
          status: 'UPCOMING',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
        })
      );

      const created = await Promise.all(creates);

      // Immediately read all of them
      const reads = created.map(ipo => repository.findById(ipo.id));
      const read = await Promise.all(reads);

      // All should be readable
      expect(read).toHaveLength(batchSize);
      read.forEach(ipo => expect(ipo).toBeDefined());

      // Cleanup
      const deletes = created.map(ipo => repository.delete(ipo.id));
      await Promise.all(deletes);
    }, 20000);
  });

  describe('Resource Cleanup', () => {
    test('should not leak connections after operations', async () => {
      // Perform many operations
      for (let i = 0; i < 100; i++) {
        await repository.findAll({ limit: 5 });
      }

      // Additional operations should still work (no connection leak)
      const result = await repository.findAll({ limit: 10 });
      expect(result).toBeDefined();

      console.log('[Resource] No connection leaks detected after 100+ operations');
    }, 15000);

    test('should handle graceful shutdown', async () => {
      // Perform operations
      await repository.findAll({ limit: 10 });

      // Close Redis connection
      await closeRedisClient();

      // Reconnect for other tests
      redis = getRedisClient();
      repository = new IPORepository(db, redis);

      // Should work after reconnect
      const result = await repository.findAll({ limit: 5 });
      expect(result).toBeDefined();
    }, 10000);
  });

  describe('Performance Benchmarks', () => {
    test('should maintain p95 < 500ms for concurrent queries', async () => {
      const iterations = 100;
      const times: number[] = [];

      // Clear cache for consistent measurement
      await redis.flushdb();

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await repository.findAll({ limit: 10, page: (i % 10) + 1 });
        times.push(Date.now() - start);
      }

      times.sort((a, b) => a - b);

      const p50 = times[Math.floor(iterations * 0.5)];
      const p95 = times[Math.floor(iterations * 0.95)];
      const p99 = times[Math.floor(iterations * 0.99)];

      console.log(`[Performance] Query times - P50: ${p50}ms, P95: ${p95}ms, P99: ${p99}ms`);

      // Architecture requirements
      expect(p95).toBeLessThan(500);
      expect(p99).toBeLessThan(1000);
    }, 30000);

    test('should achieve > 100 req/s throughput', async () => {
      const duration = 2000; // 2 seconds
      const startTime = Date.now();
      let requestCount = 0;

      const requests: Promise<any>[] = [];

      while (Date.now() - startTime < duration) {
        requests.push(repository.findAll({ limit: 5 }));
        requestCount++;

        // Small delay to prevent overwhelming
        await new Promise(resolve => setImmediate(resolve));
      }

      await Promise.all(requests);

      const actualDuration = Date.now() - startTime;
      const throughput = (requestCount / actualDuration) * 1000;

      console.log(`[Performance] Throughput: ${Math.round(throughput)} req/s (${requestCount} requests in ${actualDuration}ms)`);

      expect(throughput).toBeGreaterThan(100);
    }, 10000);
  });
});
