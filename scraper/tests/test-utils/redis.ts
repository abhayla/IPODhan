/**
 * Test Redis Utilities
 * Provides helper functions for setting up and cleaning up test Redis
 */

import { Redis } from 'ioredis';

let testRedis: Redis | null = null;

/**
 * Get test Redis connection
 * Creates a new connection if one doesn't exist
 */
export function getTestRedis(): Redis {
  if (testRedis) return testRedis;

  // Use test Redis from environment or create a separate test Redis DB
  const testRedisConfig = {
    host: process.env.TEST_REDIS_HOST || process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.TEST_REDIS_PORT || process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.TEST_REDIS_DB || '1'), // Use DB 1 for tests (production uses DB 0)
    password: process.env.TEST_REDIS_PASSWORD || process.env.REDIS_PASSWORD,
  };

  testRedis = new Redis(testRedisConfig);

  return testRedis;
}

/**
 * Clean up test Redis connection
 * Closes the connection and flushes test database
 */
export async function cleanupTestRedis(redis?: Redis) {
  const client = redis || testRedis;
  if (client) {
    // Flush test database (DB 1)
    await client.flushdb();
    await client.quit();
    testRedis = null;
  }
}

/**
 * Clear all test keys from Redis
 * Useful for beforeEach/afterEach cleanup
 */
export async function clearTestKeys(redis: Redis, pattern: string = 'test:*') {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}
