# Story 11.16: IPO Recommendations Summary Section

## Status
Draft

## Story

**As a** retail investor researching IPO opportunities,
**I want** to see a comprehensive broker recommendations summary section with aggregated ratings, sentiment analysis, top reasons to Apply/Avoid, and expert opinions,
**so that** I can quickly understand market sentiment and expert consensus on the IPO without having to read through individual reviews, enabling faster and more informed investment decisions.

## Acceptance Criteria

1. Recommendation aggregation displays Apply/Avoid/Subscribe percentages with visual breakdown
2. Average rating shown with star visualization (★★★★☆ format) and numeric value (e.g., 4.2/5)
3. Review count displayed prominently (e.g., "Based on 47 broker reviews")
4. Sentiment analysis shows positive/negative percentage split with visual indicator
5. Top 3 Apply reasons extracted and displayed as bulleted list
6. Top 3 Avoid reasons extracted and displayed as bulleted list
7. Latest 3 sample reviews shown with reviewer name, date, and recommendation
8. "View All Reviews" link navigates to appropriate reviews page (/mainboard-ipo-reviews or /sme-ipo-reviews)
9. Admin can approve/reject reviews via moderation panel at /admin/reviews
10. Only approved reviews appear in public-facing summary (isApproved=true filter)
11. Section uses card-style layout matching other sections on IPO detail page
12. Section appears after Company Overview section on IPO detail page
13. Cache invalidation works on review moderation (cache key invalidated when admin approves/rejects)
14. Unit tests: >85% coverage for ReviewRepository and RecommendationSummarySection
15. Integration tests: API and repository tests passing with real database
16. Performance: <50ms cache hit, <200ms database aggregation query

## Tasks / Subtasks

### Phase 0: Prerequisites Verification and Schema Migration

- [ ] Verify database schema supports review moderation (AC: 9, 10)
  - [ ] Read `packages/shared/src/db/schema.ts` and check `ipoReviews` table
  - [ ] Verify table has columns: `id`, `ipoId`, `author`, `recommendation`, `reviewTitle`, `reviewContent`, `reviewUrl`, `publishedDate`, `segment`, `year`
  - [ ] Check if moderation fields exist: `isApproved`, `moderatedBy`, `moderatedAt`
  - [ ] **If moderation fields missing**: Create database migration to add fields

- [ ] Create database migration for moderation fields (if needed) (AC: 9, 10)
  - [ ] Create migration file: `web/drizzle/migrations/XXXX_add_review_moderation_fields.sql`
  - [ ] Add columns to `ipo_reviews` table:
    ```sql
    ALTER TABLE ipo_reviews
    ADD COLUMN is_approved BOOLEAN DEFAULT false NOT NULL,
    ADD COLUMN moderated_by VARCHAR(255),
    ADD COLUMN moderated_at TIMESTAMP;

    -- Add index for approved reviews query performance
    CREATE INDEX idx_ipo_reviews_approved ON ipo_reviews(is_approved, ipo_id);
    ```
  - [ ] Update schema in `packages/shared/src/db/schema.ts`:
    ```typescript
    export const ipoReviews = pgTable('ipo_reviews', {
      // ... existing fields
      isApproved: boolean('is_approved').default(false).notNull(),
      moderatedBy: varchar('moderated_by', { length: 255 }),
      moderatedAt: timestamp('moderated_at'),
    }, (table) => ({
      // ... existing indexes
      approvedIdx: index('idx_ipo_reviews_approved').on(table.isApproved, table.ipoId),
    }));
    ```
  - [ ] Run migration: `npm run db:migrate`
  - [ ] Verify migration applied successfully in database

- [ ] Verify API client and types exist (AC: 1-7)
  - [ ] Check `web/lib/db/types.ts` for `IPOReview` type
  - [ ] Verify type includes all required fields:
    ```typescript
    export type IPOReview = InferSelectModel<typeof schema.ipoReviews>;
    export type NewIPOReview = InferInsertModel<typeof schema.ipoReviews>;
    ```
  - [ ] Check if `reviewRecommendationEnum` exists in schema
  - [ ] Verify enum values: 'May apply', 'Subscribe', 'Avoid', 'Not Recommended'

### Phase 1: Repository Layer - Review Data Access (AC: 1-7, 10, 13, 16)

- [ ] Create ReviewRepository extending BaseRepository (AC: 1, 16)
  - [ ] Create new file: `web/lib/repositories/review-repository.ts`
  - [ ] Import required dependencies:
    ```typescript
    import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
    import type Redis from 'ioredis';
    import * as schema from '@ipodhan/shared/db/schema';
    import { BaseRepository } from './base-repository';
    import { eq, and, desc, sql } from 'drizzle-orm';
    import { IPOReview, NewIPOReview } from '@/lib/db/types';
    import {
      getReviewSummaryKey,
      getReviewInvalidationKeys,
      CacheTTL
    } from '@/lib/cache/cache-keys';
    ```
  - [ ] Repository constructor with correct type signature:
    ```typescript
    export class ReviewRepository extends BaseRepository {
      constructor(
        protected db: NodePgDatabase<typeof schema>,
        protected redis: Redis
      ) {
        super(db, redis);
      }
    }
    ```

- [ ] Implement `getReviewSummary` method (AC: 1-7, 10, 16)
  - [ ] Method signature:
    ```typescript
    export interface ReviewSummary {
      averageRating: number;             // 0-5 scale (e.g., 4.2)
      totalReviews: number;              // Total approved reviews
      recommendationBreakdown: {
        apply: number;                   // Percentage (e.g., 65.5)
        subscribe: number;               // Percentage
        avoid: number;                   // Percentage
        notRecommended: number;          // Percentage
      };
      sentimentAnalysis: {
        positive: number;                // Percentage (Apply + Subscribe)
        negative: number;                // Percentage (Avoid + Not Recommended)
      };
      topApplyReasons: string[];         // Top 3 reasons
      topAvoidReasons: string[];         // Top 3 reasons
      latestReviews: IPOReview[];        // Latest 3 approved reviews
    }

    async getReviewSummary(ipoId: string): Promise<ReviewSummary | null>
    ```
  - [ ] Implement cache-aside pattern:
    ```typescript
    const cacheKey = getReviewSummaryKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        // Database query here
      },
      CacheTTL.REVIEW_SUMMARY  // 15 minutes
    );
    ```
  - [ ] Fetch all approved reviews for IPO:
    ```typescript
    const reviews = await this.db.query.ipoReviews.findMany({
      where: and(
        eq(schema.ipoReviews.ipoId, ipoId),
        eq(schema.ipoReviews.isApproved, true)  // Only approved reviews (AC: 10)
      ),
      orderBy: [desc(schema.ipoReviews.publishedDate)]
    });

    if (reviews.length === 0) {
      return null;  // No approved reviews yet
    }
    ```
  - [ ] Calculate recommendation breakdown:
    ```typescript
    const recommendationCounts = {
      apply: reviews.filter(r => r.recommendation === 'May apply').length,
      subscribe: reviews.filter(r => r.recommendation === 'Subscribe').length,
      avoid: reviews.filter(r => r.recommendation === 'Avoid').length,
      notRecommended: reviews.filter(r => r.recommendation === 'Not Recommended').length,
    };

    const totalReviews = reviews.length;
    const recommendationBreakdown = {
      apply: (recommendationCounts.apply / totalReviews) * 100,
      subscribe: (recommendationCounts.subscribe / totalReviews) * 100,
      avoid: (recommendationCounts.avoid / totalReviews) * 100,
      notRecommended: (recommendationCounts.notRecommended / totalReviews) * 100,
    };
    ```
  - [ ] Calculate average rating (convert recommendations to numeric):
    ```typescript
    // Rating scale: May apply = 5, Subscribe = 4, Avoid = 2, Not Recommended = 1
    const ratingMap = {
      'May apply': 5,
      'Subscribe': 4,
      'Avoid': 2,
      'Not Recommended': 1,
    };

    const totalRating = reviews.reduce((sum, review) => {
      return sum + (ratingMap[review.recommendation] || 0);
    }, 0);

    const averageRating = totalRating / totalReviews;
    ```
  - [ ] Calculate sentiment analysis:
    ```typescript
    const sentimentAnalysis = {
      positive: recommendationBreakdown.apply + recommendationBreakdown.subscribe,
      negative: recommendationBreakdown.avoid + recommendationBreakdown.notRecommended,
    };
    ```
  - [ ] Extract top Apply reasons (AC: 5):
    ```typescript
    // Extract reasons from reviewContent using keyword matching
    const applyReasons = reviews
      .filter(r => r.recommendation === 'May apply' || r.recommendation === 'Subscribe')
      .map(r => extractReasonsFromContent(r.reviewContent, 'apply'))
      .flat();

    const topApplyReasons = getMostFrequentReasons(applyReasons, 3);
    ```
  - [ ] Extract top Avoid reasons (AC: 6):
    ```typescript
    const avoidReasons = reviews
      .filter(r => r.recommendation === 'Avoid' || r.recommendation === 'Not Recommended')
      .map(r => extractReasonsFromContent(r.reviewContent, 'avoid'))
      .flat();

    const topAvoidReasons = getMostFrequentReasons(avoidReasons, 3);
    ```
  - [ ] Get latest 3 reviews (AC: 7):
    ```typescript
    const latestReviews = reviews.slice(0, 3);
    ```
  - [ ] Return summary object:
    ```typescript
    return {
      averageRating,
      totalReviews,
      recommendationBreakdown,
      sentimentAnalysis,
      topApplyReasons,
      topAvoidReasons,
      latestReviews,
    };
    ```

- [ ] Implement helper functions for reason extraction
  - [ ] `extractReasonsFromContent(content: string, type: 'apply' | 'avoid'): string[]`
    - [ ] Use keyword matching for common phrases:
      - Apply keywords: "strong fundamentals", "good valuation", "growth potential", "experienced management", "healthy financials"
      - Avoid keywords: "high valuation", "weak financials", "intense competition", "unclear business model", "regulatory risks"
    - [ ] Return array of matched reasons from content
    - [ ] Handle null/empty content gracefully
  - [ ] `getMostFrequentReasons(reasons: string[], limit: number): string[]`
    - [ ] Count frequency of each reason
    - [ ] Sort by frequency descending
    - [ ] Return top N reasons
    - [ ] Limit to `limit` parameter (3 for top 3)

- [ ] Implement `findByIpoId` method (AC: 7)
  - [ ] Method signature:
    ```typescript
    async findByIpoId(ipoId: string, limit?: number): Promise<IPOReview[]>
    ```
  - [ ] Query approved reviews only:
    ```typescript
    const cacheKey = limit ? `reviews:ipo:${ipoId}:${limit}` : `reviews:ipo:${ipoId}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        return await this.db.query.ipoReviews.findMany({
          where: and(
            eq(schema.ipoReviews.ipoId, ipoId),
            eq(schema.ipoReviews.isApproved, true)
          ),
          orderBy: [desc(schema.ipoReviews.publishedDate)],
          limit: limit || undefined
        });
      },
      CacheTTL.REVIEW_SUMMARY
    );
    ```

- [ ] Implement admin moderation methods (AC: 9, 13)
  - [ ] `approveReview` method:
    ```typescript
    async approveReview(reviewId: string, adminUser: string): Promise<IPOReview> {
      const review = await this.db.query.ipoReviews.findFirst({
        where: eq(schema.ipoReviews.id, reviewId)
      });

      if (!review) {
        throw new EntityNotFoundError('Review not found', 'IPOReview', { reviewId });
      }

      // Update review approval status
      const [updated] = await this.db
        .update(schema.ipoReviews)
        .set({
          isApproved: true,
          moderatedBy: adminUser,
          moderatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.ipoReviews.id, reviewId))
        .returning();

      // Invalidate cache (AC: 13)
      await this.invalidateCache(
        getReviewInvalidationKeys(review.ipoId)
      );

      return updated;
    }
    ```
  - [ ] `rejectReview` method:
    ```typescript
    async rejectReview(reviewId: string, adminUser: string): Promise<IPOReview> {
      const review = await this.db.query.ipoReviews.findFirst({
        where: eq(schema.ipoReviews.id, reviewId)
      });

      if (!review) {
        throw new EntityNotFoundError('Review not found', 'IPOReview', { reviewId });
      }

      const [updated] = await this.db
        .update(schema.ipoReviews)
        .set({
          isApproved: false,
          moderatedBy: adminUser,
          moderatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.ipoReviews.id, reviewId))
        .returning();

      // Invalidate cache (AC: 13)
      await this.invalidateCache(
        getReviewInvalidationKeys(review.ipoId)
      );

      return updated;
    }
    ```
  - [ ] `getPendingReviews` method for admin panel:
    ```typescript
    async getPendingReviews(): Promise<IPOReview[]> {
      return await this.db.query.ipoReviews.findMany({
        where: eq(schema.ipoReviews.isApproved, false),
        orderBy: [desc(schema.ipoReviews.publishedDate)],
      });
    }
    ```

### Phase 2: Cache Key Configuration (AC: 13, 16)

- [ ] Add review cache keys to `web/lib/cache/cache-keys.ts` (AC: 13)
  - [ ] Add cache key generator:
    ```typescript
    // Review summary cache key
    export const getReviewSummaryKey = (ipoId: string): string =>
      `review:summary:${ipoId}`;

    // Review list cache key
    export const getReviewListKey = (ipoId: string, limit?: number): string =>
      limit ? `reviews:ipo:${ipoId}:${limit}` : `reviews:ipo:${ipoId}`;
    ```
  - [ ] Add review invalidation keys:
    ```typescript
    // Review invalidation pattern
    export const getReviewInvalidationKeys = (ipoId: string): string[] => [
      getReviewSummaryKey(ipoId),
      `reviews:ipo:${ipoId}*`,  // All review lists for this IPO
      `ipo:slug:*`,              // IPO detail pages (includes reviews)
    ];
    ```
  - [ ] Add TTL constant:
    ```typescript
    export const CacheTTL = {
      // ... existing TTLs
      REVIEW_SUMMARY: 900,  // 15 minutes (AC: 16)
    };
    ```

### Phase 3: API Route Extension (AC: 1-8, 12)

- [ ] Extend `/api/ipos/[slug]` endpoint to include review summary (AC: 12)
  - [ ] Open file: `web/app/api/ipos/[slug]/route.ts`
  - [ ] Import ReviewRepository:
    ```typescript
    import { ReviewRepository } from '@/lib/repositories/review-repository';
    ```
  - [ ] Fetch review summary in GET handler:
    ```typescript
    export async function GET(
      request: NextRequest,
      { params }: { params: { slug: string } }
    ) {
      try {
        const db = await getDb();
        const redis = getRedisClient();

        const ipoRepository = new IPORepository(db, redis);
        const reviewRepository = new ReviewRepository(db, redis);

        // Fetch IPO data
        const ipo = await ipoRepository.findBySlug(params.slug);
        if (!ipo) {
          return NextResponse.json(
            { error: 'IPO not found' },
            { status: 404 }
          );
        }

        // Fetch review summary (AC: 1-7)
        const reviewSummary = await reviewRepository.getReviewSummary(ipo.id);

        // Return combined data
        return NextResponse.json({
          success: true,
          data: {
            ...ipo,
            reviewSummary  // Add review summary to response
          }
        });
      } catch (error) {
        console.error('[API Error] /api/ipos/[slug]:', error);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    }
    ```

- [ ] Create admin review moderation API routes (AC: 9, 13)
  - [ ] Create directory: `web/app/api/admin/reviews/`
  - [ ] Create file: `web/app/api/admin/reviews/route.ts`
  - [ ] Implement GET endpoint (list pending reviews):
    ```typescript
    export async function GET(request: NextRequest) {
      try {
        // Check admin authentication
        const session = await getAdminSession(request);
        if (!session) {
          return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401 }
          );
        }

        const db = await getDb();
        const redis = getRedisClient();
        const reviewRepository = new ReviewRepository(db, redis);

        const pendingReviews = await reviewRepository.getPendingReviews();

        return NextResponse.json({
          success: true,
          data: pendingReviews
        });
      } catch (error) {
        console.error('[API Error] GET /api/admin/reviews:', error);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    }
    ```
  - [ ] Create file: `web/app/api/admin/reviews/[reviewId]/route.ts`
  - [ ] Implement PATCH endpoint (approve/reject review):
    ```typescript
    export async function PATCH(
      request: NextRequest,
      { params }: { params: { reviewId: string } }
    ) {
      try {
        // Check admin authentication
        const session = await getAdminSession(request);
        if (!session) {
          return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401 }
          );
        }

        const { action } = await request.json();
        if (!action || !['approve', 'reject'].includes(action)) {
          return NextResponse.json(
            { error: 'Invalid action. Must be "approve" or "reject"' },
            { status: 400 }
          );
        }

        const db = await getDb();
        const redis = getRedisClient();
        const reviewRepository = new ReviewRepository(db, redis);

        const updatedReview = action === 'approve'
          ? await reviewRepository.approveReview(params.reviewId, session.user.email)
          : await reviewRepository.rejectReview(params.reviewId, session.user.email);

        return NextResponse.json({
          success: true,
          data: updatedReview
        });
      } catch (error) {
        if (error instanceof EntityNotFoundError) {
          return NextResponse.json(
            { error: 'Review not found' },
            { status: 404 }
          );
        }

        console.error('[API Error] PATCH /api/admin/reviews/[reviewId]:', error);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }
    }
    ```

### Phase 4: UI Component - RecommendationSummarySection (AC: 1-8, 11)

- [ ] Create RecommendationSummarySection component (AC: 1-8, 11)
  - [ ] Create file: `web/components/ipo-detail/RecommendationSummarySection.tsx`
  - [ ] Mark as server component (no 'use client')
  - [ ] Import dependencies:
    ```typescript
    import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import Link from 'next/link';
    import { Star, TrendingUp, TrendingDown } from 'lucide-react';
    import type { ReviewSummary } from '@/lib/repositories/review-repository';
    ```
  - [ ] Component interface:
    ```typescript
    interface RecommendationSummarySectionProps {
      reviewSummary: ReviewSummary | null;
      ipoSegment: 'MAINBOARD' | 'SME';
    }

    export function RecommendationSummarySection({
      reviewSummary,
      ipoSegment
    }: RecommendationSummarySectionProps)
    ```

- [ ] Implement header with average rating and review count (AC: 2, 3)
  - [ ] Card header:
    ```typescript
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Broker Recommendations</span>
          {reviewSummary && (
            <div className="flex items-center gap-2">
              {/* Star rating (AC: 2) */}
              <div className="flex items-center gap-1">
                {renderStarRating(reviewSummary.averageRating)}
                <span className="text-sm text-gray-600 ml-1">
                  {reviewSummary.averageRating.toFixed(1)}/5
                </span>
              </div>
              {/* Review count (AC: 3) */}
              <span className="text-sm text-gray-600">
                Based on {reviewSummary.totalReviews} broker reviews
              </span>
            </div>
          )}
        </CardTitle>
      </CardHeader>
    ```
  - [ ] Star rating helper function:
    ```typescript
    function renderStarRating(rating: number) {
      const fullStars = Math.floor(rating);
      const hasHalfStar = rating % 1 >= 0.5;
      const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

      return (
        <>
          {Array.from({ length: fullStars }).map((_, i) => (
            <Star key={`full-${i}`} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
          ))}
          {hasHalfStar && (
            <Star className="w-4 h-4 fill-yellow-400 text-yellow-400 opacity-50" />
          )}
          {Array.from({ length: emptyStars }).map((_, i) => (
            <Star key={`empty-${i}`} className="w-4 h-4 text-gray-300" />
          ))}
        </>
      );
    }
    ```

- [ ] Implement recommendation breakdown (AC: 1)
  - [ ] Recommendation percentages with visual bars:
    ```typescript
    <CardContent>
      {/* Recommendation Breakdown (AC: 1) */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold mb-3">Recommendation Breakdown</h3>
        <div className="space-y-2">
          <RecommendationBar
            label="May Apply"
            percentage={reviewSummary.recommendationBreakdown.apply}
            color="green"
          />
          <RecommendationBar
            label="Subscribe"
            percentage={reviewSummary.recommendationBreakdown.subscribe}
            color="blue"
          />
          <RecommendationBar
            label="Avoid"
            percentage={reviewSummary.recommendationBreakdown.avoid}
            color="red"
          />
          <RecommendationBar
            label="Not Recommended"
            percentage={reviewSummary.recommendationBreakdown.notRecommended}
            color="gray"
          />
        </div>
      </div>
    ```
  - [ ] RecommendationBar component:
    ```typescript
    function RecommendationBar({
      label,
      percentage,
      color
    }: {
      label: string;
      percentage: number;
      color: 'green' | 'blue' | 'red' | 'gray';
    }) {
      const colorClasses = {
        green: 'bg-green-500',
        blue: 'bg-blue-500',
        red: 'bg-red-500',
        gray: 'bg-gray-400',
      };

      return (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium w-32">{label}</span>
          <div className="flex-1 h-6 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full ${colorClasses[color]} transition-all`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-sm text-gray-600 w-12 text-right">
            {percentage.toFixed(1)}%
          </span>
        </div>
      );
    }
    ```

- [ ] Implement sentiment analysis (AC: 4)
  - [ ] Sentiment display:
    ```typescript
    {/* Sentiment Analysis (AC: 4) */}
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-3">Sentiment Analysis</h3>
      <div className="flex gap-4">
        <div className="flex-1 p-4 bg-green-50 rounded-lg border border-green-200">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-700">Positive</span>
          </div>
          <span className="text-2xl font-bold text-green-600">
            {reviewSummary.sentimentAnalysis.positive.toFixed(1)}%
          </span>
        </div>
        <div className="flex-1 p-4 bg-red-50 rounded-lg border border-red-200">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-5 h-5 text-red-600" />
            <span className="text-sm font-medium text-red-700">Negative</span>
          </div>
          <span className="text-2xl font-bold text-red-600">
            {reviewSummary.sentimentAnalysis.negative.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
    ```

- [ ] Implement top Apply/Avoid reasons (AC: 5, 6)
  - [ ] Reasons display:
    ```typescript
    {/* Top Reasons (AC: 5, 6) */}
    <div className="grid md:grid-cols-2 gap-6 mb-6">
      {/* Top Apply Reasons (AC: 5) */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-green-600" />
          Top 3 Reasons to Apply
        </h3>
        <ul className="space-y-2">
          {reviewSummary.topApplyReasons.map((reason, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="text-green-600 font-bold">{index + 1}.</span>
              <span className="text-sm text-gray-700">{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Top Avoid Reasons (AC: 6) */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-red-600" />
          Top 3 Reasons to Avoid
        </h3>
        <ul className="space-y-2">
          {reviewSummary.topAvoidReasons.map((reason, index) => (
            <li key={index} className="flex items-start gap-2">
              <span className="text-red-600 font-bold">{index + 1}.</span>
              <span className="text-sm text-gray-700">{reason}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
    ```

- [ ] Implement latest reviews section (AC: 7, 8)
  - [ ] Latest reviews display:
    ```typescript
    {/* Latest Reviews (AC: 7) */}
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-3">Latest Expert Opinions</h3>
      <div className="space-y-4">
        {reviewSummary.latestReviews.map((review) => (
          <div
            key={review.id}
            className="p-4 bg-gray-50 rounded-lg border"
          >
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-medium text-sm">{review.author}</span>
                <span className="text-xs text-gray-500 ml-2">
                  {new Date(review.publishedDate).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })}
                </span>
              </div>
              <Badge variant={getRecommendationVariant(review.recommendation)}>
                {review.recommendation}
              </Badge>
            </div>
            <p className="text-sm text-gray-700 line-clamp-2">
              {review.reviewTitle}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* View All Reviews Link (AC: 8) */}
    <div className="text-center">
      <Link
        href={ipoSegment === 'MAINBOARD'
          ? '/mainboard-ipo-reviews'
          : '/sme-ipo-reviews'}
      >
        <Button variant="outline" className="w-full md:w-auto">
          View All Reviews
        </Button>
      </Link>
    </div>
    ```
  - [ ] Badge variant helper:
    ```typescript
    function getRecommendationVariant(recommendation: string) {
      switch (recommendation) {
        case 'May apply':
          return 'success';
        case 'Subscribe':
          return 'default';
        case 'Avoid':
        case 'Not Recommended':
          return 'destructive';
        default:
          return 'secondary';
      }
    }
    ```

- [ ] Handle empty state (no reviews yet)
  - [ ] Empty state display:
    ```typescript
    {!reviewSummary && (
      <CardContent>
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No broker reviews available yet.</p>
          <p className="text-xs mt-2">
            Expert opinions will appear here once brokers publish their analysis.
          </p>
        </div>
      </CardContent>
    )}
    ```

### Phase 5: Admin Moderation UI (AC: 9)

- [ ] Create admin review moderation page (AC: 9)
  - [ ] Create file: `web/app/admin/reviews/page.tsx`
  - [ ] Mark as client component ('use client')
  - [ ] Import dependencies:
    ```typescript
    'use client';

    import { useState, useEffect } from 'react';
    import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
    import { Button } from '@/components/ui/button';
    import { Badge } from '@/components/ui/badge';
    import { Check, X } from 'lucide-react';
    import { apiClient } from '@/lib/api-client';
    import type { IPOReview } from '@/lib/db/types';
    ```

- [ ] Implement admin review list component
  - [ ] Fetch pending reviews on mount:
    ```typescript
    const [pendingReviews, setPendingReviews] = useState<IPOReview[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      fetchPendingReviews();
    }, []);

    async function fetchPendingReviews() {
      try {
        setLoading(true);
        const response = await fetch('/api/admin/reviews');
        const data = await response.json();
        setPendingReviews(data.data);
      } catch (error) {
        console.error('Error fetching pending reviews:', error);
      } finally {
        setLoading(false);
      }
    }
    ```
  - [ ] Implement approve/reject handlers:
    ```typescript
    async function handleApprove(reviewId: string) {
      try {
        await fetch(`/api/admin/reviews/${reviewId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' })
        });

        // Remove from pending list
        setPendingReviews(prev => prev.filter(r => r.id !== reviewId));
      } catch (error) {
        console.error('Error approving review:', error);
      }
    }

    async function handleReject(reviewId: string) {
      try {
        await fetch(`/api/admin/reviews/${reviewId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject' })
        });

        // Remove from pending list
        setPendingReviews(prev => prev.filter(r => r.id !== reviewId));
      } catch (error) {
        console.error('Error rejecting review:', error);
      }
    }
    ```

- [ ] Render review moderation UI
  - [ ] Admin panel layout:
    ```typescript
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">Review Moderation</h1>

        {loading && <p>Loading pending reviews...</p>}

        {!loading && pendingReviews.length === 0 && (
          <p className="text-gray-500">No pending reviews to moderate.</p>
        )}

        <div className="space-y-4">
          {pendingReviews.map((review) => (
            <Card key={review.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{review.reviewTitle}</CardTitle>
                    <div className="text-sm text-gray-600 mt-1">
                      By {review.author} • {new Date(review.publishedDate).toLocaleDateString()}
                    </div>
                  </div>
                  <Badge>{review.recommendation}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-700 mb-4">
                  {review.reviewContent?.substring(0, 200)}...
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleApprove(review.id)}
                    variant="default"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Approve
                  </Button>
                  <Button
                    onClick={() => handleReject(review.id)}
                    variant="destructive"
                    size="sm"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
    ```

### Phase 6: Integration with IPO Detail Page (AC: 12)

- [ ] Add RecommendationSummarySection to IPO detail page (AC: 12)
  - [ ] Open file: `web/app/ipos/[slug]/page.tsx` (or equivalent IPO detail page)
  - [ ] Import component:
    ```typescript
    import { RecommendationSummarySection } from '@/components/ipo-detail/RecommendationSummarySection';
    ```
  - [ ] Add section after Company Overview:
    ```typescript
    {/* Company Overview Section */}
    <CompanyOverviewSection ipo={ipo} />

    {/* Recommendation Summary Section (AC: 12) */}
    {ipo.reviewSummary && (
      <RecommendationSummarySection
        reviewSummary={ipo.reviewSummary}
        ipoSegment={ipo.segment}
      />
    )}

    {/* Other sections... */}
    ```

### Phase 7: Testing (AC: 14, 15, 16)

- [ ] Create test fixtures for reviews
  - [ ] Create file: `web/tests/fixtures/review.fixture.ts`
  - [ ] Add sample review data:
    ```typescript
    export const mockReviews: IPOReview[] = [
      {
        id: 'review-1',
        ipoId: 'ipo-1',
        author: 'ICICI Securities',
        recommendation: 'May apply',
        reviewTitle: 'Strong fundamentals and attractive valuation',
        reviewContent: 'The company shows strong fundamentals with consistent revenue growth...',
        reviewUrl: 'https://example.com/review-1',
        publishedDate: new Date('2025-10-20'),
        segment: 'MAINBOARD',
        year: 2025,
        isApproved: true,
        moderatedBy: 'admin@example.com',
        moderatedAt: new Date('2025-10-21'),
        createdAt: new Date('2025-10-20'),
        updatedAt: new Date('2025-10-21'),
      },
      // ... more mock reviews
    ];

    export const mockReviewSummary: ReviewSummary = {
      averageRating: 4.2,
      totalReviews: 47,
      recommendationBreakdown: {
        apply: 65.5,
        subscribe: 20.0,
        avoid: 10.0,
        notRecommended: 4.5,
      },
      sentimentAnalysis: {
        positive: 85.5,
        negative: 14.5,
      },
      topApplyReasons: [
        'Strong financial performance',
        'Attractive valuation',
        'Growth potential in sector',
      ],
      topAvoidReasons: [
        'High competition',
        'Regulatory uncertainties',
        'Limited track record',
      ],
      latestReviews: mockReviews.slice(0, 3),
    };
    ```

- [ ] Write unit tests for ReviewRepository (AC: 14)
  - [ ] Test file: `web/tests/unit/lib/repositories/review-repository.test.ts`
  - [ ] Test: `getReviewSummary()` returns correct aggregation
  - [ ] Test: Only approved reviews included in summary
  - [ ] Test: Average rating calculated correctly
  - [ ] Test: Recommendation breakdown percentages sum to 100
  - [ ] Test: Sentiment analysis correct (positive + negative = 100)
  - [ ] Test: Top 3 reasons extracted correctly
  - [ ] Test: Latest 3 reviews returned
  - [ ] Test: Returns null when no approved reviews
  - [ ] Test: Cache hit scenario (<50ms) (AC: 16)
  - [ ] Test: Cache miss scenario (<200ms) (AC: 16)
  - [ ] Test: `approveReview()` updates database and invalidates cache
  - [ ] Test: `rejectReview()` updates database and invalidates cache
  - [ ] Mock database and Redis

- [ ] Write unit tests for RecommendationSummarySection (AC: 14)
  - [ ] Test file: `web/tests/unit/components/ipo-detail/RecommendationSummarySection.test.tsx`
  - [ ] Test: Renders with review summary data
  - [ ] Test: Displays average rating with stars
  - [ ] Test: Shows review count prominently
  - [ ] Test: Renders recommendation breakdown with percentages
  - [ ] Test: Displays sentiment analysis correctly
  - [ ] Test: Shows top 3 Apply reasons
  - [ ] Test: Shows top 3 Avoid reasons
  - [ ] Test: Displays latest 3 reviews
  - [ ] Test: "View All Reviews" link correct for MAINBOARD
  - [ ] Test: "View All Reviews" link correct for SME
  - [ ] Test: Shows empty state when no reviews

- [ ] Write integration tests for review API routes (AC: 15)
  - [ ] Test file: `web/tests/integration/api/reviews.integration.test.ts`
  - [ ] Test: GET /api/ipos/[slug] includes reviewSummary
  - [ ] Test: GET /api/admin/reviews returns pending reviews
  - [ ] Test: PATCH /api/admin/reviews/[id] approves review
  - [ ] Test: PATCH /api/admin/reviews/[id] rejects review
  - [ ] Test: Cache invalidated after approve/reject (AC: 13)
  - [ ] Test: Only approved reviews appear in public summary (AC: 10)
  - [ ] Test: Admin authentication required for moderation endpoints
  - [ ] Use real database with test data

- [ ] Write E2E tests for review functionality
  - [ ] Test file: `web/tests/e2e/ipo-reviews.spec.ts`
  - [ ] Test: Navigate to IPO detail page → see Recommendation Summary section
  - [ ] Test: Verify section appears after Company Overview
  - [ ] Test: Click "View All Reviews" → navigates to reviews page
  - [ ] Test: Admin: Navigate to /admin/reviews → see pending reviews
  - [ ] Test: Admin: Approve review → disappears from pending list
  - [ ] Test: Admin: Reject review → disappears from pending list
  - [ ] Test: After approval, review appears in IPO detail summary
  - [ ] Test: Performance: Review summary loads in <200ms

- [ ] Performance testing (AC: 16)
  - [ ] Test cache hit performance (<50ms)
  - [ ] Test database aggregation performance (<200ms)
  - [ ] Test with 100+ reviews per IPO
  - [ ] Verify cache invalidation works correctly
  - [ ] Monitor query execution time in database

### Phase 8: Documentation & Cleanup

- [ ] Update architecture documentation
  - [ ] Add ReviewRepository to `docs/02-architecture/backend-architecture.md`
  - [ ] Document review moderation workflow
  - [ ] Document cache invalidation strategy for reviews

- [ ] Add JSDoc comments to all new code
  - [ ] ReviewRepository methods documented
  - [ ] Helper functions documented
  - [ ] Component props documented
  - [ ] API endpoints documented

- [ ] Code review checklist
  - [ ] All TypeScript types correct
  - [ ] No console.log statements (except error logging)
  - [ ] Code follows project coding standards
  - [ ] Imports organized correctly
  - [ ] No unused variables or imports
  - [ ] Error handling comprehensive
  - [ ] Cache invalidation implemented correctly
  - [ ] Admin authentication checked
  - [ ] Performance targets met

- [ ] Create completion summary
  - [ ] List all files created
  - [ ] List all files modified
  - [ ] Document any deviations from original plan
  - [ ] Note any assumptions made
  - [ ] Document any technical decisions

## Dev Notes

### Story Context

This story creates the **IPO Recommendations Summary Section** that displays broker recommendations, ratings, sentiment analysis, and expert opinions on the IPO detail page. The section aggregates data from the existing `ipoReviews` table and adds moderation capabilities.

**Key Implementation Details:**
- Database: Use existing `ipoReviews` table, add moderation fields (isApproved, moderatedBy, moderatedAt)
- Repository: Create ReviewRepository extending BaseRepository with aggregation methods
- Cache: Review summary cache with 15min TTL (CacheTTL.REVIEW_SUMMARY = 900)
- API: Extend `/api/ipos/[slug]` to include review summary
- Component: RecommendationSummarySection with card-style layout
- Admin: Moderation interface at `/admin/reviews` with approve/reject actions
- Performance: <50ms cache hit, <200ms DB aggregation

**New Components to Create:**
- `RecommendationSummarySection.tsx` - Main summary component (server component)
- Admin moderation page at `/admin/reviews` (client component)

**New Repository:**
- `ReviewRepository` - Extends BaseRepository, handles review aggregation and moderation

### Architecture Context

**Tech Stack** [Source: CLAUDE.md]:
- Next.js 15.5.4 with App Router
- React 19
- TypeScript
- PostgreSQL 16 with Drizzle ORM 0.44.6
- Redis 7.2+ with ioredis
- shadcn/ui components

**Project Structure** [Source: CLAUDE.md]:
- Repository: `web/lib/repositories/review-repository.ts`
- Component: `web/components/ipo-detail/RecommendationSummarySection.tsx`
- Admin Page: `web/app/admin/reviews/page.tsx`
- API Routes: `web/app/api/admin/reviews/route.ts`, `web/app/api/admin/reviews/[reviewId]/route.ts`
- Cache Keys: `web/lib/cache/cache-keys.ts` (add review cache keys)

**Naming Conventions** [Source: CLAUDE.md]:
- Repository files: PascalCase with -repository suffix (e.g., `ReviewRepository`)
- Component files: PascalCase (e.g., `RecommendationSummarySection.tsx`)
- Functions: camelCase (e.g., `getReviewSummary`)
- Cache keys: kebab-case (e.g., `review:summary:{ipoId}`)

### Database Schema Context

**ipoReviews Table** [Source: packages/shared/src/db/schema.ts]:
```typescript
export const ipoReviews = pgTable('ipo_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewTitle: varchar('review_title', { length: 500 }).notNull(),
  author: varchar('author', { length: 255 }).notNull(),
  recommendation: reviewRecommendationEnum('recommendation').notNull(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),
  publishedDate: timestamp('published_date').notNull(),
  year: integer('year').notNull(),
  segment: segmentEnum('segment').notNull(),
  reviewUrl: text('review_url'),
  reviewContent: text('review_content'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  ipoIdIdx: index('idx_ipo_reviews_ipo_id').on(table.ipoId),
  yearIdx: index('idx_ipo_reviews_year').on(table.year),
  segmentIdx: index('idx_ipo_reviews_segment').on(table.segment),
}));
```

**Enum: reviewRecommendationEnum**:
- 'May apply'
- 'Subscribe'
- 'Avoid'
- 'Not Recommended'

**Required Migration**: Add moderation fields:
- `isApproved: boolean` (default: false, not null)
- `moderatedBy: varchar(255)` (nullable)
- `moderatedAt: timestamp` (nullable)
- Add index: `idx_ipo_reviews_approved` on (isApproved, ipoId)

### Repository Pattern Context

**BaseRepository Pattern** [Source: docs/02-architecture/backend-architecture.md]:
- All repositories extend BaseRepository
- BaseRepository provides: `getFromCache()`, `setCache()`, `deleteCache()`, `invalidateCache()`
- Repository constructor: `NodePgDatabase<typeof schema>` and `Redis`
- Cache-aside pattern: Try cache first, query DB on miss, populate cache

**Repository Type Requirements** [Source: CLAUDE.md]:
```typescript
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';

export class ReviewRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }
}
```

### Caching Strategy Context

**Cache-Aside Pattern** [Source: docs/05-caching/CACHING_STRATEGY.md]:
- Repository layer implements caching
- TTL-based expiration (no manual cleanup)
- Pattern-based invalidation for bulk clearing
- Graceful degradation (app works without Redis)

**Cache Key Convention**: `{entity}:{operation}:{identifier}`
- Review summary: `review:summary:{ipoId}`
- Review list: `reviews:ipo:{ipoId}:{limit}`

**Cache TTL**: 15 minutes (900 seconds) for review data

**Cache Invalidation**: Invalidate on review moderation (approve/reject)
- Keys to invalidate: `review:summary:{ipoId}`, `reviews:ipo:{ipoId}*`, `ipo:slug:*`

### Performance Targets

**From CLAUDE.md**:
- Cache hit: <50ms (AC: 16)
- Database aggregation: <200ms (AC: 16)
- API response time (cached): <50ms
- API response time (DB): <200ms

### Component Architecture Context

**Server vs Client Components**:
- **RecommendationSummarySection**: Server component (no interactivity, pure presentation)
- **Admin Moderation Page**: Client component ('use client' - requires state and event handlers)

**shadcn/ui Components to Use**:
- Card, CardHeader, CardTitle, CardContent
- Badge
- Button
- lucide-react icons: Star, TrendingUp, TrendingDown, Check, X

### Reason Extraction Logic

**Apply Reasons Keywords**:
- Strong fundamentals
- Good valuation
- Growth potential
- Experienced management
- Healthy financials
- Solid track record
- Market leader
- Competitive advantage

**Avoid Reasons Keywords**:
- High valuation
- Weak financials
- Intense competition
- Unclear business model
- Regulatory risks
- Limited track record
- Debt concerns
- Management issues

**Implementation Strategy**:
- Extract from `reviewContent` using keyword matching
- Count frequency of each reason across all reviews
- Return top 3 most frequent reasons

### Admin Authentication Context

**Admin Routes**: All admin API routes require authentication
- Use `getAdminSession(request)` helper (from middleware)
- Return 401 if not authenticated
- Admin routes: `/api/admin/reviews`, `/api/admin/reviews/[reviewId]`

### Integration with IPO Detail Page

**Section Placement** (AC: 12):
- After Company Overview Section
- Before Financial Metrics Section
- Card-style layout matching other sections

**Conditional Rendering**:
- Only show section if `reviewSummary` exists
- Show empty state if no approved reviews

### Error Handling Strategy

**Repository Layer**:
- Return `null` if no approved reviews found
- Never throw errors from `getReviewSummary()`
- Log errors to console (server-side)
- Graceful degradation

**API Layer**:
- 401 for unauthorized admin requests
- 404 for review not found
- 500 for internal errors
- Proper error messages in JSON response

**Component Layer**:
- Handle `null` reviewSummary gracefully
- Show empty state message
- No error boundaries needed (repository never throws)

### Testing Strategy

**Coverage Targets** [Source: docs/02-architecture/testing-strategy.md]:
- Repository: >90% coverage
- Components: >80% coverage
- Integration tests: All API routes tested

**Test Fixtures**: Create mock review data in `web/tests/fixtures/review.fixture.ts`

**Performance Tests**: Verify cache hit (<50ms) and DB query (<200ms) performance

### File Modifications Required

**Files to Create**:
1. `web/lib/repositories/review-repository.ts` - ReviewRepository with aggregation methods
2. `web/components/ipo-detail/RecommendationSummarySection.tsx` - Summary UI component
3. `web/app/admin/reviews/page.tsx` - Admin moderation interface
4. `web/app/api/admin/reviews/route.ts` - GET pending reviews
5. `web/app/api/admin/reviews/[reviewId]/route.ts` - PATCH approve/reject
6. `web/drizzle/migrations/XXXX_add_review_moderation_fields.sql` - Database migration
7. `web/tests/fixtures/review.fixture.ts` - Test data
8. `web/tests/unit/lib/repositories/review-repository.test.ts` - Repository tests
9. `web/tests/unit/components/ipo-detail/RecommendationSummarySection.test.tsx` - Component tests
10. `web/tests/integration/api/reviews.integration.test.ts` - API tests
11. `web/tests/e2e/ipo-reviews.spec.ts` - E2E tests

**Files to Modify**:
1. `packages/shared/src/db/schema.ts` - Add moderation fields to ipoReviews table
2. `web/lib/cache/cache-keys.ts` - Add review cache key generators and TTL
3. `web/app/api/ipos/[slug]/route.ts` - Add review summary to response
4. `web/app/ipos/[slug]/page.tsx` - Add RecommendationSummarySection to page
5. `docs/02-architecture/backend-architecture.md` - Document ReviewRepository

### Dependencies and Prerequisites

**Required Dependencies** (already installed):
- Drizzle ORM 0.44.6 ✅
- Redis ioredis ✅
- shadcn/ui components ✅
- lucide-react icons ✅
- Vitest (testing) ✅
- Playwright (E2E) ✅

**Required Prerequisites**:
- `ipoReviews` table exists in database ✅ (verify in Phase 0)
- BaseRepository implemented ✅
- Cache utilities exist ✅
- Admin authentication middleware exists (verify in Phase 0)

**Potential Blockers**:
- If admin authentication middleware missing → Need to implement before admin routes
- If moderation fields don't exist → Create migration in Phase 0

### Known Limitations and Future Enhancements

**Current Limitations**:
1. **Reason Extraction**: Uses simple keyword matching, may miss nuanced reasons
   - **Future Enhancement**: Use NLP/AI for better reason extraction

2. **Rating Calculation**: Simple mapping (May apply=5, Subscribe=4, Avoid=2, Not Recommended=1)
   - **Future Enhancement**: More sophisticated scoring algorithm

3. **Moderation Interface**: Basic approve/reject only
   - **Future Enhancement**: Add edit capabilities, moderation notes, bulk actions

4. **Analytics**: No tracking of which reviews are most helpful
   - **Future Enhancement**: Add review helpfulness voting

5. **Real-time Updates**: Page requires refresh after moderation
   - **Future Enhancement**: WebSocket for real-time updates

### Implementation Approach

**Recommended Implementation Order**:
1. **Phase 0**: Prerequisites (schema verification, migration if needed)
2. **Phase 1**: Repository layer (core data access and aggregation logic)
3. **Phase 2**: Cache configuration (keys, TTL, invalidation)
4. **Phase 3**: API route extension (add review summary to IPO detail endpoint)
5. **Phase 4**: UI component (RecommendationSummarySection)
6. **Phase 5**: Admin moderation UI (approve/reject interface)
7. **Phase 6**: Integration (add section to IPO detail page)
8. **Phase 7**: Testing (unit, integration, E2E, performance)
9. **Phase 8**: Documentation and cleanup

**Critical Path Items**:
- Database migration (blocking if moderation fields missing)
- ReviewRepository implementation (core functionality)
- Cache invalidation (must work correctly for data consistency)
- Admin authentication (required for moderation endpoints)

## Testing

[Source: docs/02-architecture/testing-strategy.md]

**Test File Locations:**
- Unit tests: `web/tests/unit/lib/repositories/review-repository.test.ts`
- Integration tests: `web/tests/integration/api/reviews.integration.test.ts`
- E2E tests: `web/tests/e2e/ipo-reviews.spec.ts`

**Testing Frameworks:**
- Vitest for unit and integration tests
- Playwright for E2E tests

**Coverage Targets:**
- ReviewRepository: >90% code coverage (AC: 14)
- RecommendationSummarySection: >80% code coverage (AC: 14)
- API Routes: >85% code coverage (AC: 15)

**Test Execution:**
- Run unit tests: `npm run test:unit`
- Run integration tests: `npm run test:integration`
- Run E2E tests: `npm run test:e2e`
- Run all tests: `npm run test`

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-10-27 20:00:00 | 1.0 | Initial story draft created for Story 11.16 (IPO Recommendations Summary Section) based on Epic 11 lines 120-169. Story includes 16 acceptance criteria covering recommendation aggregation, sentiment analysis, top reasons, moderation interface, caching, and performance targets. Repository pattern with BaseRepository extension. Cache-aside implementation with 15min TTL. Admin moderation interface at /admin/reviews. Integration with IPO detail page after Company Overview section. | Claude (AI Assistant) |

## Dev Agent Record

_To be filled by Dev agent during implementation_

### Agent Model Used
_To be determined during implementation_

### Debug Log References
_To be added during implementation if issues encountered_

### Completion Notes List
_To be added after implementation completion_

### File List

**Files to Create:**
_To be documented during implementation_

**Files Modified:**
_To be documented during implementation_

## QA Results
_To be filled by QA agent after validation_
