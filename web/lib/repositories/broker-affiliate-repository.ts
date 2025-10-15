/**
 * Broker Affiliate Repository
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Provides data access methods for the broker_affiliates table with caching.
 * Implements cache-aside pattern for optimal performance.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { eq, asc } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';
import { CacheTTL } from '../cache/cache-keys';

/**
 * BrokerAffiliate type (inferred from database schema)
 */
export type BrokerAffiliate = typeof schema.brokerAffiliates.$inferSelect;

/**
 * Repository for managing broker affiliate data
 */
export class BrokerAffiliateRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Find all active broker affiliates, sorted by display order
   *
   * Uses cache with 30-minute TTL.
   * Cache key: `broker:affiliates:active`
   *
   * @returns Array of active broker affiliates sorted by display_order ASC
   */
  async findAllActive(): Promise<BrokerAffiliate[]> {
    const cacheKey = 'broker:affiliates:active';

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'BrokerAffiliateRepository.findAllActive',
          async () => {
            const results = await this.db
              .select()
              .from(schema.brokerAffiliates)
              .where(eq(schema.brokerAffiliates.active, true))
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
    await this.deleteCache('broker:affiliates:active');
  }
}
