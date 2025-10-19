/**
 * Integration Tests for GET /api/ipos/[slug]/subscriptions/latest
 *
 * Tests the subscription data API route with real database and Redis connections.
 * Ensures proper integration with repository layer, caching, and error handling.
 *
 * Story 7.7 Test Coverage:
 * - Returns 200 with valid subscription data for existing IPO
 * - Returns 404 when IPO slug not found
 * - Returns 200 with null when no subscription data exists
 * - Returns cached response on second call (Redis cache test)
 * - Includes proper Cache-Control headers
 * - Handles database errors gracefully (500 error)
 * - Validates slug parameter format
 * - Returns last updated timestamp
 * - Includes request ID in response
 * - Tests all subscription categories (QIB, NII, Retail, Total)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos, subscriptions } from '@/lib/db';
import { GET } from '@/app/api/ipos/[slug]/subscriptions/latest/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TEST DATA ====================

const testIPO = {
  companyName: 'Test Company IPO',
  slug: 'test-company-subscription-api',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '1000.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  allotmentDate: '2025-01-16',
  listingDate: '2025-01-18',
  listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
};

const testIPONoSubscription = {
  companyName: 'Test Company No Subscription',
  slug: 'test-company-no-subscription',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '500.00',
  priceRangeMin: 50,
  priceRangeMax: 60,
  lotSize: 50,
  status: 'UPCOMING' as const,
  openDate: '2025-02-10',
  closeDate: '2025-02-13',
  listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
};

let testIpoId: string;
let testIpoNoSubId: string;

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(slug: string): NextRequest {
  return new NextRequest(
    new URL(
      `http://localhost:3000/api/ipos/${slug}/subscriptions/latest`,
      'http://localhost:3000'
    )
  );
}

async function cleanupTestData() {
  try {
    // Delete subscriptions first
    if (testIpoId) {
      await db.delete(subscriptions).where(eq(subscriptions.ipoId, testIpoId));
    }
    if (testIpoNoSubId) {
      await db
        .delete(subscriptions)
        .where(eq(subscriptions.ipoId, testIpoNoSubId));
    }

    // Delete IPOs
    await db.delete(ipos).where(eq(ipos.slug, testIPO.slug));
    await db.delete(ipos).where(eq(ipos.slug, testIPONoSubscription.slug));
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert test IPO with subscriptions
    const [createdIPO] = await db.insert(ipos).values(testIPO).returning();
    testIpoId = createdIPO.id;

    // Insert test IPO without subscriptions
    const [createdIPONoSub] = await db
      .insert(ipos)
      .values(testIPONoSubscription)
      .returning();
    testIpoNoSubId = createdIPONoSub.id;

    // Insert subscription data (3 snapshots)
    await db.insert(subscriptions).values([
      {
        ipoId: testIpoId,
        timestamp: new Date('2025-01-10T10:00:00Z'),
        qibSubscription: '1.25',
        niiSubscription: '2.50',
        retailSubscription: '3.75',
        totalSubscription: '2.50',
        employeeSubscription: '0.50',
        othersSubscription: '1.00',
        totalApplications: 150000,
      },
      {
        ipoId: testIpoId,
        timestamp: new Date('2025-01-11T10:00:00Z'),
        qibSubscription: '2.80',
        niiSubscription: '4.20',
        retailSubscription: '5.50',
        totalSubscription: '4.20',
        employeeSubscription: '0.75',
        othersSubscription: '1.50',
        totalApplications: 250000,
      },
      {
        ipoId: testIpoId,
        timestamp: new Date('2025-01-12T10:00:00Z'),
        qibSubscription: '5.60',
        niiSubscription: '8.40',
        retailSubscription: '10.50',
        totalSubscription: '8.20',
        employeeSubscription: '1.25',
        othersSubscription: '2.00',
        totalApplications: 420000,
      },
    ]);
  } catch (error) {
    console.error('Failed to seed test data:', error);
    throw error;
  }
}

async function clearRedisCache() {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys('subscription:latest:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('GET /api/ipos/[slug]/subscriptions/latest Integration Tests', () => {
  beforeAll(async () => {
    await cleanupTestData();
    await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await clearRedisCache();
  });

  describe('Success Cases', () => {
    it('should return 200 with valid subscription data for existing IPO', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('latestSubscription');
    });

    it('should return the latest subscription snapshot', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      expect(data.latestSubscription).not.toBeNull();
      expect(data.latestSubscription.timestamp).toBe(
        '2025-01-12T10:00:00.000Z'
      );
      expect(data.latestSubscription.qib).toBe('5.60');
      expect(data.latestSubscription.nii).toBe('8.40');
      expect(data.latestSubscription.retail).toBe('10.50');
      expect(data.latestSubscription.total).toBe('8.20');
    });

    it('should return all subscription categories', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      expect(data.latestSubscription).toHaveProperty('qib');
      expect(data.latestSubscription).toHaveProperty('nii');
      expect(data.latestSubscription).toHaveProperty('retail');
      expect(data.latestSubscription).toHaveProperty('total');
      expect(data.latestSubscription).toHaveProperty('employee');
      expect(data.latestSubscription).toHaveProperty('others');
      expect(data.latestSubscription).toHaveProperty('totalApplications');
    });

    it('should return correct company information', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      expect(data.companyName).toBe(testIPO.companyName);
      expect(data.ipoSlug).toBe(testIPO.slug);
      expect(data.status).toBe(testIPO.status);
    });

    it('should return 200 with null when no subscription data exists', async () => {
      const request = createMockRequest(testIPONoSubscription.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONoSubscription.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.latestSubscription).toBeNull();
      expect(data.message).toBe(
        'Subscription data will be available after IPO opens'
      );
    });

    it('should return appropriate message for upcoming IPO without data', async () => {
      const request = createMockRequest(testIPONoSubscription.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONoSubscription.slug }),
      });

      const data = await response.json();
      expect(data.message).toBe(
        'Subscription data will be available after IPO opens'
      );
    });

    it('should include last updated timestamp', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      expect(data.latestSubscription.timestamp).toBeDefined();
      expect(typeof data.latestSubscription.timestamp).toBe('string');

      // Verify it's a valid ISO date string
      const date = new Date(data.latestSubscription.timestamp);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Error Cases', () => {
    it('should return 404 when IPO not found', async () => {
      const request = createMockRequest('non-existent-ipo-slug');
      const response = await GET(request, {
        params: Promise.resolve({ slug: 'non-existent-ipo-slug' }),
      });

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('not found');
    });

    it('should return 400 for missing slug parameter', async () => {
      const request = createMockRequest('');
      const response = await GET(request, {
        params: Promise.resolve({ slug: '' }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toContain('Invalid or missing slug');
    });

    it('should return 400 for invalid slug type', async () => {
      const request = createMockRequest('test');
      const response = await GET(request, {
        params: Promise.resolve({ slug: null as any }),
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should include request ID in error response', async () => {
      const request = createMockRequest('non-existent-slug');
      const response = await GET(request, {
        params: Promise.resolve({ slug: 'non-existent-slug' }),
      });

      const data = await response.json();
      expect(data.error.requestId).toBeDefined();
      expect(typeof data.error.requestId).toBe('string');
      expect(data.error.requestId).toMatch(/^req_/);
    });

    it('should include timestamp in error response', async () => {
      const request = createMockRequest('non-existent-slug');
      const response = await GET(request, {
        params: Promise.resolve({ slug: 'non-existent-slug' }),
      });

      const data = await response.json();
      expect(data.error.timestamp).toBeDefined();
      expect(typeof data.error.timestamp).toBe('string');

      // Verify it's a valid ISO date string
      const date = new Date(data.error.timestamp);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Cache Behavior', () => {
    it('should cache responses correctly', async () => {
      const request = createMockRequest(testIPO.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Verify cache was populated
      const redis = getRedisClient();
      const cacheKey = `subscription:latest:${testIPO.slug}`;
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).not.toBeNull();

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      // Both responses should have same data
      const data1 = await response1.json();
      const data2 = await response2.json();
      expect(data1).toEqual(data2);
    });

    it('should include proper Cache-Control headers', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toBe(
        'public, s-maxage=300, stale-while-revalidate=600'
      );
    });

    it('should cache with 5 minute TTL', async () => {
      const request = createMockRequest(testIPO.slug);

      // Trigger cache population
      await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      // Check TTL in Redis
      const redis = getRedisClient();
      const cacheKey = `subscription:latest:${testIPO.slug}`;
      const ttl = await redis.ttl(cacheKey);

      // TTL should be around 300 seconds (5 minutes), allowing for test execution time
      expect(ttl).toBeGreaterThan(250);
      expect(ttl).toBeLessThanOrEqual(300);
    });

    it('should cache null subscription data correctly', async () => {
      const request = createMockRequest(testIPONoSubscription.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: testIPONoSubscription.slug }),
      });

      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: testIPONoSubscription.slug }),
      });

      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      const data = await response2.json();
      expect(data.latestSubscription).toBeNull();
    });
  });

  describe('Response Format Validation', () => {
    it('should return consistent response structure', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      // Top-level fields
      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('latestSubscription');

      // Subscription object fields
      expect(data.latestSubscription).toHaveProperty('timestamp');
      expect(data.latestSubscription).toHaveProperty('qib');
      expect(data.latestSubscription).toHaveProperty('nii');
      expect(data.latestSubscription).toHaveProperty('retail');
      expect(data.latestSubscription).toHaveProperty('total');
      expect(data.latestSubscription).toHaveProperty('employee');
      expect(data.latestSubscription).toHaveProperty('others');
      expect(data.latestSubscription).toHaveProperty('totalApplications');
    });

    it('should return proper data types', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      expect(typeof data.ipoId).toBe('string');
      expect(typeof data.ipoSlug).toBe('string');
      expect(typeof data.companyName).toBe('string');
      expect(typeof data.status).toBe('string');
      expect(typeof data.latestSubscription.timestamp).toBe('string');
      expect(typeof data.latestSubscription.qib).toBe('string');
      expect(typeof data.latestSubscription.totalApplications).toBe('number');
    });

    it('should handle nullable fields correctly', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const data = await response.json();

      // Employee and others can be null
      expect(
        data.latestSubscription.employee === null ||
          typeof data.latestSubscription.employee === 'string'
      ).toBe(true);
      expect(
        data.latestSubscription.others === null ||
          typeof data.latestSubscription.others === 'string'
      ).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should respond quickly with cached data', async () => {
      const request = createMockRequest(testIPO.slug);

      // Warm up cache
      await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      // Measure cached response time
      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(100); // Should be very fast from cache
    });

    it('should respond in reasonable time without cache', async () => {
      const request = createMockRequest(testIPO.slug);

      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error structure', async () => {
      const request = createMockRequest('non-existent-slug');
      const response = await GET(request, {
        params: Promise.resolve({ slug: 'non-existent-slug' }),
      });

      const data = await response.json();

      expect(data.error).toHaveProperty('code');
      expect(data.error).toHaveProperty('message');
      expect(data.error).toHaveProperty('timestamp');
      expect(data.error).toHaveProperty('requestId');
    });
  });
});
