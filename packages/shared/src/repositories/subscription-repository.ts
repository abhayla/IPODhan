/**
 * Subscription Repository
 *
 * Handles time-series data access for subscription snapshots.
 * Implements optimized queries for historical subscription data.
 */

import { eq, and, gte, lte, desc, or, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { BaseRepository } from './base-repository';
import { subscriptions } from '../db/schema';
import type * as schema from '../db/schema';
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

/**
 * W-03 follow-up: which scope of subscription rows a caller wants back.
 *
 * The chart endpoints (`findByIPO`/`findLatest`) default to CONSOLIDATED
 * (plus pre-W-03 rows, which have no scope label and stay valid) so a
 * BSE-only book never plots as if it were the same series as the
 * consolidated book. 'ALL' removes the scope predicate entirely for a
 * caller that genuinely wants every row regardless of scope.
 */
export type SubscriptionScopeOption =
  | 'BSE_ONLY'
  | 'NSE_ONLY'
  | 'CONSOLIDATED'
  | 'ALL';

const DEFAULT_SCOPE: SubscriptionScopeOption = 'CONSOLIDATED';

export class SubscriptionRepository
  extends BaseRepository
  implements ISubscriptionRepository
{
  constructor(db: NodePgDatabase<typeof schema>, redis: Redis) {
    super(db, redis);
  }

  /**
   * Builds the scope predicate for the subscriptions.scope column.
   * - 'ALL' -> no predicate (every row, any scope, including null).
   * - 'CONSOLIDATED' (default) -> CONSOLIDATED rows plus pre-W-03 rows
   *   that predate the scope label (null).
   * - 'BSE_ONLY' / 'NSE_ONLY' -> exactly that exchange-only book.
   */
  private buildScopeCondition(scope: SubscriptionScopeOption = DEFAULT_SCOPE) {
    if (scope === 'ALL') {
      return undefined;
    }
    if (scope === 'CONSOLIDATED') {
      return or(eq(subscriptions.scope, 'CONSOLIDATED'), isNull(subscriptions.scope));
    }
    return eq(subscriptions.scope, scope);
  }

  /**
   * Find subscription history for an IPO
   */
  async findByIPO(
    filters: SubscriptionFilters & { scope?: SubscriptionScopeOption }
  ): Promise<Subscription[]> {
    const { ipoId, fromDate, toDate, limit = 100, scope = DEFAULT_SCOPE } = filters;

    const cacheKey = `${getSubscriptionHistoryKey(
      ipoId,
      fromDate && toDate
        ? Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
        : undefined
    )}:scope:${scope}`;

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

          const scopeCondition = this.buildScopeCondition(scope);
          if (scopeCondition) {
            conditions.push(scopeCondition);
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
  async findLatest(
    ipoId: string,
    options?: { scope?: SubscriptionScopeOption }
  ): Promise<Subscription | null> {
    const scope = options?.scope ?? DEFAULT_SCOPE;
    const cacheKey = `${getLatestSubscriptionKey(ipoId)}:scope:${scope}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        try {
          const conditions = [eq(subscriptions.ipoId, ipoId)];
          const scopeCondition = this.buildScopeCondition(scope);
          if (scopeCondition) {
            conditions.push(scopeCondition);
          }

          const [latest] = await this.db
            .select()
            .from(subscriptions)
            .where(and(...conditions))
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
