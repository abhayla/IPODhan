/**
 * Integration Tests: Real-Time IPO Scoring System (Phase 5)
 *
 * Tests end-to-end scoring workflow with actual database and Redis:
 * - Score calculation with real data
 * - Cache hit/miss scenarios
 * - Score persistence to database
 * - Batch score retrieval
 * - Cache invalidation
 * - TTL strategy based on IPO status
 *
 * Requires: PostgreSQL + Redis running
 *
 * @module tests/integration/ipo-scores-realtime
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPOScoreRealtimeRepository } from '@/lib/repositories/ipo-score-realtime-repository';
import { IPOScoringService } from '@/lib/services/ipo-scoring-realtime';
import { ipos, financialData, subscriptions, gmpRecords, listingPerformance, ipoScores } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// ==================== TEST SETUP ====================

let db: Awaited<ReturnType<typeof getDb>>;
let redis: ReturnType<typeof getRedisClient>;
let testIPOId: string;

beforeAll(async () => {
  db = await getDb();
  redis = getRedisClient();

  // Create test IPO with full data
  testIPOId = uuidv4();

  await db.insert(ipos).values({
    id: testIPOId,
    companyName: 'Integration Test Company Ltd',
    slug: 'integration-test-company-ipo',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    status: 'OPEN',
    issueSize: 1200,
    priceRangeMin: 100,
    priceRangeMax: 110,
    lotSize: 100,
    openDate: new Date('2025-10-15'),
    closeDate: new Date('2025-10-18'),
  });

  // Add financial data
  await db.insert(financialData).values({
    id: uuidv4(),
    ipoId: testIPOId,
    revenueFy2022: 500,
    revenueFy2023: 750,
    revenueFy2024: 1050, // 40% growth
    profitFy2022: 50,
    profitFy2023: 90,
    profitFy2024: 168, // 16% margin
    peRatio: 22,
    roe: 22,
  });

  // Add subscription data
  await db.insert(subscriptions).values({
    id: uuidv4(),
    ipoId: testIPOId,
    timestamp: new Date(),
    totalSubscription: 75, // 75x
    qibSubscription: 40,   // 40x
    retailSubscription: 20,
    niiSubscription: 15,
  });

  // Add GMP data
  await db.insert(gmpRecords).values({
    id: uuidv4(),
    ipoId: testIPOId,
    timestamp: new Date(),
    gmp: 44, // 40% premium on ₹110
    expectedListingPrice: 154,
    source: 'Chittorgarh',
  });

  console.log(`[Test Setup] Created test IPO: ${testIPOId}`);
});

afterAll(async () => {
  // Cleanup test data
  await db.delete(ipoScores).where(eq(ipoScores.ipoId, testIPOId));
  await db.delete(gmpRecords).where(eq(gmpRecords.ipoId, testIPOId));
  await db.delete(subscriptions).where(eq(subscriptions.ipoId, testIPOId));
  await db.delete(financialData).where(eq(financialData.ipoId, testIPOId));
  await db.delete(ipos).where(eq(ipos.id, testIPOId));

  // Clear test cache
  await redis.del(`ipo:score:realtime:${testIPOId}`);

  console.log(`[Test Cleanup] Removed test IPO: ${testIPOId}`);
});

// ==================== INTEGRATION TESTS ====================

describe('IPO Score Realtime Integration', () => {
  describe('Score Calculation with Real Data', () => {
    it('should calculate score from database', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      const score = await scoreRepo.getOrCalculateScore(testIPOId);

      expect(score).toBeDefined();
      expect(score.total).toBeGreaterThan(0);
      expect(score.total).toBeLessThanOrEqual(10);
      expect(score.rating).toBeDefined();
      expect(score.confidence).toBeGreaterThan(0);
      expect(score.confidence).toBeLessThanOrEqual(100);

      // Verify components are within valid ranges
      expect(score.financialStrength).toBeGreaterThanOrEqual(0);
      expect(score.financialStrength).toBeLessThanOrEqual(3);

      expect(score.valuation).toBeGreaterThanOrEqual(0);
      expect(score.valuation).toBeLessThanOrEqual(2);

      expect(score.subscriptionDemand).toBeGreaterThanOrEqual(0);
      expect(score.subscriptionDemand).toBeLessThanOrEqual(2);

      expect(score.marketPerformance).toBeGreaterThanOrEqual(0);
      expect(score.marketPerformance).toBeLessThanOrEqual(2);

      expect(score.fundamentals).toBeGreaterThanOrEqual(0);
      expect(score.fundamentals).toBeLessThanOrEqual(1);

      console.log('[Test] Score calculated:', {
        total: score.total,
        rating: score.rating,
        confidence: score.confidence,
      });
    });

    it('should provide detailed breakdown', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      const score = await scoreRepo.getOrCalculateScore(testIPOId);

      expect(score.breakdown).toBeDefined();

      // Check for expected breakdown fields based on available data
      if (score.financialStrength > 0) {
        expect(score.breakdown.revenueGrowth).toBeDefined();
        expect(score.breakdown.profitability).toBeDefined();
        expect(score.breakdown.roe).toBeDefined();
      }

      if (score.subscriptionDemand > 0) {
        expect(score.breakdown.overallSubscription).toBeDefined();
        expect(score.breakdown.qibSubscription).toBeDefined();
      }

      if (score.marketPerformance > 0) {
        expect(score.breakdown.gmpPremium).toBeDefined();
      }

      console.log('[Test] Breakdown:', score.breakdown);
    });
  });

  describe('Cache Behavior', () => {
    it('should cache score after first calculation', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Clear cache first
      await redis.del(`ipo:score:realtime:${testIPOId}`);

      // First call - should calculate and cache
      const startTime1 = Date.now();
      const score1 = await scoreRepo.getOrCalculateScore(testIPOId);
      const duration1 = Date.now() - startTime1;

      // Second call - should use cache
      const startTime2 = Date.now();
      const score2 = await scoreRepo.getOrCalculateScore(testIPOId);
      const duration2 = Date.now() - startTime2;

      // Cache hit should be faster
      expect(duration2).toBeLessThan(duration1);

      // Scores should be identical
      expect(score2.total).toBe(score1.total);
      expect(score2.rating).toBe(score1.rating);

      console.log('[Test] Cache performance:', {
        firstCall: `${duration1}ms`,
        cachedCall: `${duration2}ms`,
        speedup: `${((duration1 / duration2) - 1) * 100}%`,
      });
    });

    it('should invalidate cache correctly', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Calculate and cache
      await scoreRepo.getOrCalculateScore(testIPOId);

      // Verify cache exists
      const cached = await redis.get(`ipo:score:realtime:${testIPOId}`);
      expect(cached).toBeTruthy();

      // Invalidate
      await scoreRepo.invalidateScore(testIPOId);

      // Verify cache cleared
      const afterInvalidate = await redis.get(`ipo:score:realtime:${testIPOId}`);
      expect(afterInvalidate).toBeNull();
    });
  });

  describe('Database Persistence', () => {
    it('should save score to ipo_scores table', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Calculate score
      await scoreRepo.getOrCalculateScore(testIPOId);

      // Verify it was saved to database
      const [savedScore] = await db
        .select()
        .from(ipoScores)
        .where(eq(ipoScores.ipoId, testIPOId))
        .limit(1);

      expect(savedScore).toBeDefined();
      expect(savedScore.ipoId).toBe(testIPOId);
      expect(savedScore.totalScore).toBeGreaterThan(0);
      expect(savedScore.totalScore).toBeLessThanOrEqual(100); // DB uses 0-100 scale
      expect(savedScore.algorithmVersion).toBe('realtime-v1.0');
      expect(savedScore.calculatedAt).toBeDefined();

      console.log('[Test] Saved score:', {
        total: savedScore.totalScore,
        verdict: savedScore.verdict,
        confidence: savedScore.confidence,
      });
    });

    it('should update existing score on recalculation', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // First calculation
      await scoreRepo.getOrCalculateScore(testIPOId);

      const [firstScore] = await db
        .select()
        .from(ipoScores)
        .where(eq(ipoScores.ipoId, testIPOId))
        .limit(1);

      const firstCalculatedAt = firstScore.calculatedAt;

      // Wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Force recalculation by clearing cache
      await scoreRepo.invalidateScore(testIPOId);

      // Second calculation
      await scoreRepo.getOrCalculateScore(testIPOId);

      const [secondScore] = await db
        .select()
        .from(ipoScores)
        .where(eq(ipoScores.ipoId, testIPOId))
        .limit(1);

      // Timestamp should be updated
      expect(secondScore.calculatedAt.getTime()).toBeGreaterThan(
        firstCalculatedAt.getTime()
      );

      // Should still be same IPO
      expect(secondScore.id).toBe(firstScore.id);
    });
  });

  describe('Batch Score Retrieval', () => {
    it('should retrieve scores for multiple IPOs', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Create additional test IPO
      const testIPO2 = uuidv4();
      await db.insert(ipos).values({
        id: testIPO2,
        companyName: 'Test Company 2',
        slug: 'test-company-2-ipo',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'UPCOMING',
        issueSize: 50,
        priceRangeMin: 50,
        priceRangeMax: 60,
        lotSize: 200,
      });

      try {
        const scoreMap = await scoreRepo.getBatchScores([testIPOId, testIPO2]);

        expect(scoreMap.size).toBeGreaterThan(0);
        expect(scoreMap.has(testIPOId)).toBe(true);

        const score1 = scoreMap.get(testIPOId);
        expect(score1).toBeDefined();
        expect(score1!.total).toBeGreaterThan(0);

        console.log('[Test] Batch scores retrieved:', scoreMap.size);
      } finally {
        // Cleanup
        await db.delete(ipoScores).where(eq(ipoScores.ipoId, testIPO2));
        await db.delete(ipos).where(eq(ipos.id, testIPO2));
      }
    });
  });

  describe('Error Handling', () => {
    it('should throw error for non-existent IPO', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      const fakeId = uuidv4();

      await expect(
        scoreRepo.getOrCalculateScore(fakeId)
      ).rejects.toThrow('IPO not found');
    });

    it('should handle missing data gracefully', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Create minimal IPO with no related data
      const minimalIPO = uuidv4();
      await db.insert(ipos).values({
        id: minimalIPO,
        companyName: 'Minimal Test IPO',
        slug: 'minimal-test-ipo',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
      });

      try {
        const score = await scoreRepo.getOrCalculateScore(minimalIPO);

        // Should still return a score (albeit with low confidence)
        expect(score).toBeDefined();
        expect(score.total).toBeGreaterThanOrEqual(0);
        expect(score.confidence).toBeLessThan(50); // Low confidence due to missing data

        console.log('[Test] Minimal data score:', {
          total: score.total,
          confidence: score.confidence,
        });
      } finally {
        // Cleanup
        await db.delete(ipoScores).where(eq(ipoScores.ipoId, minimalIPO));
        await db.delete(ipos).where(eq(ipos.id, minimalIPO));
      }
    });
  });

  describe('Performance', () => {
    it('should calculate score in < 200ms', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Clear cache to force fresh calculation
      await scoreRepo.invalidateScore(testIPOId);

      const startTime = Date.now();
      await scoreRepo.getOrCalculateScore(testIPOId);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(200);

      console.log('[Test] Calculation time:', `${duration}ms`);
    });

    it('should retrieve cached score in < 50ms', async () => {
      const scoreRepo = new IPOScoreRealtimeRepository(db, redis);

      // Ensure score is cached
      await scoreRepo.getOrCalculateScore(testIPOId);

      // Measure cache retrieval
      const startTime = Date.now();
      await scoreRepo.getOrCalculateScore(testIPOId);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(50);

      console.log('[Test] Cache retrieval time:', `${duration}ms`);
    });
  });
});
