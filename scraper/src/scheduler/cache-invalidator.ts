import type Redis from 'ioredis';
import logger from '../utils/logger.js';
import type { ScraperSource } from '../services/types.js';

/**
 * Cache Invalidator Service
 * Manages comprehensive cache invalidation after scraper runs
 * Uses Redis SCAN for pattern matching (non-blocking, production-safe)
 */
export class CacheInvalidator {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Invalidate all cache keys after successful scraper run
   * @param source - Scraper source (NSE, BSE, MONEYCONTROL, CHITTORGARH, API_FALLBACK)
   * @param updatedIPOs - Array of IPO slugs that were updated
   */
  async invalidateAfterScrape(
    source: ScraperSource | 'ALL',
    updatedIPOs: string[]
  ): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info({
        source,
        iposUpdated: updatedIPOs.length
      }, 'Starting cache invalidation');

      let totalKeysDeleted = 0;

      // 1. Invalidate specific IPO detail caches
      const detailKeysDeleted = await this.invalidateIPODetails(updatedIPOs);
      totalKeysDeleted += detailKeysDeleted;

      // 2. Invalidate all IPO listing caches (filter variations)
      const listingKeysDeleted = await this.invalidateIPOListings();
      totalKeysDeleted += listingKeysDeleted;

      // 3. Invalidate subscription caches for updated IPOs
      const subscriptionKeysDeleted = await this.invalidateSubscriptions(updatedIPOs);
      totalKeysDeleted += subscriptionKeysDeleted;

      // 4. Invalidate dashboard statistics cache
      const dashboardKeysDeleted = await this.invalidateDashboardStats();
      totalKeysDeleted += dashboardKeysDeleted;

      const duration = Date.now() - startTime;

      logger.info({
        source,
        iposUpdated: updatedIPOs.length,
        keysDeleted: totalKeysDeleted,
        detailKeysDeleted,
        listingKeysDeleted,
        subscriptionKeysDeleted,
        dashboardKeysDeleted,
        duration
      }, 'Cache invalidated successfully');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        source,
        iposUpdated: updatedIPOs.length,
        duration: Date.now() - startTime
      }, 'Cache invalidation failed');

      // Don't throw - cache miss is acceptable
    }
  }

  /**
   * Invalidate specific IPO detail cache
   * @param slug - IPO slug
   */
  async invalidateIPODetail(slug: string): Promise<void> {
    try {
      await this.invalidateIPODetails([slug]);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        slug
      }, 'Failed to invalidate IPO detail cache');
    }
  }

  /**
   * Invalidate all IPO listing caches (filter variations)
   */
  async invalidateIPOListings(): Promise<number> {
    try {
      let keysDeleted = 0;

      // Invalidate all listing cache variations
      keysDeleted += await this.deleteKeysByPattern('ipos:list:*');
      keysDeleted += await this.deleteKeysByPattern('ipo:search:*');

      logger.debug({
        keysDeleted
      }, 'IPO listing caches invalidated');

      return keysDeleted;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to invalidate IPO listings');
      return 0;
    }
  }

  /**
   * Invalidate subscription caches for specific IPO
   * @param slug - IPO slug
   */
  async invalidateSubscription(slug: string): Promise<void> {
    try {
      await this.invalidateSubscriptions([slug]);
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        slug
      }, 'Failed to invalidate subscription cache');
    }
  }

  /**
   * Invalidate dashboard statistics cache
   */
  async invalidateDashboardStats(): Promise<number> {
    try {
      const deleted = await this.redis.del('dashboard:stats');
      logger.debug('Dashboard stats cache invalidated');
      return deleted;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to invalidate dashboard stats');
      return 0;
    }
  }

  /**
   * Bulk invalidation (all cache types)
   */
  async invalidateAll(): Promise<void> {
    try {
      logger.info('Starting bulk cache invalidation');

      const startTime = Date.now();
      let totalKeysDeleted = 0;

      // Delete all IPO-related caches
      totalKeysDeleted += await this.deleteKeysByPattern('ipo:*');
      totalKeysDeleted += await this.deleteKeysByPattern('ipos:*');
      totalKeysDeleted += await this.deleteKeysByPattern('subscription:*');
      totalKeysDeleted += await this.deleteKeysByPattern('dashboard:*');

      const duration = Date.now() - startTime;

      logger.info({
        keysDeleted: totalKeysDeleted,
        duration
      }, 'Bulk cache invalidation completed');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error)
      }, 'Bulk cache invalidation failed');
    }
  }

  /**
   * Invalidate IPO detail caches for multiple IPOs
   * @param slugs - Array of IPO slugs
   * @returns Number of keys deleted
   */
  private async invalidateIPODetails(slugs: string[]): Promise<number> {
    if (slugs.length === 0) return 0;

    try {
      const pipeline = this.redis.pipeline();

      slugs.forEach(slug => {
        pipeline.del(`ipo:detail:${slug}`);
        pipeline.del(`ipo:slug:${slug}`);
      });

      const results = await pipeline.exec();
      const keysDeleted = results?.reduce((sum, [err, result]) => {
        return err ? sum : sum + (result as number);
      }, 0) ?? 0;

      logger.debug({
        slugs: slugs.length,
        keysDeleted
      }, 'IPO detail caches invalidated');

      return keysDeleted;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        slugs: slugs.length
      }, 'Failed to invalidate IPO details');
      return 0;
    }
  }

  /**
   * Invalidate subscription caches for multiple IPOs
   * @param slugs - Array of IPO slugs
   * @returns Number of keys deleted
   */
  private async invalidateSubscriptions(slugs: string[]): Promise<number> {
    if (slugs.length === 0) return 0;

    try {
      let keysDeleted = 0;

      // Delete latest subscription caches
      const pipeline = this.redis.pipeline();
      slugs.forEach(slug => {
        pipeline.del(`subscription:latest:${slug}`);
      });
      const results = await pipeline.exec();
      keysDeleted += results?.reduce((sum, [err, result]) => {
        return err ? sum : sum + (result as number);
      }, 0) ?? 0;

      // Delete subscription history caches (pattern matching)
      for (const slug of slugs) {
        keysDeleted += await this.deleteKeysByPattern(`subscription:history:${slug}:*`);
      }

      logger.debug({
        slugs: slugs.length,
        keysDeleted
      }, 'Subscription caches invalidated');

      return keysDeleted;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        slugs: slugs.length
      }, 'Failed to invalidate subscriptions');
      return 0;
    }
  }

  /**
   * Delete keys matching a pattern using SCAN for production safety
   * @param pattern - Key pattern to match (e.g., 'ipo:list:*')
   * @returns Number of keys deleted
   */
  private async deleteKeysByPattern(pattern: string): Promise<number> {
    const keys: string[] = [];
    let cursor = '0';

    try {
      // Use SCAN for production-safe iteration (non-blocking)
      do {
        const [nextCursor, matchedKeys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100
        );
        cursor = nextCursor;
        keys.push(...matchedKeys);
      } while (cursor !== '0');

      // Delete in batches using pipeline
      if (keys.length > 0) {
        const deleted = await this.redis.del(...keys);
        logger.debug({
          pattern,
          count: deleted
        }, 'Keys deleted by pattern');
        return deleted;
      }

      return 0;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        pattern
      }, 'Failed to delete keys by pattern');
      return 0;
    }
  }
}
