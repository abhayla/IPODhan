/**
 * Subscription Repository
 *
 * Handles time-series data access for subscription snapshots.
 * Implements optimized queries for historical subscription data.
 */

import { eq, and, gte, lte, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { subscriptions } from '../db';
import * as schema from '@ipodhan/shared/db/schema';
import {
  CacheTTL,
  getLatestSubscriptionKey,
  getSubscriptionHistoryKey,
  getSubscriptionInvalidationKeys,
} from '../cache/cache-keys';
import { DatabaseError } from '../errors/repository-errors';
import type {
  Subscription,
  SubscriptionInsert,
  SubscriptionFilters,
  ISubscriptionRepository,
} from './types';

export class SubscriptionRepository
  extends BaseRepository
  implements ISubscriptionRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Find subscription history for an IPO
   */
  async findByIPO(filters: SubscriptionFilters): Promise<Subscription[]> {
    const { ipoId, fromDate, toDate, limit = 100 } = filters;

    const cacheKey = getSubscriptionHistoryKey(
      ipoId,
      fromDate && toDate
        ? Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
        : undefined
    );

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const conditions = [eq(subscriptions.ipoId, ipoId)];

          if (fromDate) {
            conditions.push(gte(subscriptions.timestamp, fromDate));
          }

          if (toDate) {
            conditions.push(lte(subscriptions.timestamp, toDate));
          }

          const whereClause = and(...conditions);

          const results = await this.db
            .select()
            .from(subscriptions)
            .where(whereClause)
            .orderBy(desc(subscriptions.timestamp))
            .limit(limit);

          return results;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch subscription history for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.HISTORICAL_DATA
    );
  }

  /**
   * Find latest subscription snapshot for an IPO
   */
  async findLatest(ipoId: string): Promise<Subscription | null> {
    const cacheKey = getLatestSubscriptionKey(ipoId);

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const [latest] = await this.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.ipoId, ipoId))
            .orderBy(desc(subscriptions.timestamp))
            .limit(1);

          return latest || null;
        } catch (error) {
          throw new DatabaseError(
            `Failed to fetch latest subscription for IPO: ${ipoId}`,
            undefined,
            error
          );
        }
      },
      CacheTTL.SUBSCRIPTION_LATEST
    );
  }

  /**
   * Create new subscription snapshot
   */
  async createSnapshot(data: SubscriptionInsert): Promise<Subscription> {
    try {
      const [snapshot] = await this.db
        .insert(subscriptions)
        .values(data)
        .returning();

      // Invalidate cache for this IPO
      const invalidationKeys = getSubscriptionInvalidationKeys(data.ipoId);
      await this.invalidateCache(invalidationKeys, [
        `subscription:history:${data.ipoId}:*`,
      ]);

      return snapshot;
    } catch (error) {
      throw new DatabaseError(
        'Failed to create subscription snapshot',
        undefined,
        error
      );
    }
  }

  /**
   * Delete all subscriptions for an IPO
   */
  async deleteByIPO(ipoId: string): Promise<void> {
    try {
      await this.db
        .delete(subscriptions)
        .where(eq(subscriptions.ipoId, ipoId));

      // Invalidate cache
      const invalidationKeys = getSubscriptionInvalidationKeys(ipoId);
      await this.invalidateCache(invalidationKeys, [
        `subscription:history:${ipoId}:*`,
      ]);
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete subscriptions for IPO: ${ipoId}`,
        undefined,
        error
      );
    }
  }
}
