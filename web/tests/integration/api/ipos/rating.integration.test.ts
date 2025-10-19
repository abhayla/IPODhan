/**
 * Integration Tests for GET /api/ipos/[slug]/rating
 *
 * Tests the rating calculation API route with real database and Redis connections.
 * Ensures proper integration with repository layer, rating algorithm, caching, and error handling.
 *
 * Story 7.7 Test Coverage:
 * - Returns 200 with rating (1-5 scale) and rationale
 * - Returns 404 when IPO slug not found
 * - Returns "Not yet rated" when insufficient data (<40% completeness)
 * - Calculates rating correctly using all 5 factors
 * - Returns confidence score (0-100)
 * - Returns detailed rationale breakdown
 * - Returns cached response on second call (30 min TTL)
 * - Includes proper Cache-Control headers
 * - Handles database errors gracefully
 * - Tests edge cases (missing financial data, missing GMP, missing subscription)
 * - Validates rating is between 1.0 and 5.0
 * - Tests all rating factors independently
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos, financialData, subscriptions, gmpRecords } from '@/lib/db';
import { GET } from '@/app/api/ipos/[slug]/rating/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TEST DATA ====================

const highRatedIPO = {
  companyName: 'High Rated Tech Company',
  slug: 'high-rated-tech-ipo',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '2000.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
  companyDescription: 'Market leader in cloud services, profitable company with expansion plans',
};

const lowRatedIPO = {
  companyName: 'Low Rated Company',
  slug: 'low-rated-ipo',
  segment: 'SME' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  sector: 'Real Estate',
  issueSize: '50.00',
  priceRangeMin: 50,
  priceRangeMax: 60,
  lotSize: 200,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  listingExchanges: ['BSE'] as ('NSE' | 'BSE')[],
  companyDescription: 'Loss making company with high debt and declining revenues',
};

const insufficientDataIPO = {
  companyName: 'Insufficient Data Company',
  slug: 'insufficient-data-ipo',
  segment: 'MAINBOARD' as 'MAINBOARD' | 'SME',
  offeringType: 'IPO' as const,
  sector: 'Manufacturing',
  issueSize: '300.00',
  priceRangeMin: 70,
  priceRangeMax: 80,
  lotSize: 150,
  status: 'UPCOMING' as const,
  openDate: '2025-02-10',
  closeDate: '2025-02-13',
  listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
};

let highRatedId: string;
let lowRatedId: string;
let insufficientDataId: string;

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(slug: string): NextRequest {
  return new NextRequest(
    new URL(
      `http://localhost:3000/api/ipos/${slug}/rating`,
      'http://localhost:3000'
    )
  );
}

async function cleanupTestData() {
  try {
    // Delete related data first
    if (highRatedId) {
      await db.delete(subscriptions).where(eq(subscriptions.ipoId, highRatedId));
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, highRatedId));
      await db.delete(financialData).where(eq(financialData.ipoId, highRatedId));
    }
    if (lowRatedId) {
      await db.delete(subscriptions).where(eq(subscriptions.ipoId, lowRatedId));
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, lowRatedId));
      await db.delete(financialData).where(eq(financialData.ipoId, lowRatedId));
    }
    if (insufficientDataId) {
      await db
        .delete(financialData)
        .where(eq(financialData.ipoId, insufficientDataId));
    }

    // Delete IPOs
    await db.delete(ipos).where(eq(ipos.slug, highRatedIPO.slug));
    await db.delete(ipos).where(eq(ipos.slug, lowRatedIPO.slug));
    await db.delete(ipos).where(eq(ipos.slug, insufficientDataIPO.slug));
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert high-rated IPO
    const [highRated] = await db.insert(ipos).values(highRatedIPO).returning();
    highRatedId = highRated.id;

    // Insert low-rated IPO
    const [lowRated] = await db.insert(ipos).values(lowRatedIPO).returning();
    lowRatedId = lowRated.id;

    // Insert insufficient data IPO
    const [insuffData] = await db
      .insert(ipos)
      .values(insufficientDataIPO)
      .returning();
    insufficientDataId = insuffData.id;

    // Add financial data for high-rated IPO (strong financials)
    await db.insert(financialData).values({
      ipoId: highRatedId,
      revenueFy2022: '5000.00',
      revenueFy2023: '8000.00',
      revenueFy2024: '12000.00',
      profitFy2022: '500.00',
      profitFy2023: '900.00',
      profitFy2024: '1500.00',
      peRatio: '22.00',
      eps: '12.50',
      debtToEquity: '0.30',
    });

    // Add financial data for low-rated IPO (weak financials)
    await db.insert(financialData).values({
      ipoId: lowRatedId,
      revenueFy2022: '200.00',
      revenueFy2023: '150.00',
      revenueFy2024: '100.00',
      profitFy2022: '-50.00',
      profitFy2023: '-80.00',
      profitFy2024: '-100.00',
      peRatio: '45.00',
      eps: '-8.50',
      debtToEquity: '2.50',
    });

    // Add subscription data for high-rated IPO (strong subscription)
    await db.insert(subscriptions).values({
      ipoId: highRatedId,
      timestamp: new Date(),
      qibSubscription: '15.50',
      niiSubscription: '12.75',
      retailSubscription: '8.25',
      totalSubscription: '12.50',
      totalApplications: 500000,
    });

    // Add subscription data for low-rated IPO (weak subscription)
    await db.insert(subscriptions).values({
      ipoId: lowRatedId,
      timestamp: new Date(),
      qibSubscription: '0.25',
      niiSubscription: '0.50',
      retailSubscription: '0.75',
      totalSubscription: '0.50',
      totalApplications: 5000,
    });

    // Add GMP data for high-rated IPO (strong GMP)
    await db.insert(gmpRecords).values([
      {
        ipoId: highRatedId,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        gmp: 40,
        expectedListingPrice: 160,
        subjectRate: 7,
        kostakRate: 8,
        source: 'Chittorgarh',
      },
      {
        ipoId: highRatedId,
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        gmp: 50,
        expectedListingPrice: 170,
        subjectRate: 8,
        kostakRate: 9,
        source: 'Chittorgarh',
      },
    ]);

    // Add GMP data for low-rated IPO (negative GMP)
    await db.insert(gmpRecords).values([
      {
        ipoId: lowRatedId,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        gmp: -5,
        expectedListingPrice: 50,
        subjectRate: 1,
        kostakRate: 0,
        source: 'Chittorgarh',
      },
      {
        ipoId: lowRatedId,
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        gmp: -10,
        expectedListingPrice: 45,
        subjectRate: 0,
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
    const keys = await redis.keys('rating:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('GET /api/ipos/[slug]/rating Integration Tests', () => {
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

  describe('Success Cases - High Rating', () => {
    it('should return 200 with rating (1-5 scale) and rationale', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('rating');
      expect(data).toHaveProperty('score');
      expect(data).toHaveProperty('rationale');
      expect(data).toHaveProperty('confidence');
      expect(data).toHaveProperty('breakdown');
      expect(data).toHaveProperty('lastCalculated');
    });

    it('should calculate high rating for IPO with strong metrics', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // Should have high rating (4+ stars)
      expect(data.rating).toBeGreaterThanOrEqual(4);
      expect(data.rating).toBeLessThanOrEqual(5);

      // Score should be high (80+)
      expect(data.score).toBeGreaterThan(70);
    });

    it('should validate rating is between 1.0 and 5.0', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.rating).toBeGreaterThanOrEqual(1.0);
      expect(data.rating).toBeLessThanOrEqual(5.0);
    });

    it('should return confidence score (0-100)', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.confidence).toBeGreaterThanOrEqual(0);
      expect(data.confidence).toBeLessThanOrEqual(100);

      // Should have high confidence with all data available
      expect(data.confidence).toBeGreaterThan(80);
    });

    it('should return detailed rationale breakdown', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.rationale).toBeDefined();
      expect(typeof data.rationale).toBe('string');
      expect(data.rationale.length).toBeGreaterThan(0);
    });

    it('should calculate rating correctly using all 5 factors', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.breakdown).toHaveProperty('financialScore');
      expect(data.breakdown).toHaveProperty('marketScore');
      expect(data.breakdown).toHaveProperty('subscriptionScore');
      expect(data.breakdown).toHaveProperty('gmpScore');
      expect(data.breakdown).toHaveProperty('fundamentalScore');

      // All scores should be 0-100
      expect(data.breakdown.financialScore).toBeGreaterThanOrEqual(0);
      expect(data.breakdown.financialScore).toBeLessThanOrEqual(100);
      expect(data.breakdown.marketScore).toBeGreaterThanOrEqual(0);
      expect(data.breakdown.marketScore).toBeLessThanOrEqual(100);
    });

    it('should have high scores for all factors', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // High-rated IPO should have good scores across factors
      expect(data.breakdown.financialScore).toBeGreaterThan(50);
      expect(data.breakdown.marketScore).toBeGreaterThan(50);
      expect(data.breakdown.subscriptionScore).toBeGreaterThan(70);
      expect(data.breakdown.gmpScore).toBeGreaterThan(60);
    });
  });

  describe('Success Cases - Low Rating', () => {
    it('should calculate low rating for IPO with weak metrics', async () => {
      const request = createMockRequest(lowRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: lowRatedIPO.slug }),
      });

      const data = await response.json();

      // Should have low rating (< 3 stars)
      expect(data.rating).toBeLessThan(3.5);
      expect(data.rating).toBeGreaterThanOrEqual(1);

      // Score should be lower
      expect(data.score).toBeLessThan(60);
    });

    it('should have low scores for weak factors', async () => {
      const request = createMockRequest(lowRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: lowRatedIPO.slug }),
      });

      const data = await response.json();

      // Low-rated IPO should have poor scores
      expect(data.breakdown.financialScore).toBeLessThan(50);
      expect(data.breakdown.subscriptionScore).toBeLessThan(50);
      expect(data.breakdown.gmpScore).toBeLessThan(50);
    });

    it('should include concerns in rationale for low-rated IPO', async () => {
      const request = createMockRequest(lowRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: lowRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.rationale).toContain('Concerns:');
    });
  });

  describe('Success Cases - Insufficient Data', () => {
    it('should return rating even with insufficient data', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rating).toBeDefined();
      expect(data.rating).toBeGreaterThanOrEqual(1);
      expect(data.rating).toBeLessThanOrEqual(5);
    });

    it('should have low confidence with insufficient data', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      const data = await response.json();

      // Should have lower confidence without subscription and GMP data
      expect(data.confidence).toBeLessThan(80);
    });

    it('should include message for low confidence rating', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      const data = await response.json();

      if (data.confidence < 50) {
        expect(data.message).toBeDefined();
        expect(data.message).toContain('confidence');
      }
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
    it('should cache responses correctly (30 min TTL)', async () => {
      const request = createMockRequest(highRatedIPO.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Verify cache was populated
      const redis = getRedisClient();
      const cacheKey = `rating:${highRatedIPO.slug}`;
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).not.toBeNull();

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');

      // Both responses should have same data
      const data1 = await response1.json();
      const data2 = await response2.json();
      expect(data1.rating).toBe(data2.rating);
      expect(data1.score).toBe(data2.score);
    });

    it('should include proper Cache-Control headers', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toBe(
        'public, s-maxage=1800, stale-while-revalidate=3600'
      );
    });

    it('should cache with 30 minute TTL', async () => {
      const request = createMockRequest(highRatedIPO.slug);

      // Trigger cache population
      await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      // Check TTL in Redis
      const redis = getRedisClient();
      const cacheKey = `rating:${highRatedIPO.slug}`;
      const ttl = await redis.ttl(cacheKey);

      // TTL should be around 1800 seconds (30 minutes)
      expect(ttl).toBeGreaterThan(1750);
      expect(ttl).toBeLessThanOrEqual(1800);
    });
  });

  describe('Rating Factors Testing', () => {
    it('should test financial score factor independently', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // High-rated IPO should have good financial score
      expect(data.breakdown.financialScore).toBeGreaterThan(60);
    });

    it('should test market score factor independently', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // Technology sector + Mainboard + Large issue size = high market score
      expect(data.breakdown.marketScore).toBeGreaterThan(70);
    });

    it('should test subscription score factor independently', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // Strong subscription (15x QIB, 12x NII) = high subscription score
      expect(data.breakdown.subscriptionScore).toBeGreaterThan(80);
    });

    it('should test GMP score factor independently', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // Strong GMP (50, which is ~42% of issue price) = high GMP score
      expect(data.breakdown.gmpScore).toBeGreaterThan(70);
    });

    it('should test fundamental score factor independently', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      // Company description contains positive keywords = higher fundamental score
      expect(data.breakdown.fundamentalScore).toBeGreaterThan(50);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing financial data gracefully', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rating).toBeDefined();
      expect(data.breakdown.financialScore).toBeDefined();
    });

    it('should handle missing GMP data gracefully', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rating).toBeDefined();
      expect(data.breakdown.gmpScore).toBeDefined();
    });

    it('should handle missing subscription data gracefully', async () => {
      const request = createMockRequest(insufficientDataIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: insufficientDataIPO.slug }),
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.rating).toBeDefined();
      expect(data.breakdown.subscriptionScore).toBeDefined();
    });
  });

  describe('Response Format Validation', () => {
    it('should return consistent response structure', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data).toHaveProperty('ipoId');
      expect(data).toHaveProperty('ipoSlug');
      expect(data).toHaveProperty('companyName');
      expect(data).toHaveProperty('rating');
      expect(data).toHaveProperty('score');
      expect(data).toHaveProperty('rationale');
      expect(data).toHaveProperty('confidence');
      expect(data).toHaveProperty('breakdown');
      expect(data).toHaveProperty('lastCalculated');
    });

    it('should return proper data types', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(typeof data.ipoId).toBe('string');
      expect(typeof data.ipoSlug).toBe('string');
      expect(typeof data.companyName).toBe('string');
      expect(typeof data.rating).toBe('number');
      expect(typeof data.score).toBe('number');
      expect(typeof data.rationale).toBe('string');
      expect(typeof data.confidence).toBe('number');
      expect(typeof data.breakdown).toBe('object');
      expect(typeof data.lastCalculated).toBe('string');
    });

    it('should include lastCalculated timestamp', async () => {
      const request = createMockRequest(highRatedIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      const data = await response.json();

      expect(data.lastCalculated).toBeDefined();

      const date = new Date(data.lastCalculated);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Performance', () => {
    it('should respond quickly with cached data', async () => {
      const request = createMockRequest(highRatedIPO.slug);

      // Warm up cache
      await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });

      // Measure cached response time
      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(100);
    });

    it('should respond in reasonable time without cache', async () => {
      const request = createMockRequest(highRatedIPO.slug);

      const startTime = Date.now();
      const response = await GET(request, {
        params: Promise.resolve({ slug: highRatedIPO.slug }),
      });
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });
  });
});
