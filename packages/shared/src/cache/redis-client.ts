/**
 * Redis Client Singleton
 *
 * Provides a configured Redis client instance for caching operations.
 * Implements retry strategy and error handling for production use.
 */

import Redis from 'ioredis';
import { CacheError } from '../errors/repository-errors';

let redisClient: Redis | null = null;

/**
 * Initialize Redis client with configuration
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    // F2 (T-264 P2-3): this client used to build its connection from
    // REDIS_HOST/REDIS_PORT/REDIS_PASSWORD only, ignoring both REDIS_URL
    // (whose path segment selects the db, e.g. "redis://...:6379/1") and an
    // explicit REDIS_DB override. That collapsed staging and prod onto the
    // SAME Redis db0, so a staging page view could overwrite the key prod
    // serves. Honor REDIS_URL first (it carries the slot's db suffix);
    // REDIS_DB, when set, always wins as an explicit override.
    const sharedOptions = {
      retryStrategy: (times: number) => {
        // Stop retrying after 3 attempts in development to prevent hanging
        if (times > 3) {
          console.error('[Redis] Max retries reached, stopping reconnection attempts');
          return null;
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 5000, // 5 second timeout for connection
      ...(process.env.REDIS_DB !== undefined
        ? { db: parseInt(process.env.REDIS_DB, 10) }
        : {}),
    };

    // T-278 P3-7 (#165 F3): a direct-write backfill script run over an SSH
    // tunnel to the DB host (e.g. DATABASE_HOST=127.0.0.1 PORT=15432) has NO
    // reason to also have REDIS_URL/REDIS_HOST set — prod Redis is
    // loopback-only on a DIFFERENT box (the Linux app server), reachable only
    // through its own tunnel. Silently falling back to localhost:6379 makes
    // invalidateIPOCaches() connect to whatever (if anything) is running
    // locally and report success — the write looks complete, but prod's
    // cached page keeps serving the pre-backfill value until CacheTTL
    // expires naturally. This warning is the only signal that happens; it
    // was previously silent (a 17-minute stale API read after a completed
    // backfill was the only observable symptom).
    if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
      console.warn(
        '[Redis] Neither REDIS_URL nor REDIS_HOST is set — falling back to localhost:6379. ' +
        'If this process is writing to a REMOTE database (e.g. via an SSH tunnel), this Redis ' +
        'connection is almost certainly NOT the one production reads from; cache invalidation ' +
        'will silently no-op against prod. Set REDIS_URL/REDIS_HOST explicitly, or accept that ' +
        'the change becomes visible only after the cache TTL expires.'
      );
    }

    redisClient = process.env.REDIS_URL
      ? new Redis(process.env.REDIS_URL, sharedOptions)
      : new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          ...sharedOptions,
        });

    // Handle connection events
    redisClient.on('error', (error) => {
      console.error('[Redis] Connection error:', error);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Ready to accept commands');
    });

    redisClient.on('close', () => {
      console.log('[Redis] Connection closed');
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Attempting to reconnect...');
    });
  }

  return redisClient;
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('✓ Redis connection closed');
  }
}

/**
 * Test Redis connection
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.ping();
    console.log('✓ Redis connection successful');
    return true;
  } catch (error) {
    console.error('✗ Redis connection failed:', error);
    return false;
  }
}

/**
 * Safe cache get operation with error handling
 */
export async function safeGet(key: string): Promise<string | null> {
  try {
    const client = getRedisClient();
    return await client.get(key);
  } catch (error) {
    throw new CacheError(`Failed to get cache key: ${key}`, 'GET', error);
  }
}

/**
 * Safe cache set operation with TTL and error handling
 */
export async function safeSet(
  key: string,
  value: string,
  ttlSeconds?: number
): Promise<void> {
  try {
    const client = getRedisClient();
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  } catch (error) {
    throw new CacheError(`Failed to set cache key: ${key}`, 'SET', error);
  }
}

/**
 * Safe cache delete operation with error handling
 */
export async function safeDel(key: string | string[]): Promise<void> {
  try {
    const client = getRedisClient();
    const keys = Array.isArray(key) ? key : [key];
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch (error) {
    throw new CacheError(
      `Failed to delete cache key(s)`,
      'DEL',
      error
    );
  }
}

/**
 * Safe cache delete pattern operation with error handling
 */
export async function safeDelPattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient();
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch (error) {
    throw new CacheError(
      `Failed to delete cache pattern: ${pattern}`,
      'DEL_PATTERN',
      error
    );
  }
}
