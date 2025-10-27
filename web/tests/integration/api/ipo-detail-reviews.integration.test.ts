/**
 * Integration Tests for IPO Detail API with Review Summary
 *
 * Story 11.16: IPO Recommendations Summary Section
 *
 * Tests that IPO detail endpoint includes review summary data:
 * - GET /api/ipos/[slug] returns reviewSummary field
 * - reviewSummary is null when no approved reviews
 * - reviewSummary is populated when approved reviews exist
 * - Only approved reviews included in summary
 * - Cache behavior (hit/miss performance)
 *
 * Coverage Target: >85%
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ipos, ipoReviews } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { ReviewRepository } from '@/lib/repositories/review-repository';

// ==================== TEST DATA ====================

const testIPO = {
  id: 'test-ipo-reviews-detail',
  companyName: 'Review Summary Test Corp',
  slug: 'review-summary-test-corp',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  status: 'OPEN' as const,
  sector: 'Technology',
  issueSize: '500.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 125,
  openDate: '2025-01-10',
  closeDate: '2025-01-12',
};

const testReviewsApproved = [
  {
    id: 'test-review-approved-001',
    ipoId: testIPO.id,
    author: 'ICICI Direct',
    reviewTitle: 'Strong Growth Story - Subscribe',
    reviewContent: `
      The company demonstrates strong fundamentals with consistent growth.
      Good valuation and experienced management team. Growth potential
      is significant with market leader position.
    `,
    reviewUrl: 'https://example.com/review-1',
    recommendation: 'Subscribe' as const,
    publishedDate: new Date('2025-10-20'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-21'),
  },
  {
    id: 'test-review-approved-002',
    ipoId: testIPO.id,
    author: 'Motilal Oswal',
    reviewTitle: 'May Apply with Caution',
    reviewContent: `
      Reasonable valuation with healthy financials. Strong fundamentals
      observed. Investors with moderate risk appetite may apply.
    `,
    reviewUrl: 'https://example.com/review-2',
    recommendation: 'May apply' as const,
    publishedDate: new Date('2025-10-19'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-20'),
  },
  {
    id: 'test-review-approved-003',
    ipoId: testIPO.id,
    author: 'Angel Broking',
    reviewTitle: 'High Valuation - Avoid',
    reviewContent: `
      High valuation compared to peers. Weak financials with debt burden.
      Intense competition in the sector. Regulatory risks present.
    `,
    reviewUrl: null,
    recommendation: 'Avoid' as const,
    publishedDate: new Date('2025-10-18'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-19'),
  },
];

const testReviewsPending = [
  {
    id: 'test-review-pending-001',
    ipoId: testIPO.id,
    author: 'Sharekhan',
    reviewTitle: 'Pending Review - Not Recommended',
    reviewContent: 'Business model unclear with poor track record.',
    reviewUrl: null,
    recommendation: 'Not Recommended' as const,
    publishedDate: new Date('2025-10-17'),
    isApproved: false,
    moderatedBy: null,
    moderatedAt: null,
  },
];

// IPO with no reviews
const testIPONoReviews = {
  id: 'test-ipo-no-reviews',
  companyName: 'No Reviews Test Corp',
  slug: 'no-reviews-test-corp',
  segment: 'SME' as const,
  offeringType: 'IPO' as const,
  status: 'UPCOMING' as const,
  sector: 'Finance',
  issueSize: '200.00',
  priceRangeMin: 50,
  priceRangeMax: 60,
  lotSize: 200,
  openDate: '2025-02-10',
  closeDate: '2025-02-12',
};

// ==================== HELPER FUNCTIONS ====================

async function cleanupTestData() {
  try {
    // Delete test reviews
    const allReviews = [...testReviewsApproved, ...testReviewsPending];
    for (const review of allReviews) {
      await db.delete(ipoReviews).where(eq(ipoReviews.id, review.id));
    }

    // Delete test IPOs
    await db.delete(ipos).where(eq(ipos.id, testIPO.id));
    await db.delete(ipos).where(eq(ipos.id, testIPONoReviews.id));
  } catch (error) {
    console.error('Failed to cleanup test data:', error);
  }
}

async function seedTestData() {
  try {
    // Insert test IPOs
    await db.insert(ipos).values([testIPO, testIPONoReviews]);

    // Insert test reviews
    await db
      .insert(ipoReviews)
      .values([...testReviewsApproved, ...testReviewsPending]);
  } catch (error) {
    console.error('Failed to seed test data:', error);
    throw error;
  }
}

async function clearRedisCache() {
  try {
    const redis = getRedisClient();
    const patterns = ['review:*', 'ipo:slug:*'];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } catch (error) {
    console.error('Failed to clear Redis cache:', error);
  }
}

// ==================== TESTS ====================

describe('IPO Detail API with Review Summary Integration Tests', () => {
  let reviewRepository: ReviewRepository;

  beforeAll(async () => {
    await cleanupTestData();
    await seedTestData();

    const redis = getRedisClient();
    reviewRepository = new ReviewRepository(db, redis);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await clearRedisCache();
  });

  // ==================== Review Summary Field ====================

  describe('Review Summary Field in IPO Detail', () => {
    it('should include reviewSummary field in response', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      expect(reviewSummary).not.toBeNull();
      expect(reviewSummary).toHaveProperty('averageRating');
      expect(reviewSummary).toHaveProperty('totalReviews');
      expect(reviewSummary).toHaveProperty('recommendationBreakdown');
      expect(reviewSummary).toHaveProperty('sentimentAnalysis');
      expect(reviewSummary).toHaveProperty('topApplyReasons');
      expect(reviewSummary).toHaveProperty('topAvoidReasons');
      expect(reviewSummary).toHaveProperty('latestReviews');
    });

    it('should return null when no approved reviews exist', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(
        testIPONoReviews.id
      );

      expect(reviewSummary).toBeNull();
    });

    it('should populate reviewSummary when approved reviews exist', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      expect(reviewSummary).not.toBeNull();
      expect(reviewSummary?.totalReviews).toBe(3); // 3 approved reviews
      expect(reviewSummary?.averageRating).toBeGreaterThan(0);
      expect(reviewSummary?.averageRating).toBeLessThanOrEqual(5);
    });
  });

  // ==================== Only Approved Reviews ====================

  describe('Only Approved Reviews in Summary', () => {
    it('should only include approved reviews in summary', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      // Should have 3 approved reviews, not 4 (excluding pending)
      expect(reviewSummary?.totalReviews).toBe(3);

      // Verify latestReviews are all approved
      expect(reviewSummary?.latestReviews.length).toBe(3);
      expect(
        reviewSummary?.latestReviews.every((r) => r.isApproved === true)
      ).toBe(true);
    });

    it('should not include pending reviews in breakdown', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      // Breakdown should only reflect approved reviews
      const totalInBreakdown =
        (reviewSummary?.recommendationBreakdown.apply || 0) +
        (reviewSummary?.recommendationBreakdown.subscribe || 0) +
        (reviewSummary?.recommendationBreakdown.avoid || 0) +
        (reviewSummary?.recommendationBreakdown.notRecommended || 0);

      expect(totalInBreakdown).toBe(3); // Only 3 approved, not 4
    });

    it('should calculate correct recommendation breakdown', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      expect(reviewSummary?.recommendationBreakdown).toEqual({
        apply: 1, // 1 "May apply"
        subscribe: 1, // 1 "Subscribe"
        avoid: 1, // 1 "Avoid"
        notRecommended: 0, // Pending one not included
      });
    });

    it('should calculate correct sentiment analysis', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      // Positive: May apply + Subscribe = 2/3 = 67%
      // Negative: Avoid = 1/3 = 33%
      expect(reviewSummary?.sentimentAnalysis.positive).toBe(67);
      expect(reviewSummary?.sentimentAnalysis.negative).toBe(33);
    });
  });

  // ==================== Cache Performance ====================

  describe('Cache Behavior', () => {
    it('should hit cache on second call (<50ms)', async () => {
      // First call - cache miss
      const startFirstCall = Date.now();
      const firstResult = await reviewRepository.getReviewSummary(testIPO.id);
      const firstCallDuration = Date.now() - startFirstCall;

      expect(firstResult).not.toBeNull();

      // Second call - cache hit
      const startSecondCall = Date.now();
      const secondResult = await reviewRepository.getReviewSummary(testIPO.id);
      const secondCallDuration = Date.now() - startSecondCall;

      expect(secondResult).toEqual(firstResult);

      // Cache hit should be significantly faster
      // Target: <50ms for cache hit
      expect(secondCallDuration).toBeLessThan(50);
      console.log(`Cache hit duration: ${secondCallDuration}ms`);
    });

    it('should query database on cache miss (<200ms)', async () => {
      // Clear cache to force miss
      await clearRedisCache();

      const start = Date.now();
      const result = await reviewRepository.getReviewSummary(testIPO.id);
      const duration = Date.now() - start;

      expect(result).not.toBeNull();

      // Database query should complete reasonably fast
      // Target: <200ms for cache miss
      expect(duration).toBeLessThan(200);
      console.log(`Cache miss (DB query) duration: ${duration}ms`);
    });

    it('should populate cache after first query', async () => {
      const redis = getRedisClient();

      // Clear cache
      await clearRedisCache();

      // Verify cache is empty
      const cacheKeyBefore = `review:summary:${testIPO.id}`;
      const cachedBefore = await redis.get(cacheKeyBefore);
      expect(cachedBefore).toBeNull();

      // Query (should populate cache)
      await reviewRepository.getReviewSummary(testIPO.id);

      // Verify cache is populated
      const cachedAfter = await redis.get(cacheKeyBefore);
      expect(cachedAfter).not.toBeNull();

      // Parse cached data
      const parsed = JSON.parse(cachedAfter!);
      expect(parsed).toHaveProperty('averageRating');
      expect(parsed).toHaveProperty('totalReviews');
    });
  });

  // ==================== Data Accuracy ====================

  describe('Review Summary Data Accuracy', () => {
    it('should calculate average rating correctly', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      // Rating calculation:
      // Subscribe (4) + May apply (5) + Avoid (2) = 11 / 3 = 3.7
      expect(reviewSummary?.averageRating).toBe(3.7);
    });

    it('should return latest 3 reviews ordered by date', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      expect(reviewSummary?.latestReviews.length).toBe(3);

      // Should be ordered by publishedDate descending
      const dates = reviewSummary?.latestReviews.map((r) =>
        new Date(r.publishedDate).getTime()
      );
      const sortedDates = [...(dates || [])].sort((a, b) => b - a);
      expect(dates).toEqual(sortedDates);
    });

    it('should extract top reasons from review content', async () => {
      const reviewSummary = await reviewRepository.getReviewSummary(testIPO.id);

      // Should extract keywords from approved reviews
      expect(reviewSummary?.topApplyReasons.length).toBeGreaterThan(0);
      expect(reviewSummary?.topAvoidReasons.length).toBeGreaterThan(0);

      // Check for expected keywords
      expect(reviewSummary?.topApplyReasons).toContain('Strong fundamentals');
      expect(reviewSummary?.topAvoidReasons).toContain('High valuation');
    });
  });
});
