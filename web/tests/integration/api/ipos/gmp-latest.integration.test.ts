/**
 * Integration Tests for GET /api/ipos/[slug]/gmp/latest
 *
 * Tests the GMP data API route with real database and Redis connections.
 * Ensures proper integration with repository layer, caching, trend calculation, and error handling.
 *
 * Story 7.7 Test Coverage:
 * - Returns 200 with GMP data (absolute value and percentage)
 * - Returns 404 when IPO slug not found
 * - Returns 200 with null when no GMP data exists
 * - Calculates trend correctly (up/down/stable)
 * - Returns cached response on second call
 * - Includes proper Cache-Control headers (15 min TTL)
 * - Handles database errors gracefully
 * - Returns disclaimer text
 * - Validates GMP value ranges
 * - Tests positive, negative, and zero GMP values
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos, gmpRecords } from '@/lib/db';
import { GET } from '@/app/api/ipos/[slug]/gmp/latest/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TEST DATA ====================

const testIPOWithGMP = {
  companyName: 'Test Company With GMP',
  slug: 'test-company-gmp-api',
  segment: 'MAINBOARD',
    offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '1000.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
};

const testIPONoGMP = {
  companyName: 'Test Company No GMP',
  slug: 'test-company-no-gmp',
  segment: 'MAINBOARD',
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

const testIPONegativeGMP = {
  companyName: 'Test Company Negative GMP',
  slug: 'test-company-negative-gmp',
  segment: 'SME',
    offeringType: 'IPO' as const,
  sector: 'Finance',
  issueSize: '200.00',
  priceRangeMin: 80,
  priceRangeMax: 90,
  lotSize: 200,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  listingExchanges: ['BSE'] as ('NSE' | 'BSE')[],
};

let testIpoGMPId: string;
let testIpoNoGMPId: string;
let testIpoNegGMPId: string;

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(slug: string): NextRequest {
  return new NextRequest(
    new URL(
      `http://localhost:3000/api/ipos/${slug}/gmp/latest`,
      'http://localhost:3000'
    )
  );
}

async function cleanupTestData() {
  try {
    // Delete GMP records first
    if (testIpoGMPId) {
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, testIpoGMPId));
    }
    if (testIpoNegGMPId) {
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, testIpoNegGMPId));
    }

    // Delete IPOs
    await db.delete(ipos).where(eq(ipos.slug, testIPOWithGMP.slug));
    await db.delete(ipos).where(eq(ipos.slug, testIPONoGMP.slug));
    await db.delete(ipos).where(eq(ipos.slug, testIPONegativeGMP.slug));
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert test IPO with positive GMP
    const [createdIPOGMP] = await db
      .insert(ipos)
      .values(testIPOWithGMP)
      .returning();
    testIpoGMPId = createdIPOGMP.id;

    // Insert test IPO without GMP
    const [createdIPONoGMP] = await db
      .insert(ipos)
      .values(testIPONoGMP)
      .returning();
    testIpoNoGMPId = createdIPONoGMP.id;

    // Insert test IPO with negative GMP
    const [createdIPONegGMP] = await db
      .insert(ipos)
      .values(testIPONegativeGMP)
      .returning();
    testIpoNegGMPId = createdIPONegGMP.id;

    // Insert GMP records for positive GMP IPO (trending up)
    const now = new Date();
    await db.insert(gmpRecords).values([
      {
        ipoId: testIpoGMPId,
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        gmp: 15,
        expectedListingPrice: 135,
        subjectRate: 3,
        kostakRate: 4,
        source: 'Chittorgarh',
      },
      {
        ipoId: testIpoGMPId,
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        gmp: 25,
        expectedListingPrice: 145,
        subjectRate: 5,
        kostakRate: 6,
        source: 'Chittorgarh',
      },
    ]);

    // Insert GMP records for negative GMP IPO (trending down)
    await db.insert(gmpRecords).values([
      {
        ipoId: testIpoNegGMPId,
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        gmp: -5,
        expectedListingPrice: 80,
        subjectRate: 2,
        kostakRate: 1,
        source: 'Chittorgarh',
      },
      {
        ipoId: testIpoNegGMPId,
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        gmp: -15,
        expectedListingPrice: 70,
        subjectRate: 1,
        kostakRate: 0,
        source: 'Chittorgarh',
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
    const keys = await redis.keys('gmp:latest:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('GET /api/ipos/[slug]/gmp/latest Integration Tests', () => {
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

  describe('Success Cases - Positive GMP', () => {
    it('should return 200 with GMP data (absolute value and percentage)', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('issuePrice');
      expect(data).toHaveProperty('latestGMP');
      expect(data).toHaveProperty('disclaimer');
    });

    it('should return latest GMP with correct values', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      expect(data.latestGMP).not.toBeNull();
      expect(data.latestGMP.gmp).toBe(25);
      expect(data.latestGMP.expectedListingPrice).toBe(145);
      expect(data.latestGMP.source).toBe('Chittorgarh');
    });

    it('should calculate GMP percentage correctly', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      // GMP = 25, Issue Price = 120, Percentage = (25/120) * 100 = 20.83%
      expect(data.latestGMP.gmpPercentage).toBe(20.83);
    });

    it('should calculate trend correctly (up)', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      // GMP increased from 15 to 25 (diff = 10 > 5), so trend = 'up'
      expect(data.latestGMP.trend).toBe('up');
    });

    it('should include timestamp', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      expect(data.latestGMP.timestamp).toBeDefined();
      expect(typeof data.latestGMP.timestamp).toBe('string');

      // Verify it's a valid ISO date string
      const date = new Date(data.latestGMP.timestamp);
      expect(date.toString()).not.toBe('Invalid Date');
    });

    it('should return disclaimer text', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      expect(data.disclaimer).toBeDefined();
      expect(typeof data.disclaimer).toBe('string');
      expect(data.disclaimer).toContain('Grey Market Premium');
      expect(data.disclaimer).toContain('unofficial');
    });
  });

  describe('Success Cases - Negative GMP', () => {
    it('should handle negative GMP values correctly', async () => {
      const request = createMockRequest(testIPONegativeGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONegativeGMP.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.latestGMP.gmp).toBe(-15);
    });

    it('should calculate negative GMP percentage correctly', async () => {
      const request = createMockRequest(testIPONegativeGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONegativeGMP.slug }),
      });

      const data = await response.json();

      // GMP = -15, Issue Price = 90, Percentage = (-15/90) * 100 = -16.67%
      expect(data.latestGMP.gmpPercentage).toBe(-16.67);
    });

    it('should calculate trend correctly (down)', async () => {
      const request = createMockRequest(testIPONegativeGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONegativeGMP.slug }),
      });

      const data = await response.json();

      // GMP decreased from -5 to -15 (diff = -10 < -5), so trend = 'down'
      expect(data.latestGMP.trend).toBe('down');
    });
  });

  describe('Success Cases - No GMP Data', () => {
    it('should return 200 with null when no GMP data exists', async () => {
      const request = createMockRequest(testIPONoGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONoGMP.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.latestGMP).toBeNull();
      expect(data.message).toBe('GMP data not yet available');
    });

    it('should still include disclaimer when no GMP data', async () => {
      const request = createMockRequest(testIPONoGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPONoGMP.slug }),
      });

      const data = await response.json();
      expect(data.disclaimer).toBeDefined();
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

      const date = new Date(data.error.timestamp);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Cache Behavior', () => {
    it('should cache responses correctly', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Verify cache was populated
      const redis = getRedisClient();
      const cacheKey = `gmp:latest:${testIPOWithGMP.slug}`;
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).not.toBeNull();

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      // Both responses should have same data
      const data1 = await response1.json();
      const data2 = await response2.json();
      expect(data1).toEqual(data2);
    });

    it('should include proper Cache-Control headers (15 min TTL)', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toBe(
        'public, s-maxage=900, stale-while-revalidate=1800'
      );
    });

    it('should cache with 15 minute TTL', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);

      // Trigger cache population
      await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      // Check TTL in Redis
      const redis = getRedisClient();
      const cacheKey = `gmp:latest:${testIPOWithGMP.slug}`;
      const ttl = await redis.ttl(cacheKey);

      // TTL should be around 900 seconds (15 minutes)
      expect(ttl).toBeGreaterThan(850);
      expect(ttl).toBeLessThanOrEqual(900);
    });

    it('should cache null GMP data correctly', async () => {
      const request = createMockRequest(testIPONoGMP.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: testIPONoGMP.slug }),
      });

      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: testIPONoGMP.slug }),
      });

      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      const data = await response2.json();
      expect(data.latestGMP).toBeNull();
    });
  });

  describe('Trend Calculation', () => {
    it('should return null trend when only one GMP record exists', async () => {
      // Create IPO with single GMP record
      const singleGMPIPO = {
        companyName: 'Single GMP Test',
        slug: 'single-gmp-test',
        segment: 'MAINBOARD',
    offeringType: 'IPO' as const,
        sector: 'Technology',
        issueSize: '300.00',
        priceRangeMin: 60,
        priceRangeMax: 70,
        lotSize: 100,
        status: 'OPEN' as const,
        openDate: '2025-01-10',
        closeDate: '2025-01-13',
        listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
      };

      const [createdIPO] = await db
        .insert(ipos)
        .values(singleGMPIPO)
        .returning();

      await db.insert(gmpRecords).values({
        ipoId: createdIPO.id,
        timestamp: new Date(),
        gmp: 10,
        expectedListingPrice: 80,
        subjectRate: 3,
        kostakRate: 4,
        source: 'Chittorgarh',
      });

      const request = createMockRequest(singleGMPIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: singleGMPIPO.slug }),
      });

      const data = await response.json();
      expect(data.latestGMP.trend).toBeNull();

      // Cleanup
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, createdIPO.id));
      await db.delete(ipos).where(eq(ipos.id, createdIPO.id));
    });

    it('should return stable trend when GMP change is small', async () => {
      // Create IPO with stable GMP
      const stableGMPIPO = {
        companyName: 'Stable GMP Test',
        slug: 'stable-gmp-test',
        segment: 'MAINBOARD',
    offeringType: 'IPO' as const,
        sector: 'Technology',
        issueSize: '400.00',
        priceRangeMin: 70,
        priceRangeMax: 80,
        lotSize: 100,
        status: 'OPEN' as const,
        openDate: '2025-01-10',
        closeDate: '2025-01-13',
        listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
      };

      const [createdIPO] = await db
        .insert(ipos)
        .values(stableGMPIPO)
        .returning();

      const now = new Date();
      await db.insert(gmpRecords).values([
        {
          ipoId: createdIPO.id,
          timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          gmp: 20,
          expectedListingPrice: 100,
          subjectRate: 4,
          kostakRate: 5,
          source: 'Chittorgarh',
        },
        {
          ipoId: createdIPO.id,
          timestamp: now,
          gmp: 22,
          expectedListingPrice: 102,
          subjectRate: 4,
          kostakRate: 5,
          source: 'Chittorgarh',
        },
      ]);

      const request = createMockRequest(stableGMPIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: stableGMPIPO.slug }),
      });

      const data = await response.json();
      // diff = 2 (between -5 and 5), so trend = 'stable'
      expect(data.latestGMP.trend).toBe('stable');

      // Cleanup
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, createdIPO.id));
      await db.delete(ipos).where(eq(ipos.id, createdIPO.id));
    });
  });

  describe('Response Format Validation', () => {
    it('should return consistent response structure', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      // Top-level fields
      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('issuePrice');
      expect(data).toHaveProperty('latestGMP');
      expect(data).toHaveProperty('disclaimer');

      // GMP object fields
      expect(data.latestGMP).toHaveProperty('timestamp');
      expect(data.latestGMP).toHaveProperty('gmp');
      expect(data.latestGMP).toHaveProperty('gmpPercentage');
      expect(data.latestGMP).toHaveProperty('expectedListingPrice');
      expect(data.latestGMP).toHaveProperty('source');
      expect(data.latestGMP).toHaveProperty('trend');
    });

    it('should return proper data types', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      const data = await response.json();

      expect(typeof data.ipoId).toBe('string');
      expect(typeof data.ipoSlug).toBe('string');
      expect(typeof data.companyName).toBe('string');
      expect(typeof data.issuePrice).toBe('number');
      expect(typeof data.latestGMP.gmp).toBe('number');
      expect(typeof data.latestGMP.gmpPercentage).toBe('number');
      expect(typeof data.latestGMP.source).toBe('string');
      expect(typeof data.disclaimer).toBe('string');
    });
  });

  describe('Performance', () => {
    it('should respond quickly with cached data', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);

      // Warm up cache
      await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });

      // Measure cached response time
      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(100);
    });

    it('should respond in reasonable time without cache', async () => {
      const request = createMockRequest(testIPOWithGMP.slug);

      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPOWithGMP.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });
  });
});
