/**
 * Redis Client Singleton
 *
 * Provides a configured Redis client instance for caching operations.
 * Implements retry strategy and error handling for production use.
 */

import Redis from 'ioredis';
import { CacheError } from '../errors/repository-errors.js';

let redisClient: Redis | null = null;

/**
 * Initialize Redis client with configuration
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
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
