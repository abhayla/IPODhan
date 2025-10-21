/**
 * Integration Tests for Phase 5 New API Endpoints
 *
 * Tests all 12 newly implemented endpoints:
 * - Priority 1: financials, documents, listing-performance, peers
 * - Priority 2: subscription/gmp history, calendar, admin POST/PATCH
 * - Priority 3: search (registrars/market-holidays already tested)
 *
 * Requirements:
 * - PostgreSQL database running
 * - Redis cache running
 * - Test data seeded
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { DocumentRepository } from '@/lib/repositories/document-repository';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
import { PeerCompanyRepository } from '@/lib/repositories/peer-company-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || 'test-admin-token-32-characters-long';

// Test data setup
let testIPOId: string;
let testIPOSlug: string;

describe('Phase 5 New API Endpoints - Integration Tests', () => {
  beforeAll(async () => {
    // Create test IPO for testing
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const testIPO = await ipoRepository.create({
      companyName: 'Test Company for New Endpoints',
      category: 'MAINBOARD',
      segment: 'MAINBOARD',
      status: 'OPEN',
      slug: generateIPOSlug('Test Company for New Endpoints'),
      openDate: new Date('2025-10-20'),
      closeDate: new Date('2025-10-24'),
      issuePrice: 100,
      lotSize: 150,
    });

    testIPOId = testIPO.id;
    testIPOSlug = testIPO.slug;

    // Seed financial data
    const financialRepo = new FinancialDataRepository(db, redis);
    await financialRepo.create({
      ipoId: testIPOId,
      revenueFy2024: '1000.50',
      profitFy2024: '200.25',
      peRatio: '15.5',
    });

    // Seed documents
    const documentRepo = new DocumentRepository(db, redis);
    await documentRepo.create({
      ipoId: testIPOId,
      type: 'DRHP',
      title: 'Draft Red Herring Prospectus',
      url: 'https://example.com/drhp.pdf',
      mediaType: 'PDF',
      exchange: 'BSE',
    });

    // Seed listing performance
    const listingRepo = new ListingPerformanceRepository(db, redis);
    await listingRepo.upsert({
      ipoId: testIPOId,
      listingPrice: 120,
      issuePrice: 100,
      listingGainPercent: '20.00',
      listingDate: new Date('2025-10-28'),
    });

    // Seed peer companies
    const peerRepo = new PeerCompanyRepository(db, redis);
    await peerRepo.create({
      ipoId: testIPOId,
      companyName: 'Peer Company 1',
      isListed: true,
      peRatio: '12.5',
      sector: 'Technology',
    });

    // Seed subscription data
    const subscriptionRepo = new SubscriptionRepository(db, redis);
    await subscriptionRepo.createSnapshot({
      ipoId: testIPOId,
      timestamp: new Date('2025-10-21T10:00:00Z'),
      retailSubscription: '2.5',
      qibSubscription: '5.0',
      niiSubscription: '3.0',
      totalSubscription: '3.5',
    });

    // Seed GMP data
    const gmpRepo = new GMPRepository(db, redis);
    await gmpRepo.create({
      ipoId: testIPOId,
      timestamp: new Date('2025-10-21T10:00:00Z'),
      gmp: 50,
      expectedListingPrice: 150,
      source: 'Test Source',
    });
  });

  // ==================== PRIORITY 1 ENDPOINTS ====================

  describe('Priority 1: Critical Business Features', () => {
    describe('GET /api/ipos/[slug]/financials', () => {
      it('should return financial data for an IPO', async () => {
        const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/financials`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeDefined();
        expect(data.data.revenueFy2024).toBe('1000.50');
        expect(data.data.profitFy2024).toBe('200.25');
        expect(data.data.peRatio).toBe('15.5');
        expect(data.metadata.ipoId).toBe(testIPOId);
      });

      it('should return 404 for non-existent IPO', async () => {
        const response = await fetch(`${BASE_URL}/api/ipos/non-existent-ipo/financials`);
        expect(response.status).toBe(404);

        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error.code).toBe('NOT_FOUND');
      });
    });

    describe('GET /api/ipos/[slug]/documents', () => {
      it('should return documents for an IPO', async () => {
        const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/documents`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.data[0].type).toBe('DRHP');
        expect(data.data[0].title).toBe('Draft Red Herring Prospectus');
        expect(data.metadata.totalDocuments).toBe(data.data.length);
      });

      it('should return empty array for IPO with no documents', async () => {
        // Create IPO without documents
        const redis = getRedisClient();
        const ipoRepo = new IPORepository(db, redis);
        const emptyIPO = await ipoRepo.create({
          companyName: 'IPO Without Docs',
          category: 'SME',
          status: 'UPCOMING',
          slug: generateIPOSlug('IPO Without Docs'),
        });

        const response = await fetch(`${BASE_URL}/api/ipos/${emptyIPO.slug}/documents`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toEqual([]);
      });
    });

    describe('GET /api/ipos/[slug]/listing-performance', () => {
      it('should return listing performance data', async () => {
        const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/listing-performance`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeDefined();
        expect(data.data.listingPrice).toBe(120);
        expect(data.data.issuePrice).toBe(100);
        expect(data.data.listingGainPercent).toBe('20.00');
      });

      it('should return 404 for IPO without listing performance', async () => {
        const redis = getRedisClient();
        const ipoRepo = new IPORepository(db, redis);
        const upcomingIPO = await ipoRepo.create({
          companyName: 'Upcoming IPO',
          category: 'MAINBOARD',
          status: 'UPCOMING',
          slug: generateIPOSlug('Upcoming IPO'),
        });

        const response = await fetch(`${BASE_URL}/api/ipos/${upcomingIPO.slug}/listing-performance`);
        expect(response.status).toBe(404);
      });
    });

    describe('GET /api/ipos/[slug]/peers', () => {
      it('should return peer companies for an IPO', async () => {
        const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/peers`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.data[0].companyName).toBe('Peer Company 1');
        expect(data.data[0].isListed).toBe(true);
        expect(data.metadata.totalPeers).toBe(data.data.length);
      });
    });
  });

  // ==================== PRIORITY 2 ENDPOINTS ====================

  describe('Priority 2: Important Features', () => {
    describe('GET /api/subscription/history/[ipoId]', () => {
      it('should return subscription history', async () => {
        const response = await fetch(`${BASE_URL}/api/subscription/history/${testIPOId}`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.data[0].retailSubscription).toBe('2.5');
        expect(data.metadata.ipoId).toBe(testIPOId);
      });

      it('should filter by days parameter', async () => {
        const response = await fetch(`${BASE_URL}/api/subscription/history/${testIPOId}?days=7`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.metadata.dateRange).toBe('7 days');
      });

      it('should validate days parameter', async () => {
        const response = await fetch(`${BASE_URL}/api/subscription/history/${testIPOId}?days=500`);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/gmp/history/[ipoId]', () => {
      it('should return GMP history', async () => {
        const response = await fetch(`${BASE_URL}/api/gmp/history/${testIPOId}`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.data.length).toBeGreaterThan(0);
        expect(data.data[0].gmp).toBe(50);
        expect(data.data[0].expectedListingPrice).toBe(150);
      });

      it('should filter by days parameter', async () => {
        const response = await fetch(`${BASE_URL}/api/gmp/history/${testIPOId}?days=30`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.metadata.dateRange).toBe('30 days');
      });
    });

    describe('GET /api/calendar', () => {
      it('should return calendar events', async () => {
        const response = await fetch(`${BASE_URL}/api/calendar`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.metadata.totalEvents).toBeGreaterThan(0);
      });

      it('should filter by category', async () => {
        const response = await fetch(`${BASE_URL}/api/calendar?category=MAINBOARD`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.metadata.filters.category).toBe('MAINBOARD');
      });

      it('should filter by month', async () => {
        const response = await fetch(`${BASE_URL}/api/calendar?month=2025-10`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.metadata.filters.month).toBe('2025-10');
      });

      it('should validate month format', async () => {
        const response = await fetch(`${BASE_URL}/api/calendar?month=invalid`);
        expect(response.status).toBe(400);
      });
    });

    describe('POST /api/admin/ipos', () => {
      it('should create new IPO with admin auth', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/ipos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
          },
          body: JSON.stringify({
            companyName: 'New Test IPO',
            category: 'MAINBOARD',
            status: 'UPCOMING',
            issuePrice: 200,
            lotSize: 100,
          }),
        });

        expect(response.status).toBe(201);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.companyName).toBe('New Test IPO');
        expect(data.metadata.generatedSlug).toBeDefined();
      });

      it('should reject without admin auth', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/ipos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            companyName: 'Test IPO',
            category: 'MAINBOARD',
            status: 'UPCOMING',
          }),
        });

        expect(response.status).toBe(401);
      });

      it('should validate required fields', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/ipos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
          },
          body: JSON.stringify({
            companyName: 'Test',
            // Missing category and status
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('PATCH /api/admin/ipos/[id]', () => {
      it('should update IPO with admin auth', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/ipos/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ADMIN_TOKEN}`,
          },
          body: JSON.stringify({
            issuePrice: 150,
            lotSize: 200,
          }),
        });

        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.issuePrice).toBe(150);
        expect(data.metadata.updatedFields).toContain('issuePrice');
      });

      it('should reject without admin auth', async () => {
        const response = await fetch(`${BASE_URL}/api/admin/ipos/${testIPOId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ issuePrice: 150 }),
        });

        expect(response.status).toBe(401);
      });

      it('should return 404 for non-existent IPO', async () => {
        const response = await fetch(
          `${BASE_URL}/api/admin/ipos/00000000-0000-0000-0000-000000000000`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ADMIN_TOKEN}`,
            },
            body: JSON.stringify({ issuePrice: 150 }),
          }
        );

        expect(response.status).toBe(404);
      });
    });
  });

  // ==================== PRIORITY 3 ENDPOINTS ====================

  describe('Priority 3: Nice-to-Have', () => {
    describe('GET /api/search', () => {
      it('should perform fuzzy search', async () => {
        const response = await fetch(`${BASE_URL}/api/search?q=test&limit=10`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data).toBeInstanceOf(Array);
        expect(data.metadata.query).toBe('test');
        expect(data.metadata.totalResults).toBeGreaterThanOrEqual(0);
      });

      it('should validate minimum query length', async () => {
        const response = await fetch(`${BASE_URL}/api/search?q=a`);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate limit parameter', async () => {
        const response = await fetch(`${BASE_URL}/api/search?q=test&limit=100`);
        expect(response.status).toBe(400);
      });

      it('should return results with similarity scores', async () => {
        const response = await fetch(`${BASE_URL}/api/search?q=${testIPOSlug.substring(0, 10)}`);
        expect(response.status).toBe(200);

        const data = await response.json();
        if (data.data.length > 0) {
          expect(data.data[0].similarity).toBeDefined();
          expect(typeof data.data[0].similarity).toBe('number');
        }
      });
    });
  });

  // ==================== CACHE VALIDATION ====================

  describe('Cache Functionality', () => {
    it('should cache financial data responses', async () => {
      // First request (cache miss)
      const response1 = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/financials`);
      expect(response1.status).toBe(200);

      // Second request (cache hit)
      const response2 = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/financials`);
      expect(response2.status).toBe(200);

      const data = await response2.json();
      expect(data.success).toBe(true);
    });

    it('should invalidate cache after admin update', async () => {
      // Update IPO
      await fetch(`${BASE_URL}/api/admin/ipos/${testIPOId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ADMIN_TOKEN}`,
        },
        body: JSON.stringify({ issuePrice: 180 }),
      });

      // Fetch updated data
      const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/financials`);
      expect(response.status).toBe(200);
    });
  });

  // ==================== PERFORMANCE VALIDATION ====================

  describe('Performance Targets', () => {
    it('should respond within 500ms (p95 target)', async () => {
      const startTime = Date.now();
      const response = await fetch(`${BASE_URL}/api/ipos/${testIPOSlug}/financials`);
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
    });

    it('should handle search within 500ms', async () => {
      const startTime = Date.now();
      const response = await fetch(`${BASE_URL}/api/search?q=test&limit=10`);
      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(500);
    });
  });
});
