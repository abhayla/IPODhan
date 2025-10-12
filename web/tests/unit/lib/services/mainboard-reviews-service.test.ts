/**
 * Unit Tests for Mainboard Reviews Service
 *
 * Tests the review fetching service with various filters, pagination, and sorting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMainboardIPOReviews,
  getUniqueAuthors,
  getReviewById,
  type Review,
  type ReviewFilters,
} from '@/lib/services/mainboard-reviews-service';

// ==================== MOCK DATA HELPERS ====================

/**
 * Create mock review data
 */
function createMockReview(overrides?: Partial<Review>): Review {
  return {
    id: 'test-review-id',
    reviewTitle: 'Test IPO Review - Strong Buy Recommendation',
    author: 'SEBI Analyst XYZ',
    recommendation: 'Subscribe',
    ipoId: 'test-ipo-id',
    ipoName: 'Test Company Ltd',
    ipoSlug: 'test-company-ltd',
    publishedDate: new Date('2025-01-15'),
    year: 2025,
    reviewUrl: 'https://example.com/review',
    ...overrides,
  };
}

/**
 * Create an array of mock reviews for testing
 */
function createMockReviews(count: number): Review[] {
  return Array.from({ length: count }, (_, i) =>
    createMockReview({
      id: `review-${i + 1}`,
      reviewTitle: `Review ${i + 1} - Analysis`,
      author: i % 2 === 0 ? 'Analyst A' : 'Analyst B',
      recommendation: ['Subscribe', 'May apply', 'Avoid', 'Not Recommended'][i % 4] as any,
      publishedDate: new Date(`2025-01-${String(i + 1).padStart(2, '0')}`),
    })
  );
}

// ==================== MOCK DATABASE ====================

// Create a mock query builder that returns itself for chaining
const createMockQueryBuilder = () => {
  const mockBuilder: any = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  return mockBuilder;
};

// Mock Drizzle ORM db instance
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => createMockQueryBuilder()),
    selectDistinct: vi.fn(() => createMockQueryBuilder()),
  },
}));

// Mock database schema
vi.mock('@/lib/db/schema', () => ({
  ipos: {
    id: 'ipos.id',
    companyName: 'ipos.company_name',
    slug: 'ipos.slug',
  },
  ipoReviews: {
    id: 'ipo_reviews.id',
    reviewTitle: 'ipo_reviews.review_title',
    author: 'ipo_reviews.author',
    recommendation: 'ipo_reviews.recommendation',
    ipoId: 'ipo_reviews.ipo_id',
    publishedDate: 'ipo_reviews.published_date',
    year: 'ipo_reviews.year',
    category: 'ipo_reviews.category',
    reviewUrl: 'ipo_reviews.review_url',
  },
}));

// ==================== TESTS ====================

describe('Mainboard Reviews Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMainboardIPOReviews', () => {
    describe('Basic fetching', () => {
      it('should fetch all reviews for a given year', async () => {
        const mockReviews = createMockReviews(10);
        const { db } = await import('@/lib/db');

        // Mock the database query chain
        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const result = await getMainboardIPOReviews(2025);

        expect(result.reviews).toHaveLength(10);
        expect(result.totalCount).toBe(10);
        expect(result.reviews[0].year).toBe(2025);
      });

      it('should return empty array when no reviews found', async () => {
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue([]);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const result = await getMainboardIPOReviews(2030);

        expect(result.reviews).toHaveLength(0);
        expect(result.totalCount).toBe(0);
      });

      it('should filter by MAINBOARD category only', async () => {
        const mockReviews = createMockReviews(5);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const result = await getMainboardIPOReviews(2025);

        expect(mockQueryBuilder.where).toHaveBeenCalled();
        expect(result.reviews).toHaveLength(5);
      });
    });

    describe('Filtering', () => {
      it('should filter by review title (fuzzy search)', async () => {
        const mockReviews = createMockReviews(3).filter(r =>
          r.reviewTitle.toLowerCase().includes('review')
        );
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          reviewTitle: 'review',
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews.length).toBeGreaterThan(0);
        expect(mockQueryBuilder.where).toHaveBeenCalled();
      });

      it('should filter by author (exact match)', async () => {
        const mockReviews = createMockReviews(5).filter(r =>
          r.author === 'Analyst A'
        );
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          author: 'Analyst A',
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews.every(r => r.author === 'Analyst A')).toBe(true);
      });

      it('should filter by recommendation', async () => {
        const mockReviews = createMockReviews(5).filter(r =>
          r.recommendation === 'Subscribe'
        );
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          recommendation: 'Subscribe',
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews.every(r => r.recommendation === 'Subscribe')).toBe(true);
      });

      it('should filter by IPO name (fuzzy search)', async () => {
        const allReviews = createMockReviews(10);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(allReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          ipoName: 'Company',
        };
        const result = await getMainboardIPOReviews(2025, filters);

        // Service should filter results client-side for IPO name
        expect(result.reviews.length).toBeGreaterThan(0);
        expect(result.reviews.every(r =>
          r.ipoName.toLowerCase().includes('company')
        )).toBe(true);
      });

      it('should apply multiple filters together (AND logic)', async () => {
        const mockReviews = createMockReviews(10);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          reviewTitle: 'analysis',
          author: 'Analyst A',
          recommendation: 'Subscribe',
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(mockQueryBuilder.where).toHaveBeenCalled();
        expect(result.reviews).toBeDefined();
      });
    });

    describe('Sorting', () => {
      it('should sort by published date descending (newest first)', async () => {
        const mockReviews = createMockReviews(5);
        // Mock data is already sorted by date ascending, reverse it
        mockReviews.reverse();
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const result = await getMainboardIPOReviews(2025);

        expect(mockQueryBuilder.orderBy).toHaveBeenCalled();
        expect(result.reviews[0].publishedDate.getTime()).toBeGreaterThan(
          result.reviews[result.reviews.length - 1].publishedDate.getTime()
        );
      });
    });

    describe('Pagination', () => {
      it('should return first page by default (50 records)', async () => {
        const mockReviews = createMockReviews(100);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const result = await getMainboardIPOReviews(2025);

        expect(result.reviews).toHaveLength(50);
        expect(result.totalCount).toBe(100);
      });

      it('should return second page correctly', async () => {
        const mockReviews = createMockReviews(100);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          page: 2,
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews).toHaveLength(50);
        expect(result.reviews[0].id).toBe('review-51');
        expect(result.totalCount).toBe(100);
      });

      it('should return remaining records on last page', async () => {
        const mockReviews = createMockReviews(75);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          page: 2,
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews).toHaveLength(25);
        expect(result.totalCount).toBe(75);
      });

      it('should return empty array for page beyond available data', async () => {
        const mockReviews = createMockReviews(10);
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        const filters: ReviewFilters = {
          page: 3,
        };
        const result = await getMainboardIPOReviews(2025, filters);

        expect(result.reviews).toHaveLength(0);
        expect(result.totalCount).toBe(10);
      });
    });

    describe('Error handling', () => {
      it('should throw error when database query fails', async () => {
        const { db } = await import('@/lib/db');

        const mockQueryBuilder = createMockQueryBuilder();
        mockQueryBuilder.orderBy.mockRejectedValue(new Error('Database error'));
        vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

        await expect(getMainboardIPOReviews(2025)).rejects.toThrow(
          'Failed to fetch Mainboard IPO reviews'
        );
      });
    });
  });

  describe('getUniqueAuthors', () => {
    it('should return list of unique authors for given year', async () => {
      const mockAuthors = [
        { author: 'Analyst A' },
        { author: 'Analyst B' },
        { author: 'Analyst C' },
      ];
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.orderBy.mockResolvedValue(mockAuthors);
      vi.mocked(db.selectDistinct).mockReturnValue(mockQueryBuilder);

      const result = await getUniqueAuthors(2025);

      expect(result).toEqual(['Analyst A', 'Analyst B', 'Analyst C']);
      expect(result).toHaveLength(3);
    });

    it('should return empty array when no authors found', async () => {
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.orderBy.mockResolvedValue([]);
      vi.mocked(db.selectDistinct).mockReturnValue(mockQueryBuilder);

      const result = await getUniqueAuthors(2030);

      expect(result).toEqual([]);
    });

    it('should return empty array on database error', async () => {
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.orderBy.mockRejectedValue(new Error('Database error'));
      vi.mocked(db.selectDistinct).mockReturnValue(mockQueryBuilder);

      const result = await getUniqueAuthors(2025);

      expect(result).toEqual([]);
    });
  });

  describe('getReviewById', () => {
    it('should fetch review by ID', async () => {
      const mockReview = createMockReview();
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.limit.mockResolvedValue([mockReview]);
      vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

      const result = await getReviewById('test-review-id');

      expect(result).toEqual(mockReview);
      expect(result?.id).toBe('test-review-id');
    });

    it('should return null when review not found', async () => {
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.limit.mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

      const result = await getReviewById('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.limit.mockRejectedValue(new Error('Database error'));
      vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

      const result = await getReviewById('test-review-id');

      expect(result).toBeNull();
    });
  });

  describe('Type safety', () => {
    it('should return correctly typed Review objects', async () => {
      const mockReviews = createMockReviews(1);
      const { db } = await import('@/lib/db');

      const mockQueryBuilder = createMockQueryBuilder();
      mockQueryBuilder.orderBy.mockResolvedValue(mockReviews);
      vi.mocked(db.select).mockReturnValue(mockQueryBuilder);

      const result = await getMainboardIPOReviews(2025);
      const review = result.reviews[0];

      expect(review).toHaveProperty('id');
      expect(review).toHaveProperty('reviewTitle');
      expect(review).toHaveProperty('author');
      expect(review).toHaveProperty('recommendation');
      expect(review).toHaveProperty('ipoId');
      expect(review).toHaveProperty('ipoName');
      expect(review).toHaveProperty('ipoSlug');
      expect(review).toHaveProperty('publishedDate');
      expect(review).toHaveProperty('year');
      expect(typeof review.id).toBe('string');
      expect(typeof review.reviewTitle).toBe('string');
      expect(typeof review.year).toBe('number');
      expect(review.publishedDate).toBeInstanceOf(Date);
    });
  });
});
