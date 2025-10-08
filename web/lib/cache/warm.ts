/**
 * Cache Warming Utilities
 *
 * Story: 8.3 - Performance Optimization
 * Purpose: Pre-populate Redis cache for frequently accessed IPOs
 * Usage: Run after scraper completes to warm cache for open IPOs
 */

import { safeSet } from './redis-client';
import { logger } from '../logger';
import { db } from '../db';
import { getRedisClient } from './redis-client';
import { IPORepository } from '../repositories/ipo-repository';

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  IPO_LIST: 300, // 5 minutes
  IPO_DETAIL: 900, // 15 minutes
  IPO_SUBSCRIPTION: 600, // 10 minutes
  GMP_HISTORY: 1800, // 30 minutes
  SECTORS: 3600, // 1 hour
  REGISTRARS: 86400, // 24 hours
} as const;

/**
 * Warm cache for all open IPOs (currently accepting subscriptions)
 * These are the most frequently accessed IPOs
 */
export async function warmOpenIPOs(): Promise<void> {
  try {
    logger.info('Starting cache warming for open IPOs');

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch all open IPOs
    const openIPOs = await ipoRepository.findAll({
      status: ['OPEN'],
      limit: 50, // Reasonable limit for open IPOs
    });

    logger.info({ count: openIPOs.data.length }, 'Found open IPOs to warm');

    // Warm cache for each open IPO
    for (const ipo of openIPOs.data) {
      try {
        // Fetch full IPO detail with related data
        const ipoDetail = await ipoRepository.findBySlug(ipo.slug);

        if (ipoDetail) {
          // Cache IPO detail
          await safeSet(
            `ipo:detail:${ipo.slug}`,
            JSON.stringify(ipoDetail),
            CACHE_TTL.IPO_DETAIL
          );

          logger.debug({ slug: ipo.slug }, 'Warmed cache for IPO detail');
        }
      } catch (error) {
        logger.error(
          { error, slug: ipo.slug },
          'Failed to warm cache for IPO'
        );
        // Continue warming other IPOs even if one fails
      }
    }

    logger.info({ count: openIPOs.data.length }, 'Cache warming completed for open IPOs');
  } catch (error) {
    logger.error({ error }, 'Failed to warm open IPO caches');
    throw error;
  }
}

/**
 * Warm cache for upcoming IPOs (opening soon)
 * These may be accessed frequently as investors research
 */
export async function warmUpcomingIPOs(limit: number = 10): Promise<void> {
  try {
    logger.info({ limit }, 'Starting cache warming for upcoming IPOs');

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch upcoming IPOs (sorted by open_date)
    const upcomingIPOs = await ipoRepository.findAll({
      status: ['UPCOMING'],
      limit,
    });

    logger.info({ count: upcomingIPOs.data.length }, 'Found upcoming IPOs to warm');

    for (const ipo of upcomingIPOs.data) {
      try {
        const ipoDetail = await ipoRepository.findBySlug(ipo.slug);

        if (ipoDetail) {
          await safeSet(
            `ipo:detail:${ipo.slug}`,
            JSON.stringify(ipoDetail),
            CACHE_TTL.IPO_DETAIL
          );

          logger.debug({ slug: ipo.slug }, 'Warmed cache for upcoming IPO');
        }
      } catch (error) {
        logger.error(
          { error, slug: ipo.slug },
          'Failed to warm cache for upcoming IPO'
        );
      }
    }

    logger.info(
      { count: upcomingIPOs.data.length },
      'Cache warming completed for upcoming IPOs'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to warm upcoming IPO caches');
    throw error;
  }
}

/**
 * Warm cache for IPO list (homepage and listing page)
 * Pre-populate the most common list view
 */
export async function warmIPOList(): Promise<void> {
  try {
    logger.info('Starting cache warming for IPO list');

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch default IPO list (no filters, sorted by created_at desc)
    const ipos = await ipoRepository.findAll({
      limit: 50,
    });

    // Generate cache key based on default filter hash
    // Note: In production, use actual filter hash from query parameters
    const cacheKey = 'ipo:list:default';

    await safeSet(cacheKey, JSON.stringify(ipos), CACHE_TTL.IPO_LIST);

    logger.info(
      { count: ipos.data.length, cacheKey },
      'Cache warming completed for IPO list'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to warm IPO list cache');
    throw error;
  }
}

/**
 * Master cache warming function
 * Run this after scraper completes to warm all frequently accessed caches
 */
export async function warmAllCaches(): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info('Starting master cache warming');

    // Warm caches in parallel for efficiency
    await Promise.allSettled([
      warmOpenIPOs(),
      warmUpcomingIPOs(10),
      warmIPOList(),
    ]);

    const duration = Date.now() - startTime;
    logger.info({ durationMs: duration }, 'Master cache warming completed');
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      { error, durationMs: duration },
      'Master cache warming failed'
    );
    throw error;
  }
}

/**
 * Warm cache for a specific IPO by slug
 * Useful for manual cache warming or testing
 */
export async function warmIPOBySlug(slug: string): Promise<void> {
  try {
    logger.info({ slug }, 'Warming cache for specific IPO');

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const ipoDetail = await ipoRepository.findBySlug(slug);

    if (!ipoDetail) {
      logger.warn({ slug }, 'IPO not found, cannot warm cache');
      return;
    }

    await safeSet(
      `ipo:detail:${slug}`,
      JSON.stringify(ipoDetail),
      CACHE_TTL.IPO_DETAIL
    );

    logger.info({ slug }, 'Cache warmed successfully for IPO');
  } catch (error) {
    logger.error({ error, slug }, 'Failed to warm cache for IPO');
    throw error;
  }
}
