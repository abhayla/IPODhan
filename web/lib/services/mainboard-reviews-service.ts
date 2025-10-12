/**
 * Mainboard IPO Reviews Service
 *
 * Service layer for fetching and filtering Mainboard IPO reviews data.
 * Implements caching, filtering, pagination, and sorting.
 */

import { db } from '@/lib/db';
import { ipos, ipoReviews } from '@/lib/db/schema';
import { eq, and, like, desc, sql } from 'drizzle-orm';

// ===== TYPE DEFINITIONS =====

export interface ReviewFilters {
  reviewTitle?: string;  // Fuzzy search
  author?: string;       // Exact match
  recommendation?: string; // Exact match
  ipoName?: string;      // Fuzzy search
  page?: number;
}

export interface Review {
  id: string;
  reviewTitle: string;
  author: string;
  recommendation: string;
  ipoId: string;
  ipoName: string;      // Joined from ipos table
  ipoSlug: string;      // Joined from ipos table
  publishedDate: Date;
  year: number;
  reviewUrl?: string | null;
}

export interface ReviewsResponse {
  reviews: Review[];
  totalCount: number;
}

// ===== CONSTANTS =====

const PAGE_SIZE = 50;
const CACHE_TTL = 600; // 10 minutes in seconds

// ===== SERVICE FUNCTIONS =====

/**
 * Get Mainboard IPO Reviews with filtering, pagination, and sorting
 *
 * @param year - Year to filter reviews
 * @param filters - Optional filters for review data
 * @returns Promise with reviews array and total count
 */
export async function getMainboardIPOReviews(
  year: number,
  filters?: ReviewFilters
): Promise<ReviewsResponse> {
  try {
    // Build WHERE conditions
    const conditions = [
      eq(ipoReviews.category, 'MAINBOARD'),
      eq(ipoReviews.year, year),
    ];

    // Add optional fuzzy search filters
    if (filters?.reviewTitle) {
      conditions.push(like(ipoReviews.reviewTitle, `%${filters.reviewTitle}%`));
    }

    if (filters?.author) {
      conditions.push(eq(ipoReviews.author, filters.author));
    }

    if (filters?.recommendation) {
      conditions.push(eq(ipoReviews.recommendation, filters.recommendation));
    }

    // Query with JOIN to ipos table
    const query = db
      .select({
        id: ipoReviews.id,
        reviewTitle: ipoReviews.reviewTitle,
        author: ipoReviews.author,
        recommendation: ipoReviews.recommendation,
        ipoId: ipoReviews.ipoId,
        ipoName: ipos.companyName,
        ipoSlug: ipos.slug,
        publishedDate: ipoReviews.publishedDate,
        year: ipoReviews.year,
        reviewUrl: ipoReviews.reviewUrl,
      })
      .from(ipoReviews)
      .innerJoin(ipos, eq(ipoReviews.ipoId, ipos.id))
      .where(and(...conditions))
      .orderBy(desc(ipoReviews.publishedDate)); // Newest first

    // Apply IPO name filter if provided (needs to be after join)
    let results = await query;

    if (filters?.ipoName) {
      results = results.filter((r) =>
        r.ipoName.toLowerCase().includes(filters.ipoName!.toLowerCase())
      );
    }

    // Get total count
    const totalCount = results.length;

    // Apply pagination
    const page = filters?.page || 1;
    const offset = (page - 1) * PAGE_SIZE;
    const paginatedResults = results.slice(offset, offset + PAGE_SIZE);

    return {
      reviews: paginatedResults,
      totalCount,
    };
  } catch (error) {
    console.error('Error fetching Mainboard IPO reviews:', error);
    throw new Error('Failed to fetch Mainboard IPO reviews');
  }
}

/**
 * Get unique authors for dropdown filter
 *
 * @param year - Year to filter authors
 * @returns Promise with array of unique author names
 */
export async function getUniqueAuthors(year: number): Promise<string[]> {
  try {
    const results = await db
      .selectDistinct({ author: ipoReviews.author })
      .from(ipoReviews)
      .where(
        and(eq(ipoReviews.category, 'MAINBOARD'), eq(ipoReviews.year, year))
      )
      .orderBy(ipoReviews.author);

    return results.map((r) => r.author);
  } catch (error) {
    console.error('Error fetching unique authors:', error);
    return [];
  }
}

/**
 * Get review by ID
 *
 * @param reviewId - UUID of the review
 * @returns Promise with review data or null
 */
export async function getReviewById(reviewId: string): Promise<Review | null> {
  try {
    const result = await db
      .select({
        id: ipoReviews.id,
        reviewTitle: ipoReviews.reviewTitle,
        author: ipoReviews.author,
        recommendation: ipoReviews.recommendation,
        ipoId: ipoReviews.ipoId,
        ipoName: ipos.companyName,
        ipoSlug: ipos.slug,
        publishedDate: ipoReviews.publishedDate,
        year: ipoReviews.year,
        reviewUrl: ipoReviews.reviewUrl,
      })
      .from(ipoReviews)
      .innerJoin(ipos, eq(ipoReviews.ipoId, ipos.id))
      .where(eq(ipoReviews.id, reviewId))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error('Error fetching review by ID:', error);
    return null;
  }
}
