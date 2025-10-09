/**
 * GMP Repository
 *
 * Handles Grey Market Premium (GMP) historical data access.
 * Implements time-series queries with date range filtering.
 */

import { eq, and, gte, lte, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository.js';
import { gmpRecords } from '../db/schema.js';
import type * as schema from '../db/schema.js';
import {
  CacheTTL,
  getLatestGMPKey,
  getGMPHistoryKey,
  getGMPInvalidationKeys,
} from '../cache/cache-keys.js';
import { DatabaseError } from '../errors/repository-errors.js';
import type {
  GMPRecord,
  GMPRecordInsert,
  GMPFilters,
  IGMPRepository,
} from './types.js';

export class GMPRepository extends BaseRepository implements IGMPRepository {
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find GMP records for an IPO with optional date range
   */
  async findByIPO(filters: GMPFilters): Promise<GMPRecord[]> {
    const { ipoId, days, fromDate, toDate, limit = 100 } = filters;

    const cacheKey = getGMPHistoryKey(ipoId, days);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const conditions = [eq(gmpRecords.ipoId, ipoId)];

          // If days specified, calculate fromDate
          if (days && !fromDate) {
            const calculatedFromDate = new Date();
            calculatedFromDate.setDate(calculatedFromDate.getDate() - days);
            conditions.push(gte(gmpRecords.timestamp, calculatedFromDate));
          } else if (fromDate) {
            conditions.push(gte(gmpRecords.timestamp, fromDate));
          }

          if (toDate) {
            conditions.push(lte(gmpRecords.timestamp, toDate));
          }

          const whereClause = and(...conditions);

          const results = await this.db
            .select()
            .from(gmpRecords)
            .where(whereClause)
            .orderBy(desc(gmpRecords.timestamp))
            .limit(limit);

          return results;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch GMP records for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.HISTORICAL_DATA
    );
  }

  /**
   * Find latest GMP record for an IPO
   */
  async findLatest(ipoId: string): Promise<GMPRecord | null> {
    const cacheKey = getLatestGMPKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [latest] = await this.db
            .select()
            .from(gmpRecords)
            .where(eq(gmpRecords.ipoId, ipoId))
            .orderBy(desc(gmpRecords.timestamp))
            .limit(1);

          return latest || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch latest GMP for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.GMP_LATEST
    );
  }

  /**
   * Create new GMP record
   */
  async create(data: GMPRecordInsert): Promise<GMPRecord> {
    try {
      const [gmpRecord] = await this.db
        .insert(gmpRecords)
        .values(data)
        .returning();

      // Invalidate cache for this IPO
      const invalidationKeys = getGMPInvalidationKeys(data.ipoId);
      await this.invalidateCache(invalidationKeys, [
        `gmp:history:${data.ipoId}:*`,
      ]);

      return gmpRecord;
    } catch (error) {
      throw new DatabaseError(
        'Failed to create GMP record',
        undefined,
        error
      );
    }
  }

  /**
   * Delete all GMP records for an IPO
   */
  async deleteByIPO(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(gmpRecords)
        .where(eq(gmpRecords.ipoId, ipoId));

      // Invalidate cache
      const invalidationKeys = getGMPInvalidationKeys(ipoId);
      await this.invalidateCache(invalidationKeys, [
        `gmp:history:${ipoId}:*`,
      ]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete GMP records for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
