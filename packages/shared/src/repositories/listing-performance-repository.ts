/**
 * Listing Performance Repository
 *
 * Handles listing performance data access with upsert operations.
 * Implements caching for frequently accessed listing metrics.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository.js';
import { listingPerformance } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import { CacheTTL, getListingPerformanceKey } from '../cache/cache-keys.js';
import { DatabaseError } from '../errors/repository-errors.js';
import type {
  ListingPerformance,
  ListingPerformanceInsert,
  IListingPerformanceRepository,
} from './types.js';

export class ListingPerformanceRepository
  extends BaseRepository
  implements IListingPerformanceRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find listing performance for an IPO
   */
  async findByIPO(ipoId: string): Promise<ListingPerformance | null> {
    const cacheKey = getListingPerformanceKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [performance] = await this.db
            .select()
            .from(listingPerformance)
            .where(eq(listingPerformance.ipoId, ipoId))
            .limit(1);

          return performance || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch listing performance for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.LISTING_PERFORMANCE
    );
  }

  /**
   * Create or update listing performance for an IPO
   */
  async upsert(data: ListingPerformanceInsert): Promise<ListingPerformance> {
    try {
      const [result] = await this.db
        .insert(listingPerformance)
        .values(data)
        .onConflictDoUpdate({
          target: listingPerformance.ipoId,
          set: {
            ...data,
            lastUpdated: new Date(),
          },
        })
        .returning();

      // Invalidate cache
      await this.deleteCache(getListingPerformanceKey(data.ipoId));

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert listing performance',
        undefined,
        error
      );
    }
  }

  /**
   * Delete listing performance for an IPO
   */
  async delete(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(listingPerformance)
        .where(eq(listingPerformance.ipoId, ipoId));

      // Invalidate cache
      await this.deleteCache(getListingPerformanceKey(ipoId));
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete listing performance for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
