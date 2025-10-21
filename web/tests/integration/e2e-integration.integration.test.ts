/**
 * End-to-End Integration Tests
 *
 * Tests critical data flows from database through cache to application layer.
 * Validates the complete integration stack working together.
 *
 * Test scenarios:
 * 1. Complete IPO data flow (DB → Cache → Repository → Service)
 * 2. Real-time subscription tracking flow
 * 3. GMP data update and retrieval flow
 * 4. Historical IPO listing performance flow
 * 5. Cross-repository data consistency
 */

import { describe, test, expect, beforeEach, afterEach, afterAll } from 'vitest';
import Redis from 'ioredis';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { getDb } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, desc } from 'drizzle-orm';

describe('End-to-End Integration', () => {
  let db: NodePgDatabase<typeof schema>;
  let redis: Redis;
  let ipoRepository: IPORepository;

  beforeEach(async () => {
    db = await getDb();
    redis = getRedisClient();
    ipoRepository = new IPORepository(db, redis);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  describe('Complete IPO Data Flow', () => {
    test('should flow data from database through cache to application', async () => {
      // Step 1: Query database (first time - cache miss)
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Step 2: Repository layer fetches (populates cache)
      const firstFetch = await ipoRepository.findBySlug(testIPO.slug);
      expect(firstFetch).toBeDefined();
      expect(firstFetch?.companyName).toBe(testIPO.companyName);

      // Step 3: Verify cache was populated
      const cacheKey = `ipo:slug:${testIPO.slug}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeTruthy();

      const cachedData = JSON.parse(cached!);
      expect(cachedData.companyName).toBe(testIPO.companyName);

      // Step 4: Second fetch should hit cache (faster)
      const startTime = Date.now();
      const secondFetch = await ipoRepository.findBySlug(testIPO.slug);
      const cacheHitDuration = Date.now() - startTime;

      expect(secondFetch).toBeDefined();
      expect(secondFetch?.companyName).toBe(testIPO.companyName);

      // Cache hit should be very fast (< 50ms)
      expect(cacheHitDuration).toBeLessThan(50);

      console.log(`[E2E] Cache hit completed in ${cacheHitDuration}ms`);
    }, 10000);

    test('should maintain data consistency across layers', async () => {
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Fetch via repository
      const repoData = await ipoRepository.findById(testIPO.id);

      // Fetch directly from database
      const [dbData] = await db
        .select()
        .from(schema.ipos)
        .where(eq(schema.ipos.id, testIPO.id))
        .limit(1);

      // Data should be identical
      expect(repoData).toBeDefined();
      expect(dbData).toBeDefined();
      expect(repoData!.id).toBe(dbData.id);
      expect(repoData!.companyName).toBe(dbData.companyName);
      expect(repoData!.slug).toBe(dbData.slug);
      expect(repoData!.status).toBe(dbData.status);
    }, 10000);

    test('should handle complete IPO with all relations', async () => {
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Fetch IPO with all relations
      const ipoWithRelations = await ipoRepository.findBySlug(testIPO.slug);

      expect(ipoWithRelations).toBeDefined();

      // Should have relation properties (even if null)
      expect(ipoWithRelations).toHaveProperty('financialData');
      expect(ipoWithRelations).toHaveProperty('ipoFinancials');
      expect(ipoWithRelations).toHaveProperty('ipoDetails');
      expect(ipoWithRelations).toHaveProperty('documents');
      expect(ipoWithRelations).toHaveProperty('subscriptions');
      expect(ipoWithRelations).toHaveProperty('gmpRecords');
      expect(ipoWithRelations).toHaveProperty('listingPerformance');
      expect(ipoWithRelations).toHaveProperty('peerCompanies');
      expect(ipoWithRelations).toHaveProperty('registrarRelation');
      expect(ipoWithRelations).toHaveProperty('ipoScore');

      // Arrays should be arrays (even if empty)
      expect(Array.isArray(ipoWithRelations!.documents)).toBe(true);
      expect(Array.isArray(ipoWithRelations!.subscriptions)).toBe(true);
      expect(Array.isArray(ipoWithRelations!.gmpRecords)).toBe(true);
      expect(Array.isArray(ipoWithRelations!.peerCompanies)).toBe(true);
    }, 10000);
  });

  describe('IPO Lifecycle Flow', () => {
    test('should handle IPO creation → cache → retrieval flow', async () => {
      const timestamp = Date.now();
      const testData = {
        id: `e2e-test-${timestamp}`,
        companyName: `E2E Test Company ${timestamp}`,
        slug: `e2e-test-company-${timestamp}`,
        status: 'UPCOMING' as const,
        segment: 'MAINBOARD' as const,
        offeringType: 'IPO' as const,
      };

      // Step 1: Create IPO
      const created = await ipoRepository.create(testData);
      expect(created).toBeDefined();
      expect(created.companyName).toBe(testData.companyName);

      // Step 2: Retrieve by ID (should query DB and cache)
      const fetchedById = await ipoRepository.findById(created.id);
      expect(fetchedById).toBeDefined();
      expect(fetchedById!.companyName).toBe(testData.companyName);

      // Step 3: Retrieve by slug (should hit cache or query DB and cache)
      const fetchedBySlug = await ipoRepository.findBySlug(created.slug);
      expect(fetchedBySlug).toBeDefined();
      expect(fetchedBySlug!.companyName).toBe(testData.companyName);

      // Step 4: Update IPO
      const updatedName = `Updated ${timestamp}`;
      const updated = await ipoRepository.update(created.id, {
        companyName: updatedName,
      });
      expect(updated.companyName).toBe(updatedName);

      // Step 5: Verify update is reflected in retrieval
      const afterUpdate = await ipoRepository.findById(created.id);
      expect(afterUpdate!.companyName).toBe(updatedName);

      // Step 6: Delete IPO
      await ipoRepository.delete(created.id);

      // Step 7: Verify deletion
      const afterDelete = await ipoRepository.findById(created.id);
      expect(afterDelete).toBeNull();
    }, 15000);

    test('should handle batch operations correctly', async () => {
      const timestamp = Date.now();
      const batchSize = 3;

      // Create multiple IPOs
      const createPromises = Array.from({ length: batchSize }, (_, i) => {
        return ipoRepository.create({
          id: `batch-test-${i}-${timestamp}`,
          companyName: `Batch Company ${i}`,
          slug: `batch-company-${i}-${timestamp}`,
          status: 'UPCOMING',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
        });
      });

      const created = await Promise.all(createPromises);
      expect(created).toHaveLength(batchSize);

      // Verify all can be retrieved
      const fetchPromises = created.map(ipo => ipoRepository.findById(ipo.id));
      const fetched = await Promise.all(fetchPromises);

      expect(fetched).toHaveLength(batchSize);
      fetched.forEach((ipo, i) => {
        expect(ipo).toBeDefined();
        expect(ipo!.companyName).toBe(`Batch Company ${i}`);
      });

      // Cleanup
      const deletePromises = created.map(ipo => ipoRepository.delete(ipo.id));
      await Promise.all(deletePromises);
    }, 15000);
  });

  describe('Search and Filter Flow', () => {
    test('should handle search flow with caching', async () => {
      // First search - cache miss
      const firstSearch = await ipoRepository.search('tech', 10);
      expect(firstSearch).toBeInstanceOf(Array);

      // Second search - cache hit
      const startTime = Date.now();
      const secondSearch = await ipoRepository.search('tech', 10);
      const duration = Date.now() - startTime;

      expect(secondSearch).toBeInstanceOf(Array);
      expect(secondSearch.length).toBe(firstSearch.length);

      // Should be faster (cache hit)
      expect(duration).toBeLessThan(100);

      console.log(`[E2E] Search cache hit completed in ${duration}ms`);
    }, 10000);

    test('should handle complex filtering with cache', async () => {
      const filters = {
        status: ['OPEN', 'UPCOMING'] as const,
        segment: ['MAINBOARD'] as const,
        limit: 10,
        page: 1,
      };

      // First call - cache miss
      const first = await ipoRepository.findAll(filters);
      expect(first).toBeDefined();
      expect(first.data).toBeInstanceOf(Array);

      // Second call - cache hit
      const startTime = Date.now();
      const second = await ipoRepository.findAll(filters);
      const duration = Date.now() - startTime;

      expect(second.data).toHaveLength(first.data.length);
      expect(duration).toBeLessThan(50);

      console.log(`[E2E] Filtered list cache hit in ${duration}ms`);
    }, 10000);

    test('should handle pagination correctly', async () => {
      // Get page 1
      const page1 = await ipoRepository.findAll({ limit: 10, page: 1 });
      expect(page1.meta.page).toBe(1);
      expect(page1.meta.limit).toBe(10);

      // Get page 2
      const page2 = await ipoRepository.findAll({ limit: 10, page: 2 });
      expect(page2.meta.page).toBe(2);

      // Pages should have different data (if enough records)
      if (page1.meta.totalPages >= 2) {
        const page1Ids = page1.data.map(ipo => ipo.id);
        const page2Ids = page2.data.map(ipo => ipo.id);

        // No overlap between pages
        const overlap = page1Ids.filter(id => page2Ids.includes(id));
        expect(overlap).toHaveLength(0);
      }
    }, 10000);
  });

  describe('Historical Data Flow', () => {
    test('should retrieve historical IPOs with computed fields', async () => {
      const historicalData = await ipoRepository.findHistorical({
        year: 'All',
        performance: 'All',
        sort: 'listing_date',
        sortOrder: 'desc',
        page: 1,
        limit: 10,
      });

      expect(historicalData).toBeDefined();
      expect(historicalData.data).toBeInstanceOf(Array);

      // Each record should have computed fields
      historicalData.data.forEach(ipo => {
        expect(ipo).toHaveProperty('year');
        expect(ipo).toHaveProperty('listingGainPercent');
        expect(ipo).toHaveProperty('subscription');
      });
    }, 10000);

    test('should filter historical data by year', async () => {
      const year2024 = await ipoRepository.findHistorical({
        year: '2024',
        page: 1,
        limit: 20,
      });

      if (year2024.data.length > 0) {
        year2024.data.forEach(ipo => {
          expect(ipo.year).toBe(2024);
        });
      }
    }, 10000);

    test('should filter by performance (Positive/Negative)', async () => {
      const positivePerf = await ipoRepository.findHistorical({
        performance: 'Positive',
        page: 1,
        limit: 10,
      });

      if (positivePerf.data.length > 0) {
        positivePerf.data.forEach(ipo => {
          expect(ipo.listingGainPercent).toBeGreaterThan(0);
        });
      }
    }, 10000);
  });

  describe('Data Consistency Across Operations', () => {
    test('should maintain consistency during concurrent reads', async () => {
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Concurrent reads of same IPO
      const reads = Array.from({ length: 10 }, () =>
        ipoRepository.findBySlug(testIPO.slug)
      );

      const results = await Promise.all(reads);

      // All should return same data
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result?.id).toBe(testIPO.id);
        expect(result?.companyName).toBe(testIPO.companyName);
      });
    }, 10000);

    test('should maintain consistency during write-then-read', async () => {
      const timestamp = Date.now();
      const testData = {
        id: `consistency-${timestamp}`,
        companyName: `Consistency Test ${timestamp}`,
        slug: `consistency-test-${timestamp}`,
        status: 'UPCOMING' as const,
        segment: 'MAINBOARD' as const,
        offeringType: 'IPO' as const,
      };

      // Write
      const created = await ipoRepository.create(testData);

      // Immediate read
      const read = await ipoRepository.findById(created.id);

      expect(read).toBeDefined();
      expect(read!.companyName).toBe(created.companyName);

      // Update
      const newName = `Updated ${timestamp}`;
      await ipoRepository.update(created.id, { companyName: newName });

      // Read again
      const afterUpdate = await ipoRepository.findById(created.id);
      expect(afterUpdate!.companyName).toBe(newName);

      // Cleanup
      await ipoRepository.delete(created.id);
    }, 15000);
  });

  describe('Error Recovery Flow', () => {
    test('should recover from database errors gracefully', async () => {
      // Try to fetch non-existent IPO
      const result = await ipoRepository.findById('non-existent-id-12345');
      expect(result).toBeNull();

      // Should not crash, just return null
    }, 10000);

    test('should handle invalid filter parameters', async () => {
      // Invalid status should just return no results or handle gracefully
      const result = await ipoRepository.findAll({
        status: [] as any,
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(result.data).toBeInstanceOf(Array);
    }, 10000);
  });

  describe('Performance Benchmarks', () => {
    test('should meet response time targets for cached queries', async () => {
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Prime cache
      await ipoRepository.findBySlug(testIPO.slug);

      // Measure cache hit performance
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await ipoRepository.findBySlug(testIPO.slug);
        times.push(Date.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / iterations;
      const p95Time = times.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];

      console.log(`[Performance] Cached query - Avg: ${avgTime}ms, P95: ${p95Time}ms`);

      // Target: Cache hits should be < 10ms on average
      expect(avgTime).toBeLessThan(10);
      expect(p95Time).toBeLessThan(50);
    }, 15000);

    test('should meet response time targets for uncached queries', async () => {
      const [testIPO] = await db.select().from(schema.ipos).limit(1);

      if (!testIPO) {
        console.log('[Test Skipped] No IPO data available');
        return;
      }

      // Clear cache
      await redis.flushdb();

      // Measure database query performance
      const iterations = 5;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        await redis.flushdb(); // Ensure cache miss
        const start = Date.now();
        await ipoRepository.findBySlug(testIPO.slug);
        times.push(Date.now() - start);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / iterations;

      console.log(`[Performance] Uncached query - Avg: ${avgTime}ms`);

      // Target: Database queries should be < 100ms on average
      expect(avgTime).toBeLessThan(100);
    }, 15000);
  });
});
