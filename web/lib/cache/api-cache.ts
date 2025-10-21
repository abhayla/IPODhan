/**
 * API Caching Middleware Utility
 *
 * Provides a centralized caching wrapper for API routes to achieve aggressive
 * Redis caching and meet p95 < 500ms performance targets.
 *
 * Features:
 * - Automatic cache-aside pattern
 * - Non-blocking cache operations
 * - Graceful fallback if Redis is unavailable
 * - Consistent response format with cache status
 */

import { NextResponse } from 'next/server';
import { getRedisClient } from './redis-client';

/**
 * Wrapper function that adds caching to API endpoints
 *
 * @param cacheKey - Redis cache key
 * @param ttl - Time-to-live in seconds
 * @param fetchData - Async function that fetches fresh data
 * @returns NextResponse with data and cache metadata
 *
 * @example
 * export async function GET() {
 *   return withCache(
 *     'ipos:open:all',
 *     CacheTTL.IPO_LIST,
 *     async () => {
 *       const repository = new IPORepository(db, getRedisClient());
 *       return repository.findOpen({ limit: 100 });
 *     }
 *   );
 * }
 */
export async function withCache<T>(
  cacheKey: string,
  ttl: number,
  fetchData: () => Promise<T>
): Promise<NextResponse> {
  const redis = getRedisClient();
  const startTime = Date.now();

  try {
    // Try cache first with timeout protection (2 seconds)
    const cacheTimeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('Redis get timeout')), 2000)
    );

    try {
      const cached = await Promise.race([redis.get(cacheKey), cacheTimeout]);

      if (cached) {
        const cacheHitTime = Date.now() - startTime;
        console.log(`[API Cache] HIT: ${cacheKey} (${cacheHitTime}ms)`);

        return NextResponse.json({
          success: true,
          data: JSON.parse(cached),
          cached: true,
          cacheKey,
          responseTime: cacheHitTime,
        });
      }
    } catch (cacheError) {
      // Cache timeout or error - log and continue to fetch
      console.warn(
        `[API Cache] Error on GET ${cacheKey}:`,
        cacheError instanceof Error ? cacheError.message : cacheError
      );
    }

    // Cache miss - fetch fresh data
    console.log(`[API Cache] MISS: ${cacheKey}`);
    const data = await fetchData();
    const fetchTime = Date.now() - startTime;

    // Set cache (non-blocking with timeout)
    const setCacheWithTimeout = async () => {
      const setCacheTimeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Redis set timeout')), 2000)
      );

      await Promise.race([
        redis.setex(cacheKey, ttl, JSON.stringify(data)),
        setCacheTimeout,
      ]);

      console.log(`[API Cache] SET: ${cacheKey} (TTL: ${ttl}s)`);
    };

    // Cache population happens in background
    setCacheWithTimeout().catch((error) => {
      console.error(
        `[API Cache] Error on SET ${cacheKey}:`,
        error instanceof Error ? error.message : error
      );
    });

    return NextResponse.json({
      success: true,
      data,
      cached: false,
      cacheKey,
      responseTime: fetchTime,
    });
  } catch (error) {
    // Fatal error during data fetch
    console.error('[API Cache] Fatal error:', error);

    // Try to fetch without cache as last resort
    try {
      const fallbackData = await fetchData();
      const fallbackTime = Date.now() - startTime;

      return NextResponse.json({
        success: true,
        data: fallbackData,
        cached: false,
        error: 'Cache unavailable - served from database',
        responseTime: fallbackTime,
      });
    } catch (fallbackError) {
      // Both cache and database failed
      throw fallbackError;
    }
  }
}

/**
 * Invalidate cache keys by exact match or pattern
 *
 * @param keys - Array of exact cache keys to invalidate
 * @param patterns - Array of patterns with wildcards (e.g., 'ipo:list:*')
 *
 * @example
 * await invalidateCache(
 *   ['ipo:slug:xyz-ipo'],
 *   ['ipo:list:*', 'ipo:search:*']
 * );
 */
export async function invalidateCache(
  keys?: string[],
  patterns?: string[]
): Promise<void> {
  const redis = getRedisClient();

  try {
    // Delete exact keys
    if (keys && keys.length > 0) {
      const deleted = await redis.del(...keys);
      console.log(`[API Cache] Invalidated ${deleted} exact keys:`, keys);
    }

    // Delete pattern matches
    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        const matchingKeys = await redis.keys(pattern);
        if (matchingKeys.length > 0) {
          const deleted = await redis.del(...matchingKeys);
          console.log(
            `[API Cache] Invalidated ${deleted} keys matching pattern: ${pattern}`
          );
        }
      }
    }
  } catch (error) {
    console.error(
      '[API Cache] Error during cache invalidation:',
      error instanceof Error ? error.message : error
    );
    // Don't throw - invalidation failures shouldn't break operations
  }
}

/**
 * Warm up cache for frequently accessed endpoints
 *
 * @param warmUpFunctions - Array of functions that return cache key and data fetcher
 *
 * @example
 * await warmUpCache([
 *   { key: 'ipos:open:all', ttl: 300, fetch: () => repository.findOpen() },
 *   { key: 'ipos:upcoming:all', ttl: 300, fetch: () => repository.findUpcoming() }
 * ]);
 */
export async function warmUpCache(
  warmUpFunctions: Array<{
    key: string;
    ttl: number;
    fetch: () => Promise<unknown>;
  }>
): Promise<void> {
  const redis = getRedisClient();

  console.log(`[API Cache] Starting cache warm-up for ${warmUpFunctions.length} keys...`);

  const results = await Promise.allSettled(
    warmUpFunctions.map(async ({ key, ttl, fetch }) => {
      try {
        // Check if already cached
        const exists = await redis.exists(key);
        if (exists) {
          console.log(`[API Cache] Warm-up SKIP: ${key} (already cached)`);
          return;
        }

        // Fetch and cache
        const data = await fetch();
        await redis.setex(key, ttl, JSON.stringify(data));
        console.log(`[API Cache] Warm-up SET: ${key} (TTL: ${ttl}s)`);
      } catch (error) {
        console.error(
          `[API Cache] Warm-up ERROR for ${key}:`,
          error instanceof Error ? error.message : error
        );
      }
    })
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(
    `[API Cache] Warm-up complete: ${succeeded} succeeded, ${failed} failed`
  );
}
