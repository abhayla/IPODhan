/**
 * Listing Performance Repository
 *
 * Handles listing performance data access with upsert operations.
 * Implements caching for frequently accessed listing metrics.
 */

import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { listingPerformance } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import { CacheTTL, getListingPerformanceKey } from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
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
   * Batch-fetch listing performance for many IPOs in one query.
   * Used by listing-index pages to surface real listing-gain data without
   * N+1 per-IPO lookups. Returns only the rows that exist (LISTED IPOs with
   * a listing_performance row) — callers treat a missing id as "no data yet".
   */
  async findByIPOIds(ipoIds: string[]): Promise<ListingPerformance[]> {
    if (ipoIds.length === 0) return [];

    try {
      return await this.db
        .select()
        .from(listingPerformance)
        .where(inArray(listingPerformance.ipoId, ipoIds));
    } catch (error) {
      throw new DatabaseError(
        'Failed to batch-fetch listing performance',
        undefined,
        error
      );
    }
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
      if (data.ipoId) {
        await this.deleteCache(getListingPerformanceKey(data.ipoId));
      }

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

  /**
   * Story 11.4 (AC4): Batch upsert listing performance records
   * Processes records in batches with transaction safety
   *
   * @param records - Array of listing performance records to upsert
   * @param batchSize - Number of records per batch (default: 50)
   * @returns Number of records successfully upserted
   */
  async batchUpsert(
    records: ListingPerformanceInsert[],
    batchSize: number = 50
  ): Promise<number> {
    if (records.length === 0) {
      return 0;
    }

    let totalUpserted = 0;
    const batches: ListingPerformanceInsert[][] = [];

    // Split records into batches (AC4)
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }

    console.log(
      `[ListingPerformanceRepository] Batch upsert: ${records.length} records in ${batches.length} batches (AC4)`
    );

    // Process each batch in a transaction (AC4)
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      try {
        // Execute batch upsert in transaction (AC4 - transaction safety)
        await this.db.transaction(async (tx) => {
          for (const record of batch) {
            await tx
              .insert(listingPerformance)
              .values(record)
              .onConflictDoUpdate({
                target: listingPerformance.ipoId,
                set: {
                  ...record,
                  updatedAt: new Date(),
                },
              });

            // Invalidate cache for this IPO (AC4)
            if (record.ipoId) {
              await this.deleteCache(getListingPerformanceKey(record.ipoId));
            }
          }
        });

        totalUpserted += batch.length;

        console.log(
          `[ListingPerformanceRepository] Batch ${batchIndex + 1}/${batches.length} completed: ${batch.length} records (AC4)`
        );
      } catch (error) {
        console.error(
          `[ListingPerformanceRepository] Batch ${batchIndex + 1} failed - rolling back (AC4):`,
          error instanceof Error ? error.message : error
        );

        // Transaction automatically rolled back on error (AC4)
        throw new DatabaseError(
          `Failed to upsert batch ${batchIndex + 1} of listing performance records`,
          undefined,
          error
        );
      }
    }

    console.log(
      `[ListingPerformanceRepository] Batch upsert completed: ${totalUpserted}/${records.length} records (AC4)`
    );

    return totalUpserted;
  }

  /**
   * Story 11.4 (AC4): Upsert listing performance for unmatched record (NULL ipo_id)
   * Stores historical data for IPOs not yet in our database
   *
   * @param data - Listing performance data with NULL ipo_id
   * @returns Inserted listing performance record
   */
  async upsertUnmatched(
    data: Omit<ListingPerformanceInsert, 'ipoId'>
  ): Promise<ListingPerformance> {
    try {
      const [result] = await this.db
        .insert(listingPerformance)
        .values({
          ...data,
          ipoId: null, // Explicitly set NULL for unmatched records (AC4)
        })
        .onConflictDoNothing() // Skip if already exists
        .returning();

      if (!result) {
        throw new Error('Failed to insert unmatched listing performance record');
      }

      console.log(
        `[ListingPerformanceRepository] Unmatched record stored: ${data.companyName} (AC4)`
      );

      return result;
    } catch (error) {
      throw new DatabaseError(
        'Failed to upsert unmatched listing performance',
        undefined,
        error
      );
    }
  }
}
