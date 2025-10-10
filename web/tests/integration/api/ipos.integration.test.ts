/**
 * Integration Tests for GET /api/ipos
 *
 * Tests the full API route with real database and Redis connections.
 * Ensures proper integration with repository layer and caching.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos } from '@/lib/db/schema';
import { GET } from '@/app/api/ipos/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

// ==================== TYPE DEFINITIONS ====================

interface IPOData {
  id: string;
  companyName: string;
  slug: string;
  category: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD';
  sector: string | null;
  issueSize: string | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  companyDescription: string | null;
  faceValue: number | null;
  listingExchanges: ('NSE' | 'BSE')[] | null;
  registrar: string | null;
  leadManagers: string[] | null;
  rating: number | null;
  ratingRationale: string | null;
  createdAt: string;
  updatedAt: string;
}

// ==================== TEST DATA ====================

const testIPOs = [
  {
    companyName: 'Test Corp Alpha',
    slug: 'test-corp-alpha-integration',
    category: 'MAINBOARD' as const,
    sector: 'Technology',
    issueSize: '500.00',
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 125,
    status: 'OPEN' as const,
    openDate: '2025-01-10',
    closeDate: '2025-01-12',
    allotmentDate: '2025-01-15',
    listingDate: '2025-01-17',
    companyDescription: 'Test company Alpha',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
    registrar: 'Link Intime',
    leadManagers: ['ICICI Securities'],
    rating: 4,
    ratingRationale: 'Good fundamentals',
  },
  {
    companyName: 'Test Corp Beta',
    slug: 'test-corp-beta-integration',
    category: 'SME' as const,
    sector: 'Finance',
    issueSize: '200.00',
    priceRangeMin: 50,
    priceRangeMax: 60,
    lotSize: 200,
    status: 'UPCOMING' as const,
    openDate: '2025-02-10',
    closeDate: '2025-02-12',
    allotmentDate: '2025-02-15',
    listingDate: '2025-02-17',
    companyDescription: 'Test company Beta',
    faceValue: 10,
    listingExchanges: ['NSE'] as ('NSE' | 'BSE')[],
    registrar: 'KFin Technologies',
    leadManagers: ['Kotak Mahindra'],
    rating: 3,
    ratingRationale: 'Average prospects',
  },
  {
    companyName: 'Test Corp Gamma',
    slug: 'test-corp-gamma-integration',
    category: 'MAINBOARD' as const,
    sector: 'Technology',
    issueSize: '750.00',
    priceRangeMin: 150,
    priceRangeMax: 180,
    lotSize: 100,
    status: 'CLOSED' as const,
    openDate: '2024-12-10',
    closeDate: '2024-12-12',
    allotmentDate: '2024-12-15',
    listingDate: '2024-12-17',
    companyDescription: 'Test company Gamma',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
    registrar: 'Link Intime',
    leadManagers: ['HDFC Securities'],
    rating: 5,
    ratingRationale: 'Excellent fundamentals',
  },
];

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

async function cleanupTestData() {
  try {
    // Delete test IPOs
    for (const testIPO of testIPOs) {
      await db.delete(ipos).where(eq(ipos.slug, testIPO.slug));
    }
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert test IPOs
    await db.insert(ipos).values(testIPOs);
  } catch (error) {
    console.error('Failed to seed test data:', error);
    throw error;
  }
}

async function clearRedisCache() {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys('ipo:list:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('GET /api/ipos Integration Tests', () => {
  beforeAll(async () => {
    // Clean up any existing test data
    await cleanupTestData();
    // Seed test data
    await seedTestData();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Clear Redis cache before each test
    await clearRedisCache();
  });

  describe('Data Fetching', () => {
    it('should fetch IPOs from database', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.pagination).toBeDefined();
      expect(data.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('should return IPOs with correct structure', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      const firstIPO = data.data[0];
      expect(firstIPO).toHaveProperty('id');
      expect(firstIPO).toHaveProperty('companyName');
      expect(firstIPO).toHaveProperty('slug');
      expect(firstIPO).toHaveProperty('category');
      expect(firstIPO).toHaveProperty('status');
      expect(firstIPO).toHaveProperty('createdAt');
      expect(firstIPO).toHaveProperty('updatedAt');
    });
  });

  describe('Filtering', () => {
    it('should filter by status=OPEN', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: IPOData) => ipo.status === 'OPEN')).toBe(true);
      expect(
        data.data.some((ipo: IPOData) => ipo.slug === 'test-corp-alpha-integration')
      ).toBe(true);
    });

    it('should filter by status=UPCOMING', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=UPCOMING'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: IPOData) => ipo.status === 'UPCOMING')).toBe(
        true
      );
      expect(
        data.data.some((ipo: IPOData) => ipo.slug === 'test-corp-beta-integration')
      ).toBe(true);
    });

    it('should filter by multiple statuses', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN&status=CLOSED'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(
        data.data.every(
          (ipo: IPOData) => ipo.status === 'OPEN' || ipo.status === 'CLOSED'
        )
      ).toBe(true);
      expect(data.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by category=MAINBOARD', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?category=MAINBOARD'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: IPOData) => ipo.category === 'MAINBOARD')).toBe(
        true
      );
      expect(data.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by category=SME', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?category=SME'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: IPOData) => ipo.category === 'SME')).toBe(true);
      expect(
        data.data.some((ipo: IPOData) => ipo.slug === 'test-corp-beta-integration')
      ).toBe(true);
    });

    it('should filter by sector', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sector=Technology'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.every((ipo: IPOData) => ipo.sector === 'Technology')).toBe(
        true
      );
      expect(data.data.length).toBeGreaterThanOrEqual(2);
    });

    it('should combine multiple filters', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN&category=MAINBOARD&sector=Technology'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(
        data.data.every(
          (ipo: IPOData) =>
            ipo.status === 'OPEN' &&
            ipo.category === 'MAINBOARD' &&
            ipo.sector === 'Technology'
        )
      ).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sector=NonExistentSector'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination.total).toBe(0);
    });
  });

  describe('Pagination', () => {
    it('should paginate with default limit (20)', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.limit).toBe(20);
      expect(data.pagination.page).toBe(1);
      expect(data.data.length).toBeLessThanOrEqual(20);
    });

    it('should respect custom limit', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?limit=2'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.limit).toBe(2);
      expect(data.data.length).toBeLessThanOrEqual(2);
    });

    it('should handle pagination correctly', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?page=1&limit=2'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      if (data.pagination.total > 2) {
        expect(data.pagination.hasMore).toBe(true);
      }
    });

    it('should calculate hasMore correctly', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?limit=100'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      if (data.pagination.total <= 100) {
        expect(data.pagination.hasMore).toBe(false);
      }
    });
  });

  describe('Sorting', () => {
    it('should sort by createdAt descending (default)', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);

      // Verify descending order
      for (let i = 0; i < data.data.length - 1; i++) {
        const current = new Date(data.data[i].createdAt).getTime();
        const next = new Date(data.data[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it('should sort by issueSize ascending', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?sortBy=issueSize&sortOrder=asc'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Filter to only test IPOs that have issueSize
      const iposWithIssueSize = data.data.filter((ipo: IPOData) => ipo.issueSize);

      // Verify ascending order
      for (let i = 0; i < iposWithIssueSize.length - 1; i++) {
        const current = parseFloat(iposWithIssueSize[i].issueSize);
        const next = parseFloat(iposWithIssueSize[i + 1].issueSize);
        expect(current).toBeLessThanOrEqual(next);
      }
    });
  });

  describe('Caching', () => {
    it('should cache results in Redis', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=OPEN'
      );

      // First request (cache miss)
      const response1 = await GET(request);
      expect(response1.status).toBe(200);

      // Check if cache was populated
      const redis = getRedisClient();
      const keys = await redis.keys('ipo:list:*');
      expect(keys.length).toBeGreaterThan(0);

      // Second request (should hit cache)
      const response2 = await GET(request);
      const data2 = await response2.json();
      expect(response2.status).toBe(200);
      expect(data2.data).toBeDefined();
    });

    it('should include Cache-Control header', async () => {
      const request = createMockRequest('http://localhost:3000/api/ipos');
      const response = await GET(request);

      expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    });
  });

  describe('Error Handling', () => {
    it('should return proper error format for validation errors', async () => {
      const request = createMockRequest(
        'http://localhost:3000/api/ipos?status=INVALID'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('VALIDATION_ERROR');
      expect(data.error.message).toBeDefined();
      expect(data.error.timestamp).toBeDefined();
      expect(data.error.requestId).toBeDefined();
    });
  });
});
