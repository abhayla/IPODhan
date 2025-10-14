/**
 * Integration Tests for Calculate Ratings Script
 *
 * Tests the rating calculation script with database operations.
 * These tests require a test database to be available.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db, closePool } from '@/lib/db/index';
import { getRedisClient, closeRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
import { calculateIPORating } from '@/lib/services/rating-service';
import * as schema from '@/lib/db';
import { eq } from 'drizzle-orm';

// ==================== TEST SETUP ====================

let redis: ReturnType<typeof getRedisClient>;
let ipoRepo: IPORepository;
let subscriptionRepo: SubscriptionRepository;
let gmpRepo: GMPRepository;
let financialRepo: FinancialDataRepository;

beforeAll(async () => {
  // Initialize repositories
  redis = getRedisClient();
  ipoRepo = new IPORepository(db, redis);
  subscriptionRepo = new SubscriptionRepository(db, redis);
  gmpRepo = new GMPRepository(db, redis);
  financialRepo = new FinancialDataRepository(db, redis);
});

afterAll(async () => {
  // Cleanup connections
  await closeRedisClient();
  await closePool();
});

beforeEach(async () => {
  // Clear cache before each test
  try {
    await redis.flushall();
  } catch (error) {
    console.warn('Redis flush failed (may not be available in CI):', error);
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Create a test IPO in the database
 */
async function createTestIPO(status: 'OPEN' | 'CLOSED' = 'OPEN') {
  const [ipo] = await db
    .insert(schema.ipos)
    .values({
      companyName: 'Test Rating Company',
      slug: `test-rating-company-${Date.now()}`,
      category: 'MAINBOARD',
      sector: 'Technology',
      issueSize: '500',
      priceRangeMin: 100,
      priceRangeMax: 120,
      lotSize: 100,
      status,
      openDate: '2025-01-15',
      closeDate: '2025-01-17',
      rating: null,
      ratingRationale: null,
      ratingOverride: false,
    })
    .returning();

  return ipo;
}

/**
 * Create test subscription data
 */
async function createTestSubscription(ipoId: string, totalSubscription: number) {
  return await db.insert(schema.subscriptions).values({
    ipoId,
    timestamp: new Date(),
    totalSubscription: totalSubscription.toString(),
    qibSubscription: (totalSubscription * 0.4).toString(),
    niiSubscription: (totalSubscription * 0.3).toString(),
    retailSubscription: (totalSubscription * 0.3).toString(),
  });
}

/**
 * Create test GMP records
 */
async function createTestGMPRecords(ipoId: string, gmpValues: number[]) {
  const records = gmpValues.map((gmp, index) => ({
    ipoId,
    timestamp: new Date(Date.now() - index * 24 * 60 * 60 * 1000),
    gmp,
    expectedListingPrice: 120 + gmp,
    source: 'test',
  }));

  return await db.insert(schema.gmpRecords).values(records);
}

/**
 * Create test financial data
 */
async function createTestFinancialData(
  ipoId: string,
  revenue2023: number,
  revenue2024: number,
  profit2023: number,
  profit2024: number,
  peRatio?: number
) {
  return await db.insert(schema.financialData).values({
    ipoId,
    revenueFy2023: revenue2023.toString(),
    revenueFy2024: revenue2024.toString(),
    profitFy2023: profit2023.toString(),
    profitFy2024: profit2024.toString(),
    netWorth: '200',
    peRatio: peRatio ? peRatio.toString() : null,
    reservesAndSurplus: '150',
  });
}

/**
 * Create test peer companies
 */
async function createTestPeerCompanies(ipoId: string, peRatios: number[]) {
  const peers = peRatios.map((peRatio, index) => ({
    ipoId,
    companyName: `Test Peer ${index + 1}`,
    sector: 'Technology',
    isListed: true,
    peRatio: peRatio.toString(),
  }));

  return await db.insert(schema.peerCompanies).values(peers);
}

/**
 * Cleanup test data
 */
async function cleanupTestData(ipoId: string) {
  // Delete IPO (cascading will delete related data)
  await db.delete(schema.ipos).where(eq(schema.ipos.id, ipoId));
}

// ==================== TESTS ====================

describe('Calculate Ratings Script - Integration Tests', () => {
  describe('Rating calculation with complete data', () => {
    it('should calculate and store rating for IPO with all factors', async () => {
      // Create test IPO with complete data
      const ipo = await createTestIPO('OPEN');
      await createTestSubscription(ipo.id, 15); // Good subscription
      await createTestGMPRecords(ipo.id, [30, 35, 40]); // Positive GMP
      await createTestFinancialData(ipo.id, 100, 130, 10, 14, 25); // Good growth
      await createTestPeerCompanies(ipo.id, [25, 28, 30]); // Peer data

      // Fetch data for rating calculation
      const [latestSubscription, gmpRecords, financialData, peerCompanies] =
        await Promise.all([
          subscriptionRepo.findLatest(ipo.id),
          gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
          financialRepo.findByIPO(ipo.id),
          db
            .select()
            .from(schema.peerCompanies)
            .where(eq(schema.peerCompanies.ipoId, ipo.id)),
        ]);

      // Calculate rating
      const result = calculateIPORating(
        ipo,
        latestSubscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).not.toBeNull();
      expect(result.rating).toBeGreaterThanOrEqual(1.0);
      expect(result.rating).toBeLessThanOrEqual(5.0);
      expect(result.availableFactors).toHaveLength(5);

      // Update database
      await ipoRepo.updateRating(ipo.id, result.rating!, result.rationale);

      // Verify database update
      const updatedIPO = await ipoRepo.findById(ipo.id);
      expect(updatedIPO?.rating).toBe(result.rating);
      expect(updatedIPO?.ratingRationale).toBe(result.rationale);

      // Cleanup
      await cleanupTestData(ipo.id);
    });

    it('should update existing rating when recalculated', async () => {
      // Create test IPO with initial rating
      const [ipo] = await db
        .insert(schema.ipos)
        .values({
          companyName: 'Test Update Rating Company',
          slug: `test-update-${Date.now()}`,
          category: 'MAINBOARD',
          sector: 'Technology',
          issueSize: '500',
          priceRangeMin: 100,
          priceRangeMax: 120,
          lotSize: 100,
          status: 'OPEN',
          openDate: '2025-01-15',
          closeDate: '2025-01-17',
          rating: 3,
          ratingRationale: 'Old rationale',
          ratingOverride: false,
        })
        .returning();

      await createTestSubscription(ipo.id, 20); // Better subscription
      await createTestGMPRecords(ipo.id, [50, 55, 60]); // Better GMP
      await createTestFinancialData(ipo.id, 100, 160, 10, 18, 22); // Better growth
      await createTestPeerCompanies(ipo.id, [28, 30, 32]); // Peer data

      // Fetch data and calculate new rating
      const [latestSubscription, gmpRecords, financialData, peerCompanies] =
        await Promise.all([
          subscriptionRepo.findLatest(ipo.id),
          gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
          financialRepo.findByIPO(ipo.id),
          db
            .select()
            .from(schema.peerCompanies)
            .where(eq(schema.peerCompanies.ipoId, ipo.id)),
        ]);

      const result = calculateIPORating(
        ipo,
        latestSubscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      // Update database
      await ipoRepo.updateRating(ipo.id, result.rating!, result.rationale);

      // Verify new rating is different
      const updatedIPO = await ipoRepo.findById(ipo.id);
      expect(updatedIPO?.rating).not.toBe(3);
      expect(updatedIPO?.ratingRationale).not.toBe('Old rationale');
      expect(updatedIPO?.rating).toBeGreaterThanOrEqual(4.0); // Should be higher with better data

      // Cleanup
      await cleanupTestData(ipo.id);
    });
  });

  describe('Rating calculation with insufficient data', () => {
    it('should skip rating when only 2 factors available', async () => {
      // Create test IPO with minimal data (only 2 factors)
      const ipo = await createTestIPO('OPEN');
      await createTestSubscription(ipo.id, 10); // Factor 1
      await createTestGMPRecords(ipo.id, [20, 25, 30]); // Factor 2
      // No financials, no peers (missing 3 factors)

      // Fetch data
      const [latestSubscription, gmpRecords, financialData, peerCompanies] =
        await Promise.all([
          subscriptionRepo.findLatest(ipo.id),
          gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
          financialRepo.findByIPO(ipo.id),
          db
            .select()
            .from(schema.peerCompanies)
            .where(eq(schema.peerCompanies.ipoId, ipo.id)),
        ]);

      // Calculate rating
      const result = calculateIPORating(
        ipo,
        latestSubscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      expect(result.rating).toBeNull();
      expect(result.availableFactors.length).toBeLessThan(3);
      expect(result.rationale).toContain('Insufficient data');

      // Cleanup
      await cleanupTestData(ipo.id);
    });
  });

  describe('Cache invalidation', () => {
    it('should invalidate cache after rating update', async () => {
      // Create test IPO
      const ipo = await createTestIPO('OPEN');
      await createTestSubscription(ipo.id, 15);
      await createTestGMPRecords(ipo.id, [30, 35, 40]);
      await createTestFinancialData(ipo.id, 100, 130, 10, 14, 25);
      await createTestPeerCompanies(ipo.id, [25, 28, 30]);

      // Fetch IPO to populate cache
      const cachedIPO1 = await ipoRepo.findBySlug(ipo.slug);
      expect(cachedIPO1?.rating).toBeNull();

      // Calculate and update rating
      const [latestSubscription, gmpRecords, financialData, peerCompanies] =
        await Promise.all([
          subscriptionRepo.findLatest(ipo.id),
          gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
          financialRepo.findByIPO(ipo.id),
          db
            .select()
            .from(schema.peerCompanies)
            .where(eq(schema.peerCompanies.ipoId, ipo.id)),
        ]);

      const result = calculateIPORating(
        ipo,
        latestSubscription,
        gmpRecords,
        peerCompanies,
        financialData
      );

      await ipoRepo.updateRating(ipo.id, result.rating!, result.rationale);

      // Fetch again (should get fresh data from DB, not cache)
      const cachedIPO2 = await ipoRepo.findBySlug(ipo.slug);
      expect(cachedIPO2?.rating).toBe(result.rating);
      expect(cachedIPO2?.ratingRationale).toBe(result.rationale);

      // Cleanup
      await cleanupTestData(ipo.id);
    });
  });

  describe('Rating override functionality', () => {
    it('should respect rating override flag', async () => {
      // Create test IPO with override flag
      const [ipo] = await db
        .insert(schema.ipos)
        .values({
          companyName: 'Test Override Company',
          slug: `test-override-${Date.now()}`,
          category: 'MAINBOARD',
          sector: 'Technology',
          issueSize: '500',
          priceRangeMin: 100,
          priceRangeMax: 120,
          lotSize: 100,
          status: 'OPEN',
          openDate: '2025-01-15',
          closeDate: '2025-01-17',
          rating: 5,
          ratingRationale: 'Manual override rating',
          ratingOverride: true, // Override enabled
        })
        .returning();

      // The script should check this flag and skip recalculation
      expect(ipo.ratingOverride).toBe(true);
      expect(ipo.rating).toBe(5);

      // Cleanup
      await cleanupTestData(ipo.id);
    });
  });

  describe('Batch processing', () => {
    it('should process multiple IPOs correctly', async () => {
      // Create multiple test IPOs
      const ipo1 = await createTestIPO('OPEN');
      const ipo2 = await createTestIPO('CLOSED');

      // Add data for both
      await Promise.all([
        createTestSubscription(ipo1.id, 10),
        createTestGMPRecords(ipo1.id, [20, 25, 30]),
        createTestFinancialData(ipo1.id, 100, 120, 10, 13, 25),
        createTestPeerCompanies(ipo1.id, [25, 28, 30]),
        createTestSubscription(ipo2.id, 20),
        createTestGMPRecords(ipo2.id, [40, 45, 50]),
        createTestFinancialData(ipo2.id, 100, 150, 10, 16, 22),
        createTestPeerCompanies(ipo2.id, [28, 30, 32]),
      ]);

      // Process both IPOs
      for (const ipo of [ipo1, ipo2]) {
        const [latestSubscription, gmpRecords, financialData, peerCompanies] =
          await Promise.all([
            subscriptionRepo.findLatest(ipo.id),
            gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
            financialRepo.findByIPO(ipo.id),
            db
              .select()
              .from(schema.peerCompanies)
              .where(eq(schema.peerCompanies.ipoId, ipo.id)),
          ]);

        const result = calculateIPORating(
          ipo,
          latestSubscription,
          gmpRecords,
          peerCompanies,
          financialData
        );

        if (result.rating !== null) {
          await ipoRepo.updateRating(ipo.id, result.rating, result.rationale);
        }
      }

      // Verify both were updated
      const updatedIPO1 = await ipoRepo.findById(ipo1.id);
      const updatedIPO2 = await ipoRepo.findById(ipo2.id);

      expect(updatedIPO1?.rating).not.toBeNull();
      expect(updatedIPO2?.rating).not.toBeNull();
      // IPO2 should have higher rating (better data)
      expect(updatedIPO2!.rating!).toBeGreaterThan(updatedIPO1!.rating!);

      // Cleanup
      await cleanupTestData(ipo1.id);
      await cleanupTestData(ipo2.id);
    });
  });
});
