/**
 * Broker Affiliate Repository
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Provides data access methods for the broker_affiliates table with caching.
 * Implements cache-aside pattern for optimal performance.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { eq, asc, and, ilike } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';
import { CacheTTL } from '../cache/cache-keys';

/**
 * IPODhan has a real partner link only for Zerodha (owner decision
 * 2026-09-28, issue #97). Every reader path (this repository, via
 * `getActiveBrokers` / `/affiliates`) filters to Zerodha here so that a row
 * left over from the old multi-broker seed — or a release that deploys
 * before `seed-broker-affiliates.ts --apply` runs — can never render on the
 * live page (#97 class B4 finding 2).
 */
const AFFILIATE_BROKER_NAME = 'Zerodha';

/**
 * BrokerAffiliate type (inferred from database schema)
 */
export type BrokerAffiliate = typeof schema.brokerAffiliates.$inferSelect;

/**
 * Repository for managing broker affiliate data
 */
export class BrokerAffiliateRepository extends BaseRepository {
  /** The exact cache key this repository reads/writes — never a DEL pattern. */
  static readonly ACTIVE_CACHE_KEY = 'broker:affiliates:active';

  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Find all active, Zerodha-only broker affiliates, sorted by display order
   *
   * Uses cache with 30-minute TTL.
   * Cache key: `broker:affiliates:active`
   *
   * @returns Array of active Zerodha broker-affiliate rows sorted by display_order ASC
   */
  async findAllActive(): Promise<BrokerAffiliate[]> {
    return this.getFromCache(
      BrokerAffiliateRepository.ACTIVE_CACHE_KEY,
      async () => {
        return this.executeQuery(
          'BrokerAffiliateRepository.findAllActive',
          async () => {
            const results = await this.db
              .select()
              .from(schema.brokerAffiliates)
              .where(
                and(
                  eq(schema.brokerAffiliates.active, true),
                  ilike(schema.brokerAffiliates.brokerName, AFFILIATE_BROKER_NAME)
                )
              )
              .orderBy(asc(schema.brokerAffiliates.displayOrder));

            return results;
          },
          { count: 'all active brokers' }
        );
      },
      CacheTTL.BROKER_AFFILIATES // 30 minutes (1800 seconds)
    );
  }

  /**
   * Invalidate cache for broker affiliates
   *
   * Should be called when broker data is updated in the database.
   */
  async invalidateCache(): Promise<void> {
    await this.deleteCache(BrokerAffiliateRepository.ACTIVE_CACHE_KEY);
  }
}
