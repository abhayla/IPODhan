/**
 * Listing Performance Repository
 *
 * Handles listing performance data access with upsert operations.
 * Implements caching for frequently accessed listing metrics.
 */

import { filterPatchUnderHold } from '../services/field-hold';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { listingPerformance } from '../db/schema';
import type * as schema from '../db/schema';
import { CacheTTL, getListingPerformanceKey } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import { formatDbCause } from '../errors/db-cause';
import type {
  ListingPerformance,
  ListingPerformanceInsert,
  IListingPerformanceRepository,
} from './types';

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
      // §9.2 item 19: the conflict-update never replaces an admin-held listing_performance field;
      // the hold is re-read under the ipos row lock inside this transaction (field-hold.ts).
      const result = await this.db.transaction(async (tx) => {
        const { patch, hold } = await filterPatchUnderHold(tx as never, data.ipoId, 'listing_performance', data as Record<string, unknown>);
        // §9.2 item 23 (OD-151): a hidden IPO's row is left as stored (no insert, no update).
        if (hold?.hidden) {
          const [cur] = await tx.select().from(listingPerformance).where(eq(listingPerformance.ipoId, data.ipoId)).limit(1);
          return cur as ListingPerformance;
        }
        const [row] = await tx
          .insert(listingPerformance)
          .values(data)
          .onConflictDoUpdate({
            target: listingPerformance.ipoId,
            set: {
              ...(patch as Partial<ListingPerformanceInsert>),
              lastUpdated: new Date(),
            },
          })
          .returning();
        return row;
      });

      // Invalidate cache
      await this.deleteCache(getListingPerformanceKey(data.ipoId));

      return result;
    } catch (error) {
      // #139: name the IPO and inline the driver's diagnostics. The old message
      // was a bare constant, so 243 identical log lines said nothing about which
      // column or constraint Postgres actually rejected.
      throw new DatabaseError(
        `Failed to upsert listing performance for IPO ${data.ipoId}: ${formatDbCause(error)}`,
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
