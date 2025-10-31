/**
 * IPO Review Repository (Scraper)
 *
 * Data access layer for IPO reviews in scraper context
 * Simplified version without caching (caching handled by web layer)
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export type IPOReview = InferSelectModel<typeof schema.ipoReviews>;
export type IPOReviewInsert = InferInsertModel<typeof schema.ipoReviews>;

export class ReviewRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  /**
   * Find all reviews for an IPO
   */
  async findByIPOId(ipoId: string): Promise<IPOReview[]> {
    const results = await this.db
      .select()
      .from(schema.ipoReviews)
      .where(eq(schema.ipoReviews.ipoId, ipoId));

    return results;
  }

  /**
   * Find a review by IPO ID and author
   * (Used for deduplication)
   */
  async findByIPOIdAndAuthor(ipoId: string, author: string): Promise<IPOReview | null> {
    const results = await this.db
      .select()
      .from(schema.ipoReviews)
      .where(
        and(
          eq(schema.ipoReviews.ipoId, ipoId),
          eq(schema.ipoReviews.author, author)
        )
      )
      .limit(1);

    return results[0] || null;
  }

  /**
   * Create a new IPO review
   */
  async create(data: IPOReviewInsert): Promise<IPOReview> {
    const [review] = await this.db
      .insert(schema.ipoReviews)
      .values(data)
      .returning();

    return review;
  }

  /**
   * Update an existing review
   */
  async update(id: string, data: Partial<IPOReviewInsert>): Promise<IPOReview> {
    const [updated] = await this.db
      .update(schema.ipoReviews)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.ipoReviews.id, id))
      .returning();

    return updated;
  }

  /**
   * Delete all reviews for an IPO
   * (Used before re-scraping to ensure fresh data)
   */
  async deleteByIPOId(ipoId: string): Promise<number> {
    const result = await this.db
      .delete(schema.ipoReviews)
      .where(eq(schema.ipoReviews.ipoId, ipoId));

    return result.rowCount || 0;
  }

  /**
   * Batch insert reviews
   */
  async batchCreate(data: IPOReviewInsert[]): Promise<IPOReview[]> {
    if (data.length === 0) return [];

    const results = await this.db
      .insert(schema.ipoReviews)
      .values(data)
      .returning();

    return results;
  }

  /**
   * Upsert review (create or update if exists)
   */
  async upsert(ipoId: string, author: string, data: IPOReviewInsert): Promise<IPOReview> {
    const existing = await this.findByIPOIdAndAuthor(ipoId, author);

    if (existing) {
      return this.update(existing.id, data);
    } else {
      return this.create(data);
    }
  }
}
