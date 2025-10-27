/**
 * Test fixtures for IPO Reviews
 *
 * Provides comprehensive mock data for unit and integration tests
 * covering all recommendation types and review states.
 *
 * Story 11.16: IPO Recommendations Summary Section
 */

import type { IPOReview, ReviewSummary } from '@/lib/repositories/review-repository';

/**
 * Sample IPO Reviews - Mix of approved and pending
 *
 * 3 Approved Reviews:
 * - Review 1: May apply (Strong fundamentals, Good valuation)
 * - Review 2: Subscribe (Growth potential, Market leader)
 * - Review 3: Avoid (High valuation, Weak financials)
 *
 * 2 Pending Reviews (unapproved):
 * - Review 4: Not Recommended (pending)
 * - Review 5: May apply (pending)
 */
export const mockReviews: IPOReview[] = [
  // Approved Review 1 - May apply
  {
    id: 'review-001-approved',
    ipoId: 'test-ipo-001',
    author: 'Motilal Oswal',
    reviewTitle: 'Strong Fundamentals with Good Valuation - May Apply',
    reviewContent: `
      The company demonstrates strong fundamentals with consistent revenue growth
      and good valuation metrics. The management team has a proven track record
      in the industry. With reasonable valuation and healthy financials,
      investors may apply for this IPO with a long-term perspective.
    `,
    reviewUrl: 'https://example.com/reviews/review-001',
    recommendation: 'May apply',
    publishedDate: new Date('2025-10-20'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-21'),
    createdAt: new Date('2025-10-20'),
    updatedAt: new Date('2025-10-21'),
  },

  // Approved Review 2 - Subscribe
  {
    id: 'review-002-approved',
    ipoId: 'test-ipo-001',
    author: 'ICICI Direct',
    reviewTitle: 'High Growth Potential - Subscribe',
    reviewContent: `
      The company is a market leader with strong brand presence and
      competitive advantage. Growth potential is significant with expansion plans
      in new markets. The experienced management team has demonstrated capability
      to execute strategic initiatives. We recommend subscribe for this IPO.
    `,
    reviewUrl: 'https://example.com/reviews/review-002',
    recommendation: 'Subscribe',
    publishedDate: new Date('2025-10-19'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-20'),
    createdAt: new Date('2025-10-19'),
    updatedAt: new Date('2025-10-20'),
  },

  // Approved Review 3 - Avoid
  {
    id: 'review-003-approved',
    ipoId: 'test-ipo-001',
    author: 'Angel Broking',
    reviewTitle: 'High Valuation Concerns - Avoid',
    reviewContent: `
      The valuation appears rich compared to industry peers. The company has
      weak financials with losses in recent quarters and a significant debt burden.
      There are regulatory risks and intense competition in the sector.
      We recommend investors avoid this IPO at current pricing.
    `,
    reviewUrl: 'https://example.com/reviews/review-003',
    recommendation: 'Avoid',
    publishedDate: new Date('2025-10-18'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-19'),
    createdAt: new Date('2025-10-18'),
    updatedAt: new Date('2025-10-19'),
  },

  // Pending Review 4 - Not Recommended (unapproved)
  {
    id: 'review-004-pending',
    ipoId: 'test-ipo-001',
    author: 'Sharekhan',
    reviewTitle: 'Business Model Unclear - Not Recommended',
    reviewContent: `
      The business model is unproven and there are concerns about
      revenue model clarity. The company faces intense competition and
      has poor track record in previous ventures. Not recommended.
    `,
    reviewUrl: null,
    recommendation: 'Not Recommended',
    publishedDate: new Date('2025-10-17'),
    isApproved: false,
    moderatedBy: null,
    moderatedAt: null,
    createdAt: new Date('2025-10-17'),
    updatedAt: new Date('2025-10-17'),
  },

  // Pending Review 5 - May apply (unapproved)
  {
    id: 'review-005-pending',
    ipoId: 'test-ipo-001',
    author: 'Kotak Securities',
    reviewTitle: 'Moderate Prospects - May Apply',
    reviewContent: `
      The company has good fundamental indicators and fair valuation.
      Investors with moderate risk appetite may apply.
    `,
    reviewUrl: 'https://example.com/reviews/review-005',
    recommendation: 'May apply',
    publishedDate: new Date('2025-10-16'),
    isApproved: false,
    moderatedBy: null,
    moderatedAt: null,
    createdAt: new Date('2025-10-16'),
    updatedAt: new Date('2025-10-16'),
  },
];

/**
 * Mock Review Summary based on approved reviews (reviews 1-3)
 *
 * Breakdown:
 * - 1 May apply (33%)
 * - 1 Subscribe (33%)
 * - 1 Avoid (33%)
 *
 * Average Rating: 3.7/5
 * - May apply = 5 points
 * - Subscribe = 4 points
 * - Avoid = 2 points
 * - Average = (5 + 4 + 2) / 3 = 3.7
 *
 * Sentiment:
 * - Positive (May apply + Subscribe) = 67%
 * - Negative (Avoid) = 33%
 */
export const mockReviewSummary: ReviewSummary = {
  averageRating: 3.7,
  totalReviews: 3,
  recommendationBreakdown: {
    apply: 1,
    subscribe: 1,
    avoid: 1,
    notRecommended: 0,
  },
  sentimentAnalysis: {
    positive: 67,
    negative: 33,
  },
  topApplyReasons: ['Strong fundamentals', 'Good valuation', 'Growth potential'],
  topAvoidReasons: ['High valuation', 'Weak financials'],
  latestReviews: [
    mockReviews[0], // Review 1 - May apply
    mockReviews[1], // Review 2 - Subscribe
    mockReviews[2], // Review 3 - Avoid
  ],
};

/**
 * Get approved reviews only
 */
export function getApprovedReviews(): IPOReview[] {
  return mockReviews.filter((review) => review.isApproved === true);
}

/**
 * Get pending reviews only
 */
export function getPendingReviews(): IPOReview[] {
  return mockReviews.filter((review) => review.isApproved === false);
}

/**
 * Get reviews by recommendation type
 */
export function getReviewsByRecommendation(
  recommendation: 'May apply' | 'Subscribe' | 'Avoid' | 'Not Recommended'
): IPOReview[] {
  return mockReviews.filter((review) => review.recommendation === recommendation);
}

/**
 * Mock review for different IPO (for testing cache invalidation)
 */
export const mockReviewDifferentIPO: IPOReview = {
  id: 'review-different-ipo',
  ipoId: 'test-ipo-002',
  author: 'HDFC Securities',
  reviewTitle: 'Different IPO Review',
  reviewContent: 'Review content for a different IPO',
  reviewUrl: null,
  recommendation: 'Subscribe',
  publishedDate: new Date('2025-10-15'),
  isApproved: true,
  moderatedBy: 'admin@ipodhan.com',
  moderatedAt: new Date('2025-10-16'),
  createdAt: new Date('2025-10-15'),
  updatedAt: new Date('2025-10-16'),
};

/**
 * Mock empty review summary (no approved reviews)
 */
export const mockEmptyReviewSummary: ReviewSummary | null = null;

/**
 * Helper to create a custom review with overrides
 */
export function createMockReview(overrides?: Partial<IPOReview>): IPOReview {
  return {
    id: 'review-custom',
    ipoId: 'test-ipo-001',
    author: 'Test Broker',
    reviewTitle: 'Test Review Title',
    reviewContent: 'Test review content',
    reviewUrl: null,
    recommendation: 'Subscribe',
    publishedDate: new Date('2025-10-20'),
    isApproved: true,
    moderatedBy: 'admin@ipodhan.com',
    moderatedAt: new Date('2025-10-21'),
    createdAt: new Date('2025-10-20'),
    updatedAt: new Date('2025-10-21'),
    ...overrides,
  };
}

/**
 * Helper to create review summary with custom values
 */
export function createMockReviewSummary(
  overrides?: Partial<ReviewSummary>
): ReviewSummary {
  return {
    averageRating: 4.0,
    totalReviews: 5,
    recommendationBreakdown: {
      apply: 2,
      subscribe: 2,
      avoid: 1,
      notRecommended: 0,
    },
    sentimentAnalysis: {
      positive: 80,
      negative: 20,
    },
    topApplyReasons: ['Strong fundamentals', 'Good valuation', 'Growth potential'],
    topAvoidReasons: ['High valuation'],
    latestReviews: [mockReviews[0], mockReviews[1], mockReviews[2]],
    ...overrides,
  };
}
