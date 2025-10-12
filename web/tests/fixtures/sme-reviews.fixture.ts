/**
 * Test fixtures for SME IPO Reviews
 * Provides sample data for unit and integration tests
 */

import { Review } from '@/lib/services/sme-reviews-service';

export const smeReviewsFixtures: Review[] = [
  {
    id: '1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p',
    reviewTitle: 'ABC SME Ltd IPO: Strong Growth Potential',
    author: 'SEBI Analyst XYZ',
    recommendation: 'Subscribe',
    ipoId: 'ipo-abc-sme-001',
    ipoName: 'ABC SME Ltd',
    ipoSlug: 'abc-sme-ltd',
    publishedDate: new Date('2025-10-10'),
    year: 2025,
    reviewUrl: 'https://example.com/reviews/abc-sme-ltd',
  },
  {
    id: '2b3c4d5e-6f7g-8h9i-0j1k-2l3m4n5o6p7q',
    reviewTitle: 'DEF Manufacturing SME IPO: May Apply with Caution',
    author: 'Expert Analyst ABC',
    recommendation: 'May apply',
    ipoId: 'ipo-def-sme-002',
    ipoName: 'DEF Manufacturing SME',
    ipoSlug: 'def-manufacturing-sme',
    publishedDate: new Date('2025-10-08'),
    year: 2025,
    reviewUrl: null,
  },
  {
    id: '3c4d5e6f-7g8h-9i0j-1k2l-3m4n5o6p7q8r',
    reviewTitle: 'GHI Tech SME IPO Analysis: Avoid',
    author: 'SEBI Analyst XYZ',
    recommendation: 'Avoid',
    ipoId: 'ipo-ghi-sme-003',
    ipoName: 'GHI Tech SME',
    ipoSlug: 'ghi-tech-sme',
    publishedDate: new Date('2025-10-05'),
    year: 2025,
    reviewUrl: 'https://example.com/reviews/ghi-tech-sme',
  },
  {
    id: '4d5e6f7g-8h9i-0j1k-2l3m-4n5o6p7q8r9s',
    reviewTitle: 'JKL Services SME IPO: Not Recommended',
    author: 'Market Expert PQR',
    recommendation: 'Not Recommended',
    ipoId: 'ipo-jkl-sme-004',
    ipoName: 'JKL Services SME',
    ipoSlug: 'jkl-services-sme',
    publishedDate: new Date('2025-10-01'),
    year: 2025,
    reviewUrl: null,
  },
  {
    id: '5e6f7g8h-9i0j-1k2l-3m4n-5o6p7q8r9s0t',
    reviewTitle: 'MNO Pharma SME IPO: Strong Subscribe',
    author: 'Expert Analyst ABC',
    recommendation: 'Subscribe',
    ipoId: 'ipo-mno-sme-005',
    ipoName: 'MNO Pharma SME',
    ipoSlug: 'mno-pharma-sme',
    publishedDate: new Date('2025-09-28'),
    year: 2025,
    reviewUrl: 'https://example.com/reviews/mno-pharma-sme',
  },
  {
    id: '6f7g8h9i-0j1k-2l3m-4n5o-6p7q8r9s0t1u',
    reviewTitle: 'PQR Textile SME IPO Review: May Apply',
    author: 'SEBI Analyst XYZ',
    recommendation: 'May apply',
    ipoId: 'ipo-pqr-sme-006',
    ipoName: 'PQR Textile SME',
    ipoSlug: 'pqr-textile-sme',
    publishedDate: new Date('2024-12-15'),
    year: 2024,
    reviewUrl: null,
  },
  {
    id: '7g8h9i0j-1k2l-3m4n-5o6p-7q8r9s0t1u2v',
    reviewTitle: 'STU Auto SME IPO: Avoid - High Risk',
    author: 'Market Expert PQR',
    recommendation: 'Avoid',
    ipoId: 'ipo-stu-sme-007',
    ipoName: 'STU Auto SME',
    ipoSlug: 'stu-auto-sme',
    publishedDate: new Date('2024-11-20'),
    year: 2024,
    reviewUrl: 'https://example.com/reviews/stu-auto-sme',
  },
  {
    id: '8h9i0j1k-2l3m-4n5o-6p7q-8r9s0t1u2v3w',
    reviewTitle: 'VWX Foods SME IPO: Subscribe for Long Term',
    author: 'Expert Analyst ABC',
    recommendation: 'Subscribe',
    ipoId: 'ipo-vwx-sme-008',
    ipoName: 'VWX Foods SME',
    ipoSlug: 'vwx-foods-sme',
    publishedDate: new Date('2024-10-10'),
    year: 2024,
    reviewUrl: null,
  },
  {
    id: '9i0j1k2l-3m4n-5o6p-7q8r-9s0t1u2v3w4x',
    reviewTitle: 'YZA Chemicals SME IPO: Not Recommended',
    author: 'SEBI Analyst XYZ',
    recommendation: 'Not Recommended',
    ipoId: 'ipo-yza-sme-009',
    ipoName: 'YZA Chemicals SME',
    ipoSlug: 'yza-chemicals-sme',
    publishedDate: new Date('2024-09-15'),
    year: 2024,
    reviewUrl: 'https://example.com/reviews/yza-chemicals-sme',
  },
  {
    id: '0j1k2l3m-4n5o-6p7q-8r9s-0t1u2v3w4x5y',
    reviewTitle: 'BCD Logistics SME IPO: May Apply',
    author: 'Market Expert PQR',
    recommendation: 'May apply',
    ipoId: 'ipo-bcd-sme-010',
    ipoName: 'BCD Logistics SME',
    ipoSlug: 'bcd-logistics-sme',
    publishedDate: new Date('2024-08-01'),
    year: 2024,
    reviewUrl: null,
  },
];

/**
 * Get fixtures filtered by year
 */
export function getReviewsByYear(year: number): Review[] {
  return smeReviewsFixtures.filter((review) => review.year === year);
}

/**
 * Get fixtures filtered by author
 */
export function getReviewsByAuthor(author: string): Review[] {
  return smeReviewsFixtures.filter((review) => review.author === author);
}

/**
 * Get fixtures filtered by recommendation
 */
export function getReviewsByRecommendation(recommendation: string): Review[] {
  return smeReviewsFixtures.filter(
    (review) => review.recommendation === recommendation
  );
}

/**
 * Get unique authors from fixtures
 */
export function getUniqueAuthorsFromFixtures(): string[] {
  const authors = new Set(smeReviewsFixtures.map((r) => r.author));
  return Array.from(authors).sort();
}

/**
 * Get unique recommendations from fixtures
 */
export function getUniqueRecommendationsFromFixtures(): string[] {
  const recommendations = new Set(smeReviewsFixtures.map((r) => r.recommendation));
  return Array.from(recommendations).sort();
}
