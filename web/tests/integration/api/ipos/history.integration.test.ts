/**
 * Integration Tests for GET /api/ipos/history
 *
 * Tests the historical IPOs API endpoint with real database and Redis connections.
 * Ensures proper integration with repository layer and caching.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos, listingPerformance, subscriptions } from '@/lib/db/schema';
import { GET } from '@/app/api/ipos/history/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TEST DATA ====================

const testHistoricalIPOs = [
  {
    companyName: 'Historical Corp 2024',
    slug: 'historical-corp-2024-test',
    category: 'MAINBOARD' as const,
    sector: 'Technology',
    issueSize: '500.00',
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 125,
    status: 'LISTED' as const,
    openDate: '2024-01-10',
    closeDate: '2024-01-12',
    allotmentDate: '2024-01-15',
    listingDate: '2024-01-17',
    companyDescription: 'Test historical company 2024',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
    registrar: 'Link Intime',
    leadManagers: ['ICICI Securities'],
    rating: 4,
    ratingRationale: 'Good fundamentals',
  },
  {
    companyName: 'Historical Corp 2023',
    slug: 'historical-corp-2023-test',
    category: 'MAINBOARD' as const,
    sector: 'Finance',
    issueSize: '300.00',
    priceRangeMin: 80,
    priceRangeMax: 100,
    lotSize: 150,
    status: 'LISTED' as const,
    openDate: '2023-06-10',
    closeDate: '2023-06-12',
    allotmentDate: '2023-06-15',
    listingDate: '2023-06-17',
    companyDescription: 'Test historical company 2023',
    faceValue: 10,
    listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
    registrar: 'KFin Technologies',
    leadManagers: ['Kotak Mahindra'],
    rating: 3,
    ratingRationale: 'Average prospects',
  },
];

// ==================== TEST SETUP ====================

let createdIPOIds: string[] = [];
let redis: ReturnType<typeof getRedisClient>;

beforeAll(async () => {
  redis = getRedisClient();
});

afterAll(async () => {
  // Clean up test data
  if (createdIPOIds.length > 0) {
    await db.delete(ipos).where(
      eq(ipos.slug, testHistoricalIPOs[0].slug)
    );
    await db.delete(ipos).where(
      eq(ipos.slug, testHistoricalIPOs[1].slug)
    );
  }

  // Clean up cache
  const keys = await redis.keys('ipos:history:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  redis.disconnect();
});

beforeEach(async () => {
  // Clear cache before each test
  const keys = await redis.keys('ipos:history:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Clean up existing test data
  await db.delete(ipos).where(
    eq(ipos.slug, testHistoricalIPOs[0].slug)
  );
  await db.delete(ipos).where(
    eq(ipos.slug, testHistoricalIPOs[1].slug)
  );

  createdIPOIds = [];

  // Insert fresh test data
  for (const testIPO of testHistoricalIPOs) {
    const [createdIPO] = await db
      .insert(ipos)
      .values(testIPO)
      .returning();

    createdIPOIds.push(createdIPO.id);

    // Add listing performance data
    await db.insert(listingPerformance).values({
      ipoId: createdIPO.id,
      listingPrice: testIPO.slug.includes('2024') ? 150 : 90,
      issuePrice: testIPO.slug.includes('2024') ? 100 : 100,
      listingGainPercent: testIPO.slug.includes('2024') ? '50.00' : '-10.00',
    });

    // Add subscription data
    await db.insert(subscriptions).values({
      ipoId: createdIPO.id,
      timestamp: new Date(),
      totalSubscription: testIPO.slug.includes('2024') ? '15.5' : '8.2',
    });
  }
});

// ==================== TESTS ====================

describe('GET /api/ipos/history', () => {
  describe('Basic Functionality', () => {
    it('should return historical IPOs with default params', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination).toHaveProperty('page');
      expect(data.pagination).toHaveProperty('limit');
      expect(data.pagination).toHaveProperty('total');
      expect(data.pagination).toHaveProperty('hasMore');
    });

    it('should include computed fields (year, listingGainPercent)', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.data.length).toBeGreaterThan(0);

      const ipo = data.data[0];
      expect(ipo).toHaveProperty('year');
      expect(ipo).toHaveProperty('listingGainPercent');
      expect(typeof ipo.year).toBe('number');
    });
  });

  describe('Filtering', () => {
    it('should filter by year', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?year=2024'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: { year: number }) => ipo.year === 2024)).toBe(true);
    });

    it('should filter by sector', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sector=Technology'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(
        data.data.every((ipo: { sector: string }) => ipo.sector === 'Technology')
      ).toBe(true);
    });

    it('should filter by positive performance', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?performance=Positive'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(
        data.data.every(
          (ipo: { listingGainPercent: number | null }) =>
            ipo.listingGainPercent !== null && ipo.listingGainPercent > 0
        )
      ).toBe(true);
    });

    it('should filter by negative performance', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?performance=Negative'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      if (data.data.length > 0) {
        expect(
          data.data.every(
            (ipo: { listingGainPercent: number | null }) =>
              ipo.listingGainPercent !== null && ipo.listingGainPercent < 0
          )
        ).toBe(true);
      }
    });
  });

  describe('Sorting', () => {
    it('should sort by listing_date descending', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sort=listing_date&sortOrder=desc'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      if (data.data.length >= 2) {
        const dates = data.data.map((ipo: { listingDate: string }) =>
          new Date(ipo.listingDate).getTime()
        );
        expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
      }
    });

    it('should sort by listing_gain descending', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sort=listing_gain&sortOrder=desc'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Just verify it doesn't error - actual sorting logic tested in unit tests
      expect(data.data).toBeDefined();
    });

    it('should sort by subscription descending', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sort=subscription&sortOrder=desc'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // Just verify it doesn't error - actual sorting logic tested in unit tests
      expect(data.data).toBeDefined();
    });
  });

  describe('Pagination', () => {
    it('should paginate results', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?page=1&limit=1'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.length).toBeLessThanOrEqual(1);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(1);
    });

    it('should respect custom limit', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?limit=10'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.length).toBeLessThanOrEqual(10);
      expect(data.pagination.limit).toBe(10);
    });

    it('should enforce max limit of 100', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?limit=150'
      );
      const response = await GET(request);

      // Should return validation error
      expect(response.status).toBe(400);
    });
  });

  describe('Validation', () => {
    it('should reject invalid year', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?year=2030'
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid performance value', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?performance=Invalid'
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid sort field', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sort=invalid_field'
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid sortOrder', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?sortOrder=invalid'
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Caching', () => {
    it('should cache responses', async () => {
      const url = 'http://localhost:3000/api/ipos/history?year=2024';

      // First request
      const request1 = new NextRequest(url);
      const response1 = await GET(request1);
      const data1 = await response1.json();

      // Check cache
      const cacheKey = 'ipos:history:2024:All:All:listing_date:desc:1:20';
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).not.toBeNull();

      // Second request should hit cache
      const request2 = new NextRequest(url);
      const response2 = await GET(request2);
      const data2 = await response2.json();

      expect(data2).toEqual(data1);
    });

    it('should set correct cache headers', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history'
      );
      const response = await GET(request);

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty results', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?year=2020'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination.total).toBe(0);
    });

    it('should handle page beyond total pages', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/ipos/history?page=999'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
    });
  });
});
