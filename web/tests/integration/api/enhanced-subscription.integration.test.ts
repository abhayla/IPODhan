/**
 * Integration Tests: Enhanced Subscription API
 *
 * Tests for subscription API with all 7 granular fields.
 * Story 5.6: Enhanced Subscription Breakdown
 *
 * @requires PostgreSQL running on localhost:5432
 * @requires Redis running on localhost:6379
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import type { IPOInsert, SubscriptionInsert } from '@/lib/repositories/types';

describe('Enhanced Subscription Integration Tests', () => {
  let ipoRepository: IPORepository;
  let subscriptionRepository: SubscriptionRepository;
  let testIpoId: string;
  let redis: ReturnType<typeof getRedisClient>;

  beforeAll(async () => {
    redis = getRedisClient();
    ipoRepository = new IPORepository(db, redis);
    subscriptionRepository = new SubscriptionRepository(db, redis);

    // Create test IPO
    const testIPO: IPOInsert = {
      companyName: 'Test Enhanced Subscription Co',
      slug: 'test-enhanced-sub-ipo',
      segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
    offeringType: 'IPO',
      status: 'OPEN',
      issueSize: '1000',
      priceRangeMin: 100,
      priceRangeMax: 120,
      lotSize: 125,
      openDate: '2024-01-15',
      closeDate: '2024-01-17',
    };

    const createdIPO = await ipoRepository.create(testIPO);
    testIpoId = createdIPO.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testIpoId) {
      await ipoRepository.delete(testIpoId);
    }
    // Clear Redis cache
    await redis.flushdb();
  });

  describe('Subscription with All 7 Granular Fields', () => {
    it('should create subscription snapshot with all fields', async () => {
      const subscriptionData: SubscriptionInsert = {
        ipoId: testIpoId,
        timestamp: new Date('2024-01-15T10:00:00Z'),
        // High-level categories
        qibSubscription: '5.20',
        niiSubscription: '6.60',
        retailSubscription: '3.20',
        totalSubscription: '4.50',
        employeeSubscription: '0.80',
        othersSubscription: '0.00',
        // Granular breakdown
        anchorInvestorSubscription: '100.00',
        retailHNISubscription: '2.00',
        retailOthersSubscription: '1.20',
        bNIISubscription: '4.50',
        sNIISubscription: '2.10',
        // Additional metrics
        totalApplications: 50000,
        totalSharesBid: 150000000,
        sharesOffered: 50000000,
      };

      const created = await subscriptionRepository.createSnapshot(subscriptionData);

      expect(created).toBeDefined();
      expect(created.id).toBeDefined();
      expect(created.ipoId).toBe(testIpoId);

      // Verify all granular fields are saved
      expect(created.anchorInvestorSubscription).toBe('100.00');
      expect(created.retailHNISubscription).toBe('2.00');
      expect(created.retailOthersSubscription).toBe('1.20');
      expect(created.bNIISubscription).toBe('4.50');
      expect(created.sNIISubscription).toBe('2.10');
    });

    it('should retrieve subscription with all 7 fields', async () => {
      const latest = await subscriptionRepository.findLatest(testIpoId);

      expect(latest).toBeDefined();
      expect(latest?.ipoId).toBe(testIpoId);

      // Verify all granular fields are retrieved
      expect(latest?.qibSubscription).toBeDefined();
      expect(latest?.niiSubscription).toBeDefined();
      expect(latest?.retailSubscription).toBeDefined();
      expect(latest?.bNIISubscription).toBeDefined();
      expect(latest?.sNIISubscription).toBeDefined();
      expect(latest?.retailHNISubscription).toBeDefined();
      expect(latest?.retailOthersSubscription).toBeDefined();
      expect(latest?.anchorInvestorSubscription).toBeDefined();
    });

    it('should cache subscription data with all fields', async () => {
      // First call - should populate cache
      const first = await subscriptionRepository.findLatest(testIpoId);

      // Verify cached
      const cacheKey = `subscription:latest:${testIpoId}`;
      const cached = await redis.get(cacheKey);
      expect(cached).toBeDefined();

      const cachedData = JSON.parse(cached as string);
      expect(cachedData.anchorInvestorSubscription).toBeDefined();
      expect(cachedData.bNIISubscription).toBeDefined();
      expect(cachedData.sNIISubscription).toBeDefined();
    });
  });

  describe('Data Validation', () => {
    it('should accept valid NII breakdown', async () => {
      const validData: SubscriptionInsert = {
        ipoId: testIpoId,
        timestamp: new Date('2024-01-15T11:00:00Z'),
        qibSubscription: '5.00',
        niiSubscription: '6.60',
        retailSubscription: '2.00',
        totalSubscription: '4.00',
        bNIISubscription: '4.50',
        sNIISubscription: '2.10',
        retailHNISubscription: '1.00',
        retailOthersSubscription: '1.00',
        anchorInvestorSubscription: '50.00',
        employeeSubscription: '0.50',
        othersSubscription: '0.00',
        totalApplications: 60000,
        totalSharesBid: 180000000,
        sharesOffered: 50000000,
      };

      const created = await subscriptionRepository.createSnapshot(validData);
      expect(created).toBeDefined();

      // Verify breakdown matches total
      const bNII = parseFloat(created.bNIISubscription || '0');
      const sNII = parseFloat(created.sNIISubscription || '0');
      const nii = parseFloat(created.niiSubscription || '0');
      expect(Math.abs(bNII + sNII - nii)).toBeLessThan(0.02);
    });

    it('should handle null granular fields gracefully', async () => {
      const partialData: SubscriptionInsert = {
        ipoId: testIpoId,
        timestamp: new Date('2024-01-15T12:00:00Z'),
        qibSubscription: '5.00',
        niiSubscription: '3.00',
        retailSubscription: '2.00',
        totalSubscription: '3.50',
        // Granular fields null
        bNIISubscription: null,
        sNIISubscription: null,
        retailHNISubscription: null,
        retailOthersSubscription: null,
        anchorInvestorSubscription: null,
        employeeSubscription: null,
        othersSubscription: null,
        totalApplications: 40000,
        totalSharesBid: 120000000,
        sharesOffered: 50000000,
      };

      const created = await subscriptionRepository.createSnapshot(partialData);
      expect(created).toBeDefined();
      expect(created.bNIISubscription).toBeNull();
      expect(created.anchorInvestorSubscription).toBeNull();
    });
  });

  describe('Repository Caching', () => {
    it('should invalidate cache on new snapshot', async () => {
      const cacheKey = `subscription:latest:${testIpoId}`;

      // Populate cache
      await subscriptionRepository.findLatest(testIpoId);
      const beforeCache = await redis.get(cacheKey);
      expect(beforeCache).toBeDefined();

      // Create new snapshot
      const newData: SubscriptionInsert = {
        ipoId: testIpoId,
        timestamp: new Date('2024-01-15T13:00:00Z'),
        qibSubscription: '6.00',
        niiSubscription: '4.00',
        retailSubscription: '2.50',
        totalSubscription: '4.20',
        bNIISubscription: '3.00',
        sNIISubscription: '1.00',
        retailHNISubscription: '1.50',
        retailOthersSubscription: '1.00',
        anchorInvestorSubscription: '80.00',
        employeeSubscription: '0.60',
        othersSubscription: '0.00',
        totalApplications: 70000,
        totalSharesBid: 200000000,
        sharesOffered: 50000000,
      };

      await subscriptionRepository.createSnapshot(newData);

      // Cache should be invalidated
      const afterCache = await redis.get(cacheKey);
      expect(afterCache).toBeNull();
    });
  });

  describe('Query Performance', () => {
    it('should retrieve latest subscription efficiently', async () => {
      const startTime = Date.now();
      const result = await subscriptionRepository.findLatest(testIpoId);
      const duration = Date.now() - startTime;

      expect(result).toBeDefined();
      // Should complete within 100ms (p95 target from CLAUDE.md)
      expect(duration).toBeLessThan(100);
    });

    it('should benefit from caching on repeated queries', async () => {
      // Clear cache first
      await redis.del(`subscription:latest:${testIpoId}`);

      // First query (cache miss)
      const start1 = Date.now();
      await subscriptionRepository.findLatest(testIpoId);
      const duration1 = Date.now() - start1;

      // Second query (cache hit)
      const start2 = Date.now();
      await subscriptionRepository.findLatest(testIpoId);
      const duration2 = Date.now() - start2;

      // Cache hit should be faster
      expect(duration2).toBeLessThan(duration1);
    });
  });
});
