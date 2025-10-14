/**
 * Integration Tests for GET /api/ipos/[slug]
 *
 * Tests the IPO detail API route with real database and Redis connections.
 * Ensures proper integration with repository layer, caching, and peer comparison.
 *
 * Story 4.1 Test Coverage:
 * - AC1: GET /api/ipos/[slug] endpoint implemented
 * - AC2: Returns full IPO object with relations
 * - AC3: Includes latest subscription data
 * - AC4: Includes 7-day GMP history
 * - AC5: Includes financial data (3-year trends)
 * - AC6: Includes peer comparison data
 * - AC7: Includes documents (DRHP, RHP, Prospectus)
 * - AC8: Includes registrar information
 * - AC9: Proper error handling (404 for invalid slug)
 * - AC10: Response time <500ms with caching
 * - AC11: API documented with TypeScript types
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  ipos,
  subscriptions,
  gmpRecords,
  financialData,
  documents,
  listingPerformance,
  peerCompanies,
} from '@/lib/db';
import { GET } from '@/app/api/ipos/[slug]/route';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import type { IPODetailResponse } from '@/lib/db/types';

// ==================== TEST DATA ====================

const testIPO = {
  companyName: 'Swiggy Test IPO',
  slug: 'swiggy-test-ipo-integration',
  category: 'MAINBOARD' as const,
  sector: 'Food Delivery',
  issueSize: '11000.00',
  priceRangeMin: 371,
  priceRangeMax: 390,
  lotSize: 38,
  status: 'OPEN' as const,
  openDate: '2025-01-10',
  closeDate: '2025-01-13',
  allotmentDate: '2025-01-16',
  listingDate: '2025-01-18',
  companyDescription: 'Leading food delivery platform',
  faceValue: 1,
  listingExchanges: ['NSE', 'BSE'] as ('NSE' | 'BSE')[],
  registrar: 'Link Intime India Private Ltd',
  leadManagers: ['Kotak Mahindra Capital', 'Citigroup Global'],
  rating: 4,
  ratingRationale: 'Strong market position, growing demand',
};

const peerIPO1 = {
  companyName: 'Zomato Test',
  slug: 'zomato-test-integration',
  category: 'MAINBOARD' as const,
  sector: 'Food Delivery',
  issueSize: '9375.00',
  priceRangeMin: 72,
  priceRangeMax: 76,
  lotSize: 195,
  status: 'LISTED' as const,
  openDate: '2021-07-14',
  closeDate: '2021-07-16',
  listingDate: '2021-07-23',
};

const peerIPO2 = {
  companyName: 'Delivery Hero Test',
  slug: 'delivery-hero-test-integration',
  category: 'MAINBOARD' as const,
  sector: 'Food Delivery',
  issueSize: '5000.00',
  priceRangeMin: 100,
  priceRangeMax: 110,
  lotSize: 100,
  status: 'OPEN' as const,
  openDate: '2025-01-15',
  closeDate: '2025-01-17',
};

let testIpoId: string;
let peerIpoId1: string;
let peerIpoId2: string;

// ==================== HELPER FUNCTIONS ====================

function createMockRequest(slug: string): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/ipos/${slug}`, 'http://localhost:3000')
  );
}

async function cleanupTestData() {
  try {
    // Delete related data first (foreign key constraints)
    if (testIpoId) {
      await db.delete(subscriptions).where(eq(subscriptions.ipoId, testIpoId));
      await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, testIpoId));
      await db.delete(financialData).where(eq(financialData.ipoId, testIpoId));
      await db.delete(documents).where(eq(documents.ipoId, testIpoId));
      await db
        .delete(listingPerformance)
        .where(eq(listingPerformance.ipoId, testIpoId));
      await db.delete(peerCompanies).where(eq(peerCompanies.ipoId, testIpoId));
    }

    // Delete peer IPO related data
    if (peerIpoId1) {
      await db.delete(financialData).where(eq(financialData.ipoId, peerIpoId1));
    }
    if (peerIpoId2) {
      await db.delete(financialData).where(eq(financialData.ipoId, peerIpoId2));
    }

    // Delete IPOs
    await db.delete(ipos).where(eq(ipos.slug, testIPO.slug));
    await db.delete(ipos).where(eq(ipos.slug, peerIPO1.slug));
    await db.delete(ipos).where(eq(ipos.slug, peerIPO2.slug));
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert test IPO
    const [createdIPO] = await db.insert(ipos).values(testIPO).returning();
    testIpoId = createdIPO.id;

    // Insert peer IPOs
    const [createdPeer1] = await db.insert(ipos).values(peerIPO1).returning();
    peerIpoId1 = createdPeer1.id;

    const [createdPeer2] = await db.insert(ipos).values(peerIPO2).returning();
    peerIpoId2 = createdPeer2.id;

    // Insert financial data for test IPO
    await db.insert(financialData).values({
      ipoId: testIpoId,
      revenueFy2022: '3200.00',
      revenueFy2023: '8000.00',
      revenueFy2024: '11250.00',
      profitFy2022: '-800.00',
      profitFy2023: '-1600.00',
      profitFy2024: '-2000.00',
      peRatio: '65.00',
      eps: '-5.50',
      roe: '-12.00',
      debtToEquity: '0.45',
    });

    // Insert financial data for peer IPO 1
    await db.insert(financialData).values({
      ipoId: peerIpoId1,
      revenueFy2022: '4192.00',
      revenueFy2023: '7079.00',
      revenueFy2024: '9918.00',
      profitFy2022: '-1222.00',
      profitFy2023: '-971.00',
      profitFy2024: '-347.00',
      peRatio: '75.00',
      eps: '-2.30',
    });

    // Insert financial data for peer IPO 2
    await db.insert(financialData).values({
      ipoId: peerIpoId2,
      peRatio: '55.00',
      eps: '8.20',
    });

    // Insert subscription data
    await db.insert(subscriptions).values([
      {
        ipoId: testIpoId,
        timestamp: new Date('2025-01-10T10:00:00Z'),
        qibSubscription: '1.25',
        niiSubscription: '2.50',
        retailSubscription: '3.75',
        totalSubscription: '2.50',
      },
      {
        ipoId: testIpoId,
        timestamp: new Date('2025-01-11T10:00:00Z'),
        qibSubscription: '2.80',
        niiSubscription: '4.20',
        retailSubscription: '5.50',
        totalSubscription: '4.20',
      },
    ]);

    // Insert GMP records (last 7 days)
    const today = new Date();
    await db.insert(gmpRecords).values([
      {
        ipoId: testIpoId,
        timestamp: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        gmp: 45,
        expectedListingPrice: 435,
        subjectRate: 5,
        kostakRate: 6,
        source: 'Market Source',
      },
      {
        ipoId: testIpoId,
        timestamp: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        gmp: 42,
        expectedListingPrice: 432,
        subjectRate: 4,
        kostakRate: 5,
        source: 'Market Source',
      },
      {
        ipoId: testIpoId,
        timestamp: new Date(today.getTime() - 8 * 24 * 60 * 60 * 1000), // 8 days ago (should be filtered)
        gmp: 30,
        expectedListingPrice: 420,
        subjectRate: 3,
        kostakRate: 4,
        source: 'Market Source',
      },
    ]);

    // Insert documents
    await db.insert(documents).values([
      {
        ipoId: testIpoId,
        type: 'DRHP',
        title: 'Draft Red Herring Prospectus',
        url: '/documents/swiggy-drhp.pdf',
        fileSize: 5242880,
      },
      {
        ipoId: testIpoId,
        type: 'RHP',
        title: 'Red Herring Prospectus',
        url: '/documents/swiggy-rhp.pdf',
        fileSize: 5500000,
      },
    ]);

    // Insert peer companies data (from peerCompanies table)
    await db.insert(peerCompanies).values([
      {
        ipoId: testIpoId,
        companyName: 'Dominos India',
        sector: 'Food Delivery',
        isListed: true,
        peRatio: '85.00',
        eps: '12.50',
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
    const keys = await redis.keys('ipo:detail:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('GET /api/ipos/[slug] Integration Tests', () => {
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

  describe('AC1: Endpoint Implementation', () => {
    it('should return 200 for valid slug', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      expect(response.status).toBe(200);
    });

    it('should return 404 for invalid slug', async () => {
      const request = createMockRequest('non-existent-slug');
      const response = await GET(request, {
        params: Promise.resolve({ slug: 'non-existent-slug' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('IPO_NOT_FOUND');
      expect(data.error.message).toBe('IPO not found');
      expect(data.error.slug).toBe('non-existent-slug');
    });

    it('should return 400 for missing slug parameter', async () => {
      const request = createMockRequest('');
      const response = await GET(request, {
        params: Promise.resolve({ slug: '' }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
      expect(data.error.code).toBe('INVALID_SLUG');
    });
  });

  describe('AC2: Returns Full IPO Object with Relations', () => {
    it('should return complete IPO detail response structure', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data).toHaveProperty('ipo');
      expect(data).toHaveProperty('financialData');
      expect(data).toHaveProperty('documents');
      expect(data).toHaveProperty('subscriptions');
      expect(data).toHaveProperty('gmpRecords');
      expect(data).toHaveProperty('listingPerformance');
      expect(data).toHaveProperty('peerCompanies');
      expect(data).toHaveProperty('peers');
      expect(data).toHaveProperty('metadata');
    });

    it('should return IPO with correct basic information', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.ipo.companyName).toBe(testIPO.companyName);
      expect(data.ipo.slug).toBe(testIPO.slug);
      expect(data.ipo.category).toBe(testIPO.category);
      expect(data.ipo.sector).toBe(testIPO.sector);
      expect(data.ipo.status).toBe(testIPO.status);
    });
  });

  describe('AC3: Includes Latest Subscription Data', () => {
    it('should include subscription snapshots', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.subscriptions).toBeInstanceOf(Array);
      expect(data.subscriptions.length).toBeGreaterThan(0);
    });

    it('should include subscription metrics', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      const latestSub = data.subscriptions[0];
      expect(latestSub).toHaveProperty('qibSubscription');
      expect(latestSub).toHaveProperty('niiSubscription');
      expect(latestSub).toHaveProperty('retailSubscription');
      expect(latestSub).toHaveProperty('totalSubscription');
    });
  });

  describe('AC4: Includes 7-day GMP History', () => {
    it('should include GMP records from last 7 days', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.gmpRecords).toBeInstanceOf(Array);
      expect(data.gmpRecords.length).toBeGreaterThan(0);

      // Check that all GMP records are from last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      data.gmpRecords.forEach((record) => {
        const recordDate = new Date(record.timestamp);
        expect(recordDate.getTime()).toBeGreaterThanOrEqual(
          sevenDaysAgo.getTime()
        );
      });
    });

    it('should include GMP details', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      const gmpRecord = data.gmpRecords[0];
      expect(gmpRecord).toHaveProperty('gmp');
      expect(gmpRecord).toHaveProperty('expectedListingPrice');
      expect(gmpRecord).toHaveProperty('subjectRate');
      expect(gmpRecord).toHaveProperty('kostakRate');
    });
  });

  describe('AC5: Includes Financial Data (3-year trends)', () => {
    it('should include financial data', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.financialData).not.toBeNull();
      expect(data.financialData).toHaveProperty('revenueFy2022');
      expect(data.financialData).toHaveProperty('revenueFy2023');
      expect(data.financialData).toHaveProperty('revenueFy2024');
    });

    it('should include profit trends', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.financialData).not.toBeNull();
      expect(data.financialData).toHaveProperty('profitFy2022');
      expect(data.financialData).toHaveProperty('profitFy2023');
      expect(data.financialData).toHaveProperty('profitFy2024');
    });

    it('should include key metrics', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.financialData).not.toBeNull();
      expect(data.financialData).toHaveProperty('peRatio');
      expect(data.financialData).toHaveProperty('eps');
    });
  });

  describe('AC6: Includes Peer Comparison Data', () => {
    it('should include peer IPOs in same sector', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.peers).toBeInstanceOf(Array);
      expect(data.peers.length).toBeGreaterThan(0);

      // All peers should be in same sector
      data.peers.forEach((peer) => {
        expect(peer.sector).toBe(testIPO.sector);
      });
    });

    it('should exclude current IPO from peers', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      // Current IPO should not be in peers list
      const currentIpoInPeers = data.peers.some(
        (peer) => peer.id === data.ipo.id
      );
      expect(currentIpoInPeers).toBe(false);
    });

    it('should include financial data for peers', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      // At least one peer should have financial data
      const peersWithFinancials = data.peers.filter(
        (peer) => peer.financialData !== null
      );
      expect(peersWithFinancials.length).toBeGreaterThan(0);
    });
  });

  describe('AC7: Includes Documents', () => {
    it('should include documents array', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.documents).toBeInstanceOf(Array);
      expect(data.documents.length).toBeGreaterThan(0);
    });

    it('should include document details', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      const doc = data.documents[0];
      expect(doc).toHaveProperty('type');
      expect(doc).toHaveProperty('title');
      expect(doc).toHaveProperty('url');
    });
  });

  describe('AC8: Includes Registrar Information', () => {
    it('should include registrar information in IPO object', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.ipo).toHaveProperty('registrar');
      expect(data.ipo.registrar).toBe(testIPO.registrar);
    });
  });

  describe('AC10: Response Time and Caching', () => {
    it('should cache response in Redis', async () => {
      const request = createMockRequest(testIPO.slug);

      // First request (cache miss)
      const response1 = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      expect(response1.status).toBe(200);
      expect(response1.headers.get('X-Cache')).toBe('MISS');

      // Check if cache was populated
      const redis = getRedisClient();
      const cacheKey = `ipo:detail:${testIPO.slug}`;
      const cachedData = await redis.get(cacheKey);
      expect(cachedData).not.toBeNull();

      // Second request (should hit cache)
      const response2 = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      expect(response2.status).toBe(200);
      expect(response2.headers.get('X-Cache')).toBe('HIT');
    });

    it('should include proper cache headers', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      expect(response.headers.get('Cache-Control')).toBe(
        'public, s-maxage=900, stale-while-revalidate=1800'
      );
    });

    it('should respond in <500ms with cache', async () => {
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
      expect(duration).toBeLessThan(500);
    });

    it('should include X-Response-Time header', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });

      const responseTime = response.headers.get('X-Response-Time');
      expect(responseTime).toBeDefined();
      expect(responseTime).toMatch(/\d+ms/);
    });
  });

  describe('AC11: API Metadata', () => {
    it('should include metadata with lastUpdated timestamp', async () => {
      const request = createMockRequest(testIPO.slug);
      const response = await GET(request, {
        params: Promise.resolve({ slug: testIPO.slug }),
      });
      const data: IPODetailResponse = await response.json();

      expect(data.metadata).toBeDefined();
      expect(data.metadata).toHaveProperty('lastUpdated');
      expect(typeof data.metadata.lastUpdated).toBe('string');

      // Verify it's a valid ISO date string
      const date = new Date(data.metadata.lastUpdated);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format', async () => {
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
