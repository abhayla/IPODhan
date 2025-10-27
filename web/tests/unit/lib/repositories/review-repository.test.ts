/**
 * Unit Tests for ReviewRepository
 *
 * Story 11.16: IPO Recommendations Summary Section
 *
 * Tests all repository methods with mocked database and Redis:
 * - getReviewSummary() with various scenarios
 * - findByIpoId() with filtering and limits
 * - approveReview() and rejectReview() with cache invalidation
 * - getPendingReviews() for admin operations
 * - extractReasonsFromContent() keyword matching
 * - getMostFrequentReasons() frequency analysis
 *
 * Coverage Target: >90%
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewRepository } from '@/lib/repositories/review-repository';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { EntityNotFoundError } from '@/lib/errors/repository-errors';
import {
  mockReviews,
  mockReviewSummary,
  getApprovedReviews,
  getPendingReviews,
  createMockReview,
} from '../../../fixtures/review.fixture';

// ==================== MOCK SETUP ====================

// Mock Drizzle DB
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} as any as NodePgDatabase<typeof schema>;

// Mock Redis
const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as Redis;

// ==================== TESTS ====================

describe('ReviewRepository', () => {
  let repository: ReviewRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ReviewRepository(mockDb, mockRedis);
  });

  // ==================== getReviewSummary() ====================

  describe('getReviewSummary()', () => {
    const ipoId = 'test-ipo-001';
    const approvedReviews = getApprovedReviews();

    it('should return null when no approved reviews exist', async () => {
      // Cache miss
      mockRedis.get = vi.fn().mockResolvedValue(null);

      // Database returns empty array
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.getReviewSummary(ipoId);

      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith(`review:summary:${ipoId}`);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should calculate average rating correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      // Rating calculation:
      // May apply (5) + Subscribe (4) + Avoid (2) = 11 / 3 = 3.7
      expect(result).not.toBeNull();
      expect(result?.averageRating).toBe(3.7);
      expect(result?.totalReviews).toBe(3);
    });

    it('should calculate recommendation breakdown correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      expect(result?.recommendationBreakdown).toEqual({
        apply: 1,
        subscribe: 1,
        avoid: 1,
        notRecommended: 0,
      });
    });

    it('should calculate sentiment analysis correctly', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      // Positive: May apply + Subscribe = 2/3 = 67%
      // Negative: Avoid = 1/3 = 33%
      expect(result?.sentimentAnalysis).toEqual({
        positive: 67,
        negative: 33,
      });
    });

    it('should extract top 3 Apply reasons from content', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      expect(result?.topApplyReasons).toContain('Strong fundamentals');
      expect(result?.topApplyReasons).toContain('Good valuation');
      expect(result?.topApplyReasons.length).toBeLessThanOrEqual(3);
    });

    it('should extract top 3 Avoid reasons from content', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      // Should contain at least one avoid reason
      expect(result?.topAvoidReasons.length).toBeGreaterThan(0);
      expect(result?.topAvoidReasons.length).toBeLessThanOrEqual(3);
      // Check that reasons are from avoid keywords
      const validAvoidReasons = [
        'High valuation',
        'Weak financials',
        'Intense competition',
        'Regulatory risks',
      ];
      result?.topAvoidReasons.forEach((reason) => {
        expect(validAvoidReasons).toContain(reason);
      });
    });

    it('should return latest 3 reviews in summary', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary(ipoId);

      expect(result?.latestReviews).toHaveLength(3);
      expect(result?.latestReviews[0].id).toBe('review-001-approved');
      expect(result?.latestReviews[1].id).toBe('review-002-approved');
      expect(result?.latestReviews[2].id).toBe('review-003-approved');
    });

    it('should use cache on second call', async () => {
      // First call - cache miss, populates cache
      mockRedis.get = vi.fn().mockResolvedValueOnce(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.getReviewSummary(ipoId);

      // Serialize and deserialize to match cache behavior (dates become strings)
      const cachedSummary = JSON.parse(
        JSON.stringify({
          averageRating: 3.7,
          totalReviews: 3,
          recommendationBreakdown: { apply: 1, subscribe: 1, avoid: 1, notRecommended: 0 },
          sentimentAnalysis: { positive: 67, negative: 33 },
          topApplyReasons: ['Strong fundamentals', 'Good valuation', 'Growth potential'],
          topAvoidReasons: ['Weak financials', 'Intense competition', 'Regulatory risks'],
          latestReviews: approvedReviews,
        })
      );

      // Second call - cache hit
      mockRedis.get = vi.fn().mockResolvedValueOnce(JSON.stringify(cachedSummary));

      const result = await repository.getReviewSummary(ipoId);

      expect(result).toEqual(cachedSummary);
      expect(mockDb.select).toHaveBeenCalledTimes(1); // Only once
    });
  });

  // ==================== findByIpoId() ====================

  describe('findByIpoId()', () => {
    const ipoId = 'test-ipo-001';
    const approvedReviews = getApprovedReviews();

    it('should filter by isApproved = true', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.findByIpoId(ipoId);

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.isApproved === true)).toBe(true);
    });

    it('should respect limit parameter', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([approvedReviews[0], approvedReviews[1]]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.findByIpoId(ipoId, 2);

      expect(result).toHaveLength(2);
    });

    it('should use cache key with limit', async () => {
      mockRedis.get = vi.fn().mockResolvedValue(null);

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(approvedReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      await repository.findByIpoId(ipoId, 5);

      // Cache key format: reviews:ipo:${ipoId}:${limit}
      expect(mockRedis.get).toHaveBeenCalledWith(`reviews:ipo:${ipoId}:5`);
    });
  });

  // ==================== approveReview() ====================

  describe('approveReview()', () => {
    const reviewId = 'review-004-pending';
    const adminUser = 'admin@ipodhan.com';
    const pendingReview = createMockReview({
      id: reviewId,
      isApproved: false,
      moderatedBy: null,
      moderatedAt: null,
    });

    it('should update fields and return updated review', async () => {
      // Fetch existing review
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([pendingReview]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      // Update review
      const updatedReview = {
        ...pendingReview,
        isApproved: true,
        moderatedBy: adminUser,
        moderatedAt: new Date(),
      };

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedReview]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await repository.approveReview(reviewId, adminUser);

      expect(result.isApproved).toBe(true);
      expect(result.moderatedBy).toBe(adminUser);
      expect(result.moderatedAt).toBeDefined();
    });

    it('should invalidate cache after approval', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([pendingReview]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          { ...pendingReview, isApproved: true },
        ]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      mockRedis.keys = vi.fn().mockResolvedValue([
        `review:list:${pendingReview.ipoId}:10`,
        `review:list:${pendingReview.ipoId}:5`,
      ]);
      mockRedis.del = vi.fn().mockResolvedValue(2);

      await repository.approveReview(reviewId, adminUser);

      expect(mockRedis.keys).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError if review not found', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]), // No review found
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await expect(
        repository.approveReview('non-existent-id', adminUser)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  // ==================== rejectReview() ====================

  describe('rejectReview()', () => {
    const reviewId = 'review-004-pending';
    const adminUser = 'admin@ipodhan.com';
    const pendingReview = createMockReview({
      id: reviewId,
      isApproved: false,
    });

    it('should update fields and return updated review', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([pendingReview]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const updatedReview = {
        ...pendingReview,
        isApproved: false,
        moderatedBy: adminUser,
        moderatedAt: new Date(),
      };

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedReview]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      mockRedis.keys = vi.fn().mockResolvedValue([]);

      const result = await repository.rejectReview(reviewId, adminUser);

      expect(result.isApproved).toBe(false);
      expect(result.moderatedBy).toBe(adminUser);
      expect(result.moderatedAt).toBeDefined();
    });

    it('should invalidate cache after rejection', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([pendingReview]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([
          { ...pendingReview, isApproved: false },
        ]),
      };
      mockDb.update = vi.fn().mockReturnValue(mockUpdate);

      mockRedis.keys = vi.fn().mockResolvedValue([
        `review:summary:${pendingReview.ipoId}`,
      ]);
      mockRedis.del = vi.fn().mockResolvedValue(1);

      await repository.rejectReview(reviewId, adminUser);

      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw EntityNotFoundError if review not found', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await expect(
        repository.rejectReview('non-existent-id', adminUser)
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  // ==================== getPendingReviews() ====================

  describe('getPendingReviews()', () => {
    it('should return only unapproved reviews', async () => {
      const pendingReviews = getPendingReviews();

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(pendingReviews),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      const result = await repository.getPendingReviews();

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.isApproved === false)).toBe(true);
      expect(result[0].id).toBe('review-004-pending');
      expect(result[1].id).toBe('review-005-pending');
    });

    it('should not use cache for admin operations', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);

      await repository.getPendingReviews();
      await repository.getPendingReviews();

      // Should query database both times (no caching)
      expect(mockDb.select).toHaveBeenCalledTimes(2);
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });

  // ==================== extractReasonsFromContent() ====================

  describe('extractReasonsFromContent()', () => {
    it('should match Apply keywords correctly', async () => {
      const content = `
        The company has strong fundamentals and good valuation.
        There is significant growth potential with experienced management.
      `;

      // Call getReviewSummary to trigger extraction (private method)
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          createMockReview({
            recommendation: 'May apply',
            reviewContent: content,
          }),
        ]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary('test-ipo');

      expect(result?.topApplyReasons).toContain('Strong fundamentals');
      expect(result?.topApplyReasons).toContain('Good valuation');
      expect(result?.topApplyReasons).toContain('Growth potential');
    });

    it('should match Avoid keywords correctly', async () => {
      const content = `
        The valuation is high and expensive. The company has weak financials
        with intense competition and regulatory risks.
      `;

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          createMockReview({
            recommendation: 'Avoid',
            reviewContent: content,
          }),
        ]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary('test-ipo');

      // Check that avoid reasons are extracted
      expect(result?.topAvoidReasons.length).toBeGreaterThan(0);
      // At least one of these should be present
      const hasValidReasons = result?.topAvoidReasons.some((reason) =>
        ['High valuation', 'Weak financials', 'Intense competition', 'Regulatory risks'].includes(reason)
      );
      expect(hasValidReasons).toBe(true);
    });
  });

  // ==================== getMostFrequentReasons() ====================

  describe('getMostFrequentReasons()', () => {
    it('should return top N reasons by frequency', async () => {
      // Create 5 reviews with repeated reasons
      const reviewsWithReasons = [
        createMockReview({
          recommendation: 'May apply',
          reviewContent: 'Strong fundamentals and good valuation',
        }),
        createMockReview({
          recommendation: 'May apply',
          reviewContent: 'Strong fundamentals again',
        }),
        createMockReview({
          recommendation: 'May apply',
          reviewContent: 'Strong fundamentals once more',
        }),
        createMockReview({
          recommendation: 'Subscribe',
          reviewContent: 'Good valuation',
        }),
        createMockReview({
          recommendation: 'Subscribe',
          reviewContent: 'Growth potential',
        }),
      ];

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue(reviewsWithReasons),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary('test-ipo');

      // "Strong fundamentals" appears 3 times, should be first
      expect(result?.topApplyReasons[0]).toBe('Strong fundamentals');
    });

    it('should return empty array when no reasons found', async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          createMockReview({
            recommendation: 'Subscribe',
            reviewContent: 'Generic content without keywords',
          }),
        ]),
      };
      mockDb.select = vi.fn().mockReturnValue(mockSelect);
      mockRedis.get = vi.fn().mockResolvedValue(null);
      mockRedis.setex = vi.fn().mockResolvedValue('OK');

      const result = await repository.getReviewSummary('test-ipo');

      // Should return empty arrays when no keywords match
      expect(result?.topApplyReasons).toEqual([]);
      expect(result?.topAvoidReasons).toEqual([]);
    });
  });
});
