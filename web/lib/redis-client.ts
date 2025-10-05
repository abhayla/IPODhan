import Redis from 'ioredis';
import { logger } from './logger';

/**
 * Redis Client Configuration
 *
 * Provides a singleton Redis client for caching and session management.
 * Handles connection, reconnection, and error scenarios.
 */

let redisClient: Redis | null = null;

/**
 * Get or create Redis client instance
 *
 * @returns Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        logger.warn({ attempt: times, delay }, 'Retrying Redis connection');
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Only reconnect when the error contains "READONLY"
          logger.error({ error: err.message }, 'Redis READONLY error, reconnecting');
          return true;
        }
        return false;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
    });

    redisClient.on('error', (err) => {
      logger.error({ error: err.message }, 'Redis client error');
    });

    redisClient.on('close', () => {
      logger.warn('Redis client connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('Redis client reconnecting');
    });
  }

  return redisClient;
}

/**
 * Close Redis connection gracefully
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis client disconnected');
  }
}

/**
 * Test Redis connection
 *
 * @returns true if connection is successful, false otherwise
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const result = await client.ping();
    if (result === 'PONG') {
      logger.info('Redis connection test successful');
      return true;
    }
    return false;
  } catch (error) {
    logger.error({ error }, 'Redis connection test failed');
    return false;
  }
}

export default getRedisClient;
