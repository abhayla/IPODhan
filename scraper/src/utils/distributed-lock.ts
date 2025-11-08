/**
 * Distributed Locking Utility
 * Prevents race conditions when multiple scrapers update the same IPO simultaneously
 *
 * Features:
 * - Redis-based mutex using SET NX (only set if not exists)
 * - Automatic lock expiration to prevent deadlocks
 * - Lock extension for long-running operations
 * - Graceful degradation if Redis is unavailable
 * - Debug logging for troubleshooting
 *
 * Usage:
 * ```typescript
 * const lock = new DistributedLock(redis);
 * const acquired = await lock.acquire('ipo:xyz-company', 5000);
 * if (acquired) {
 *   try {
 *     // Critical section
 *     await updateIPOData();
 *   } finally {
 *     await lock.release('ipo:xyz-company');
 *   }
 * }
 * ```
 *
 * Architecture:
 * - Uses Redis SET with NX and PX options
 * - Lock key format: lock:resource:{resourceId}
 * - Lock value: unique token (UUID) to prevent accidental release
 * - Default TTL: 10 seconds (configurable)
 * - Supports lock extension via extendLock()
 */

import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

/**
 * Lock acquisition result
 */
export interface LockResult {
  acquired: boolean;
  token?: string; // Unique token for this lock acquisition
  expiresAt?: number; // Unix timestamp when lock expires
}

/**
 * Lock configuration
 */
export interface LockConfig {
  /**
   * Lock TTL in milliseconds
   * Default: 10000 (10 seconds)
   */
  ttl?: number;

  /**
   * Maximum retry attempts if lock is held
   * Default: 0 (no retries)
   */
  retryAttempts?: number;

  /**
   * Delay between retry attempts in milliseconds
   * Default: 100ms
   */
  retryDelay?: number;

  /**
   * Enable debug logging
   * Default: false
   */
  debug?: boolean;
}

/**
 * Distributed Lock Manager
 * Implements Redis-based mutex pattern
 */
export class DistributedLock {
  private redis: Redis | null;
  private defaultConfig: Required<LockConfig> = {
    ttl: 10000, // 10 seconds
    retryAttempts: 0,
    retryDelay: 100,
    debug: false,
  };

  // Track acquired locks for this instance (for cleanup)
  private acquiredLocks: Map<string, string> = new Map();

  constructor(redis: Redis | null) {
    this.redis = redis;
  }

  /**
   * Acquire lock for a resource
   * Returns true if lock acquired, false if already held
   */
  async acquire(
    resourceId: string,
    config: LockConfig = {}
  ): Promise<LockResult> {
    const mergedConfig = { ...this.defaultConfig, ...config };
    const lockKey = this.getLockKey(resourceId);
    const token = randomUUID();

    // If Redis is unavailable, allow operation (graceful degradation)
    if (!this.redis) {
      if (mergedConfig.debug) {
        console.log(
          `[DistributedLock] Redis unavailable, allowing operation for ${resourceId}`
        );
      }
      return { acquired: true, token };
    }

    let attempts = 0;
    const maxAttempts = mergedConfig.retryAttempts + 1;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // SET key value NX PX milliseconds
        // NX: Only set if key does not exist
        // PX: Set expiry in milliseconds
        const result = await this.redis.set(
          lockKey,
          token,
          'PX',
          mergedConfig.ttl,
          'NX'
        );

        if (result === 'OK') {
          // Lock acquired
          const expiresAt = Date.now() + mergedConfig.ttl;
          this.acquiredLocks.set(lockKey, token);

          if (mergedConfig.debug) {
            console.log(
              `[DistributedLock] Acquired lock for ${resourceId} (expires in ${mergedConfig.ttl}ms)`
            );
          }

          return { acquired: true, token, expiresAt };
        }

        // Lock already held by another process
        if (attempts < maxAttempts) {
          if (mergedConfig.debug) {
            console.log(
              `[DistributedLock] Lock held for ${resourceId}, retrying (${attempts}/${maxAttempts})...`
            );
          }
          await this.sleep(mergedConfig.retryDelay);
        }
      } catch (error) {
        console.error(
          `[DistributedLock] Error acquiring lock for ${resourceId}:`,
          error
        );
        // On error, allow operation to proceed (fail open)
        return { acquired: true, token };
      }
    }

    // Failed to acquire lock after all retries
    if (mergedConfig.debug) {
      console.log(
        `[DistributedLock] Failed to acquire lock for ${resourceId} after ${attempts} attempts`
      );
    }

    return { acquired: false };
  }

  /**
   * Release lock for a resource
   * Only releases if token matches (prevents accidental release by other processes)
   */
  async release(resourceId: string, token?: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceId);

    // If Redis is unavailable, nothing to release
    if (!this.redis) {
      return true;
    }

    // Get token from our acquired locks if not provided
    const lockToken = token || this.acquiredLocks.get(lockKey);
    if (!lockToken) {
      console.warn(
        `[DistributedLock] No token found for ${resourceId}, cannot release`
      );
      return false;
    }

    try {
      // Use Lua script to atomically check token and delete
      // This prevents releasing a lock that was acquired by another process
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(script, 1, lockKey, lockToken);

      const released = result === 1;

      if (released) {
        this.acquiredLocks.delete(lockKey);
        console.log(`[DistributedLock] Released lock for ${resourceId}`);
      } else {
        console.warn(
          `[DistributedLock] Failed to release lock for ${resourceId} (token mismatch or expired)`
        );
      }

      return released;
    } catch (error) {
      console.error(
        `[DistributedLock] Error releasing lock for ${resourceId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Extend lock expiration (for long-running operations)
   * Returns true if extension successful
   */
  async extendLock(
    resourceId: string,
    token: string,
    additionalTtl: number
  ): Promise<boolean> {
    const lockKey = this.getLockKey(resourceId);

    if (!this.redis) {
      return true; // Graceful degradation
    }

    try {
      // Use Lua script to atomically check token and extend expiry
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await this.redis.eval(
        script,
        1,
        lockKey,
        token,
        additionalTtl
      );

      const extended = result === 1;

      if (extended) {
        console.log(
          `[DistributedLock] Extended lock for ${resourceId} by ${additionalTtl}ms`
        );
      } else {
        console.warn(
          `[DistributedLock] Failed to extend lock for ${resourceId} (token mismatch or expired)`
        );
      }

      return extended;
    } catch (error) {
      console.error(
        `[DistributedLock] Error extending lock for ${resourceId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if lock is currently held
   */
  async isLocked(resourceId: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceId);

    if (!this.redis) {
      return false;
    }

    try {
      const exists = await this.redis.exists(lockKey);
      return exists === 1;
    } catch (error) {
      console.error(
        `[DistributedLock] Error checking lock for ${resourceId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Get remaining TTL for lock in milliseconds
   * Returns -1 if lock doesn't exist
   */
  async getLockTTL(resourceId: string): Promise<number> {
    const lockKey = this.getLockKey(resourceId);

    if (!this.redis) {
      return -1;
    }

    try {
      const ttl = await this.redis.pttl(lockKey);
      return ttl;
    } catch (error) {
      console.error(
        `[DistributedLock] Error getting TTL for ${resourceId}:`,
        error
      );
      return -1;
    }
  }

  /**
   * Force release lock (admin operation)
   * ⚠️ Use with caution - ignores token validation
   */
  async forceRelease(resourceId: string): Promise<boolean> {
    const lockKey = this.getLockKey(resourceId);

    if (!this.redis) {
      return true;
    }

    try {
      const result = await this.redis.del(lockKey);
      const released = result === 1;

      if (released) {
        this.acquiredLocks.delete(lockKey);
        console.warn(
          `[DistributedLock] Force released lock for ${resourceId}`
        );
      }

      return released;
    } catch (error) {
      console.error(
        `[DistributedLock] Error force releasing lock for ${resourceId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Release all locks acquired by this instance
   * Call during graceful shutdown
   */
  async releaseAll(): Promise<void> {
    console.log(
      `[DistributedLock] Releasing ${this.acquiredLocks.size} locks...`
    );

    for (const [lockKey, token] of this.acquiredLocks.entries()) {
      const resourceId = lockKey.replace('lock:resource:', '');
      await this.release(resourceId, token);
    }

    this.acquiredLocks.clear();
  }

  /**
   * Execute function with automatic lock management
   * Ensures lock is always released, even if operation fails
   */
  async withLock<T>(
    resourceId: string,
    fn: () => Promise<T>,
    config: LockConfig = {}
  ): Promise<T | null> {
    const lockResult = await this.acquire(resourceId, config);

    if (!lockResult.acquired) {
      console.warn(
        `[DistributedLock] Could not acquire lock for ${resourceId}, skipping operation`
      );
      return null;
    }

    try {
      const result = await fn();
      return result;
    } finally {
      if (lockResult.token) {
        await this.release(resourceId, lockResult.token);
      }
    }
  }

  /**
   * Get lock key for Redis
   */
  private getLockKey(resourceId: string): string {
    return `lock:resource:${resourceId}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper function to create lock instance
 */
export function createDistributedLock(redis: Redis | null): DistributedLock {
  return new DistributedLock(redis);
}

/**
 * Global lock configuration defaults
 */
export const LOCK_DEFAULTS = {
  IPO_UPDATE_TTL: 5000, // 5 seconds for IPO updates
  SCRAPER_RUN_TTL: 30000, // 30 seconds for full scraper run
  CONSOLIDATION_TTL: 10000, // 10 seconds for consolidation
  RETRY_ATTEMPTS: 3, // 3 retry attempts
  RETRY_DELAY: 200, // 200ms between retries
} as const;

/**
 * Export types for external use
 */
export type { LockResult, LockConfig };
