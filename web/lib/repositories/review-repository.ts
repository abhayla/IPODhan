/**
 * Review Repository
 *
 * Story 11.16: IPO Recommendations Summary Section
 * Handles review data access with caching and aggregation logic.
 */

import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import * as schema from '@ipodhan/shared/db/schema';
import { ipoReviews } from '@ipodhan/shared/db/schema';
import {
  CacheTTL,
  getReviewSummaryKey,
  getReviewListKey,
  getReviewInvalidationKeys,
} from '../cache/cache-keys';
import { DatabaseError, EntityNotFoundError } from '../errors/repository-errors';

// Type definitions
export type IPOReview = InferSelectModel<typeof schema.ipoReviews>;
export type IPOReviewInsert = InferInsertModel<typeof schema.ipoReviews>;

/**
 * Review summary with aggregated statistics
 */
export interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  recommendationBreakdown: {
    apply: number;
    subscribe: number;
    avoid: number;
    notRecommended: number;
  };
  sentimentAnalysis: {
    positive: number;
    negative: number;
  };
  topApplyReasons: string[];
  topAvoidReasons: string[];
  latestReviews: IPOReview[];
}

export interface IReviewRepository {
  getReviewSummary(ipoId: string): Promise<ReviewSummary | null>;
  findByIpoId(ipoId: string, limit?: number): Promise<IPOReview[]>;
  approveReview(reviewId: string, adminUser: string): Promise<IPOReview>;
  rejectReview(reviewId: string, adminUser: string): Promise<IPOReview>;
  getPendingReviews(): Promise<IPOReview[]>;
}

export class ReviewRepository
  extends BaseRepository
  implements IReviewRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Get aggregated review summary for an IPO
   * Includes average rating, recommendation breakdown, sentiment analysis, and top reasons
   */
  async getReviewSummary(ipoId: string): Promise<ReviewSummary | null> {
    const cacheKey = getReviewSummaryKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          // Fetch all approved reviews for this IPO
          const reviews = await this.db
            .select()
            .from(ipoReviews)
            .where(
              and(
                eq(ipoReviews.ipoId, ipoId),
                eq(ipoReviews.isApproved, true)
              )
            )
            .orderBy(desc(ipoReviews.publishedDate));

          if (reviews.length === 0) {
            return null;
          }

          // Calculate average rating
          const ratingMap = {
            'May apply': 5,
            Subscribe: 4,
            Avoid: 2,
            'Not Recommended': 1,
          };

          const totalRating = reviews.reduce(
            (sum, review) => sum + ratingMap[review.recommendation],
            0
          );
          const averageRating = totalRating / reviews.length;

          // Calculate recommendation breakdown
          const recommendationBreakdown = {
            apply: reviews.filter((r) => r.recommendation === 'May apply').length,
            subscribe: reviews.filter((r) => r.recommendation === 'Subscribe').length,
            avoid: reviews.filter((r) => r.recommendation === 'Avoid').length,
            notRecommended: reviews.filter(
              (r) => r.recommendation === 'Not Recommended'
            ).length,
          };

          // Calculate sentiment analysis
          const positiveCount =
            recommendationBreakdown.apply + recommendationBreakdown.subscribe;
          const negativeCount =
            recommendationBreakdown.avoid + recommendationBreakdown.notRecommended;
          const sentimentAnalysis = {
            positive: Math.round((positiveCount / reviews.length) * 100),
            negative: Math.round((negativeCount / reviews.length) * 100),
          };

          // Extract reasons from review content
          const applyReasons: string[] = [];
          const avoidReasons: string[] = [];

          reviews.forEach((review) => {
            if (!review.reviewContent) return;

            const isPositive =
              review.recommendation === 'May apply' ||
              review.recommendation === 'Subscribe';
            const isNegative =
              review.recommendation === 'Avoid' ||
              review.recommendation === 'Not Recommended';

            if (isPositive) {
              const reasons = this.extractReasonsFromContent(
                review.reviewContent,
                'apply'
              );
              applyReasons.push(...reasons);
            }

            if (isNegative) {
              const reasons = this.extractReasonsFromContent(
                review.reviewContent,
                'avoid'
              );
              avoidReasons.push(...reasons);
            }
          });

          // Get top 3 reasons by frequency
          const topApplyReasons = this.getMostFrequentReasons(applyReasons, 3);
          const topAvoidReasons = this.getMostFrequentReasons(avoidReasons, 3);

          // Get latest 3 reviews
          const latestReviews = reviews.slice(0, 3);

          return {
            averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
            totalReviews: reviews.length,
            recommendationBreakdown,
            sentimentAnalysis,
            topApplyReasons,
            topAvoidReasons,
            latestReviews,
          };
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch review summary for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.REVIEW_SUMMARY
    );
  }

  /**
   * Find approved reviews for an IPO
   */
  async findByIpoId(ipoId: string, limit = 10): Promise<IPOReview[]> {
    const cacheKey = getReviewListKey(ipoId, limit);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const reviews = await this.db
            .select()
            .from(ipoReviews)
            .where(
              and(
                eq(ipoReviews.ipoId, ipoId),
                eq(ipoReviews.isApproved, true)
              )
            )
            .orderBy(desc(ipoReviews.publishedDate))
            .limit(limit);

          return reviews;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch reviews for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.REVIEW_SUMMARY
    );
  }

  /**
   * Approve a review (admin operation)
   * Sets isApproved = true, records moderator and timestamp
   */
  async approveReview(reviewId: string, adminUser: string): Promise<IPOReview> {
    try {
      // Fetch the review to check if it exists
      const [existingReview] = await this.db
        .select()
        .from(ipoReviews)
        .where(eq(ipoReviews.id, reviewId))
        .limit(1);

      if (!existingReview) {
        throw new EntityNotFoundError('IPOReview', reviewId);
      }

      // Update review to approved
      const [updatedReview] = await this.db
        .update(ipoReviews)
        .set({
          isApproved: true,
          moderatedBy: adminUser,
          moderatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ipoReviews.id, reviewId))
        .returning();

      // Invalidate cache
      const invalidationKeys = getReviewInvalidationKeys(existingReview.ipoId);
      for (const pattern of invalidationKeys) {
        if (pattern.includes('*')) {
          await this.deleteCachePattern(pattern);
        } else {
          await this.deleteCache(pattern);
        }
      }

      return updatedReview;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to approve review: ${reviewId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Reject a review (admin operation)
   * Sets isApproved = false, records moderator and timestamp
   */
  async rejectReview(reviewId: string, adminUser: string): Promise<IPOReview> {
    try {
      // Fetch the review to check if it exists
      const [existingReview] = await this.db
        .select()
        .from(ipoReviews)
        .where(eq(ipoReviews.id, reviewId))
        .limit(1);

      if (!existingReview) {
        throw new EntityNotFoundError('IPOReview', reviewId);
      }

      // Update review to rejected
      const [updatedReview] = await this.db
        .update(ipoReviews)
        .set({
          isApproved: false,
          moderatedBy: adminUser,
          moderatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ipoReviews.id, reviewId))
        .returning();

      // Invalidate cache
      const invalidationKeys = getReviewInvalidationKeys(existingReview.ipoId);
      for (const pattern of invalidationKeys) {
        if (pattern.includes('*')) {
          await this.deleteCachePattern(pattern);
        } else {
          await this.deleteCache(pattern);
        }
      }

      return updatedReview;
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      throw new DatabaseError(
        `Failed to reject review: ${reviewId}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get all pending reviews (not yet approved/rejected)
   * No caching for admin operations
   */
  async getPendingReviews(): Promise<IPOReview[]> {
    try {
      const reviews = await this.db
        .select()
        .from(ipoReviews)
        .where(eq(ipoReviews.isApproved, false))
        .orderBy(desc(ipoReviews.publishedDate));

      return reviews;
    } catch (error) {
      throw new DatabaseError(
        'Failed to fetch pending reviews',
        undefined,
        error
      );
    }
  }

  /**
   * Extract reasons from review content based on keyword matching
   * @param content - The review content text
   * @param type - 'apply' for positive reasons or 'avoid' for negative reasons
   * @returns Array of matched reasons
   */
  private extractReasonsFromContent(
    content: string,
    type: 'apply' | 'avoid'
  ): string[] {
    if (!content) return [];

    const contentLower = content.toLowerCase();
    const reasons: string[] = [];

    if (type === 'apply') {
      const applyKeywords = {
        'Strong fundamentals': [
          'strong fundamental',
          'solid fundamental',
          'good fundamental',
          'healthy fundamental',
        ],
        'Good valuation': [
          'reasonable valuation',
          'fair valuation',
          'attractive valuation',
          'good valuation',
          'undervalued',
        ],
        'Growth potential': [
          'growth potential',
          'growth prospect',
          'high growth',
          'growing market',
          'expansion plan',
        ],
        'Experienced management': [
          'experienced management',
          'strong management',
          'proven management',
          'capable management',
          'good track record',
        ],
        'Healthy financials': [
          'healthy financial',
          'strong financial',
          'good financial',
          'profitable',
          'positive cash flow',
        ],
        'Market leader': [
          'market leader',
          'industry leader',
          'market position',
          'strong brand',
          'competitive advantage',
        ],
      };

      for (const [reason, keywords] of Object.entries(applyKeywords)) {
        if (keywords.some((keyword) => contentLower.includes(keyword))) {
          reasons.push(reason);
        }
      }
    } else if (type === 'avoid') {
      const avoidKeywords = {
        'High valuation': [
          'high valuation',
          'expensive valuation',
          'overvalued',
          'premium valuation',
          'rich valuation',
        ],
        'Weak financials': [
          'weak financial',
          'poor financial',
          'losses',
          'negative profit',
          'debt burden',
        ],
        'Intense competition': [
          'intense competition',
          'competitive pressure',
          'crowded market',
          'price war',
        ],
        'Unclear business model': [
          'unclear business',
          'unproven model',
          'business uncertainty',
          'revenue model unclear',
        ],
        'Regulatory risks': [
          'regulatory risk',
          'compliance issue',
          'legal challenge',
          'government policy',
        ],
        'Poor track record': [
          'poor track record',
          'lack of experience',
          'management concern',
          'governance issue',
        ],
      };

      for (const [reason, keywords] of Object.entries(avoidKeywords)) {
        if (keywords.some((keyword) => contentLower.includes(keyword))) {
          reasons.push(reason);
        }
      }
    }

    return reasons;
  }

  /**
   * Get most frequent reasons from array
   * @param reasons - Array of reason strings
   * @param limit - Number of top reasons to return
   * @returns Top N most frequent reasons
   */
  private getMostFrequentReasons(reasons: string[], limit: number): string[] {
    if (reasons.length === 0) return [];

    // Count frequency
    const frequencyMap = new Map<string, number>();
    reasons.forEach((reason) => {
      frequencyMap.set(reason, (frequencyMap.get(reason) || 0) + 1);
    });

    // Sort by frequency descending
    const sortedReasons = Array.from(frequencyMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason]) => reason);

    // Return top N
    return sortedReasons.slice(0, limit);
  }
}
