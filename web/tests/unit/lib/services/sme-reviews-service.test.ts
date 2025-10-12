/**
 * Unit tests for SME Reviews Service
 *
 * Tests data fetching, filtering, pagination, and sorting functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSMEIPOReviews } from '@/lib/services/sme-reviews-service';
import type { Review } from '@/lib/services/sme-reviews-service';
import { smeReviewsFixtures } from '@/tests/fixtures/sme-reviews.fixture';

// Mock the database module
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    selectDistinct: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  },
}));

// Mock the schema module
vi.mock('@/lib/db/schema', () => ({
  ipos: { id: 'id', companyName: 'companyName', slug: 'slug' },
  ipoReviews: {
    id: 'id',
    reviewTitle: 'reviewTitle',
    author: 'author',
    recommendation: 'recommendation',
    ipoId: 'ipoId',
    publishedDate: 'publishedDate',
    year: 'year',
    reviewUrl: 'reviewUrl',
    category: 'category',
  },
}));

describe('SME Reviews Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSMEIPOReviews', () => {
    it('should return SME reviews for specified year', async () => {
      // Mock the database query to return test fixtures
      const { db } = await import('@/lib/db');
      vi.mocked(db.where).mockResolvedValue(
        smeReviewsFixtures.filter((r) => r.year === 2025)
      );

      const result = await getSMEIPOReviews(2025);

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(result.reviews.every((r: Review) => r.year === 2025)).toBe(true);
      expect(result.totalCount).toBeGreaterThan(0);
    });

    it('should filter reviews by review title (fuzzy search)', async () => {
      const { db } = await import('@/lib/db');
      const filtered = smeReviewsFixtures.filter((r) =>
        r.reviewTitle.toLowerCase().includes('strong')
      );
      vi.mocked(db.where).mockResolvedValue(filtered);

      const result = await getSMEIPOReviews(2025, {
        reviewTitle: 'strong',
      });

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(
        result.reviews.every((r: Review) =>
          r.reviewTitle.toLowerCase().includes('strong')
        )
      ).toBe(true);
    });

    it('should filter reviews by author', async () => {
      const { db } = await import('@/lib/db');
      const author = 'SEBI Analyst XYZ';
      const filtered = smeReviewsFixtures.filter((r) => r.author === author);
      vi.mocked(db.where).mockResolvedValue(filtered);

      const result = await getSMEIPOReviews(2025, { author });

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(result.reviews.every((r: Review) => r.author === author)).toBe(
        true
      );
    });

    it('should filter reviews by recommendation', async () => {
      const { db } = await import('@/lib/db');
      const recommendation = 'Subscribe';
      const filtered = smeReviewsFixtures.filter(
        (r) => r.recommendation === recommendation
      );
      vi.mocked(db.where).mockResolvedValue(filtered);

      const result = await getSMEIPOReviews(2025, { recommendation });

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(
        result.reviews.every((r: Review) => r.recommendation === recommendation)
      ).toBe(true);
    });

    it('should filter reviews by IPO name (fuzzy search)', async () => {
      const { db } = await import('@/lib/db');
      const ipoName = 'SME';
      const allReviews = smeReviewsFixtures.filter((r) => r.year === 2025);
      vi.mocked(db.where).mockResolvedValue(allReviews);

      const result = await getSMEIPOReviews(2025, { ipoName });

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(
        result.reviews.every((r: Review) =>
          r.ipoName.toLowerCase().includes(ipoName.toLowerCase())
        )
      ).toBe(true);
    });

    it('should apply multiple filters together (AND logic)', async () => {
      const { db } = await import('@/lib/db');
      const year = 2025;
      const author = 'SEBI Analyst XYZ';
      const recommendation = 'Subscribe';

      const filtered = smeReviewsFixtures.filter(
        (r) =>
          r.year === year &&
          r.author === author &&
          r.recommendation === recommendation
      );
      vi.mocked(db.where).mockResolvedValue(filtered);

      const result = await getSMEIPOReviews(year, {
        author,
        recommendation,
      });

      expect(result.reviews.length).toBeGreaterThan(0);
      expect(
        result.reviews.every(
          (r: Review) =>
            r.year === year &&
            r.author === author &&
            r.recommendation === recommendation
        )
      ).toBe(true);
    });

    it('should paginate results (50 records per page)', async () => {
      const { db } = await import('@/lib/db');
      const allReviews = smeReviewsFixtures.filter((r) => r.year === 2025);
      vi.mocked(db.where).mockResolvedValue(allReviews);

      const page1 = await getSMEIPOReviews(2025, { page: 1 });
      expect(page1.reviews.length).toBeLessThanOrEqual(50);
      expect(page1.totalCount).toBe(allReviews.length);
    });

    it('should sort reviews by published date (descending - newest first)', async () => {
      const { db } = await import('@/lib/db');
      const sortedReviews = [...smeReviewsFixtures]
        .filter((r) => r.year === 2025)
        .sort(
          (a, b) =>
            b.publishedDate.getTime() - a.publishedDate.getTime()
        );
      vi.mocked(db.where).mockResolvedValue(sortedReviews);

      const result = await getSMEIPOReviews(2025);

      expect(result.reviews.length).toBeGreaterThan(1);
      // Check that each review is newer than or equal to the next one
      for (let i = 0; i < result.reviews.length - 1; i++) {
        const current = new Date(result.reviews[i].publishedDate);
        const next = new Date(result.reviews[i + 1].publishedDate);
        expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
      }
    });

    it('should return empty array for year with no reviews', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.where).mockResolvedValue([]);

      const result = await getSMEIPOReviews(2020);

      expect(result.reviews).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      const { db } = await import('@/lib/db');
      vi.mocked(db.where).mockRejectedValue(new Error('Database error'));

      await expect(getSMEIPOReviews(2025)).rejects.toThrow(
        'Failed to fetch SME IPO reviews'
      );
    });
  });
});
