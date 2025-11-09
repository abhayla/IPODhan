/**
 * Base Repository Class
 *
 * Provides shared caching logic and utilities for all repositories.
 * Implements the cache-aside pattern with fallback to database on cache failures.
 * Includes automatic retry logic for transient database connection failures.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type Redis from 'ioredis';
import { CacheError } from '../errors/repository-errors';
import * as schema from '@ipodhan/shared/db/schema';
import { withRetry, trackRetry } from '../db/connection-retry';

export abstract class BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {}

  /**
   * Get data from cache with fallback to database query
   */
  protected async getFromCache<T>(
    cacheKey: string,
    dbQuery: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    try {
      // Try to get from cache first with timeout protection
      const cacheTimeout = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Redis get timeout')), 2000)
      );

      const cached = await Promise.race([
        this.redis.get(cacheKey),
        cacheTimeout,
      ]);

      if (cached) {
        console.log(`[Cache] HIT: ${cacheKey}`);
        return JSON.parse(cached) as T;
      }

      console.log(`[Cache] MISS: ${cacheKey}`);
    } catch (error) {
      // Log cache error but continue with database query
      console.error(
        `[Cache] Error getting key ${cacheKey}:`,
        error instanceof Error ? error.message : error
      );
    }

    // Cache miss or error - query database with retry logic
    const data = await withRetry(
      () => dbQuery(),
      {
        maxRetries: 3,
        context: `cache-aside query for key: ${cacheKey}`,
        onRetry: trackRetry,
      }
    );

    // Try to set cache (non-blocking with timeout)
    const setCacheWithTimeout = async () => {
      const cacheTimeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Redis set timeout')), 2000)
      );

      await Promise.race([
        this.setCache(cacheKey, data, ttl),
        cacheTimeout,
      ]);
    };

    setCacheWithTimeout().catch((error) => {
      console.error(
        `[Cache] Error setting key ${cacheKey}:`,
        error instanceof Error ? error.message : error
      );
    });

    return data;
  }

  /**
   * Set data in cache with TTL
   */
  protected async setCache<T>(
    cacheKey: string,
    data: T,
    ttl?: number
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(data);

      if (ttl) {
        await this.redis.setex(cacheKey, ttl, serialized);
      } else {
        await this.redis.set(cacheKey, serialized);
      }

      console.log(`[Cache] SET: ${cacheKey} (TTL: ${ttl || 'none'}s)`);
    } catch (error) {
      throw new CacheError(
        `Failed to set cache key: ${cacheKey}`,
        'SET',
        error
      );
    }
  }

  /**
   * Delete cache key(s)
   */
  protected async deleteCache(key: string | string[]): Promise<void> {
    try {
      const keys = Array.isArray(key) ? key : [key];

      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[Cache] DEL: ${keys.join(', ')}`);
      }
    } catch (error) {
      // Log but don't throw - cache invalidation failure shouldn't break operations
      console.error(
        `[Cache] Error deleting key(s):`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Delete cache keys matching a pattern
   */
  protected async deleteCachePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[Cache] DEL_PATTERN: ${pattern} (${keys.length} keys)`);
      }
    } catch (error) {
      // Log but don't throw - cache invalidation failure shouldn't break operations
      console.error(
        `[Cache] Error deleting pattern ${pattern}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Invalidate multiple cache keys and patterns
   */
  protected async invalidateCache(
    keys: string[],
    patterns?: string[]
  ): Promise<void> {
    // Delete exact keys
    if (keys.length > 0) {
      await this.deleteCache(keys);
    }

    // Delete patterns
    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        await this.deleteCachePattern(pattern);
      }
    }
  }

  /**
   * Execute a query with timing, error logging, and automatic retry on transient failures
   */
  protected async executeQuery<T>(
    queryName: string,
    query: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await withRetry(
        () => query(),
        {
          maxRetries: 3,
          context: queryName,
          onRetry: (attempt, error, delay) => {
            console.warn(
              `[DB] ${queryName} retry ${attempt}/3 after ${delay}ms`,
              context,
              error instanceof Error ? error.message : String(error)
            );
            trackRetry(attempt, error, delay);
          },
        }
      );

      const executionTime = Date.now() - startTime;
      console.log(`[DB] ${queryName} - ${executionTime}ms`, context);

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      console.error(
        `[DB] ${queryName} FAILED - ${executionTime}ms`,
        context,
        error
      );

      throw error;
    }
  }
}
