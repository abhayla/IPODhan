import type Redis from 'ioredis';
import logger from '../utils/logger.js';

/**
 * Lock metadata stored in Redis
 */
export interface LockInfo {
  jobName: string;
  acquiredAt: string;
  processId: string;
  ttl: number;
}

/**
 * Job Lock Manager
 * Manages distributed locks using Redis to prevent overlapping job executions
 *
 * Uses Redis SET NX EX for atomic lock acquisition with TTL
 * Locks automatically expire after TTL to prevent deadlocks
 */
export class JobLockManager {
  private redis: Redis;
  private processId: string;
  private heldLocks: Set<string> = new Set();

  constructor(redis: Redis, processId = 'scraper-worker-1') {
    this.redis = redis;
    this.processId = processId;
  }

  /**
   * Acquire lock for job execution
   * @param jobName - Unique job identifier
   * @param ttl - Time to live in seconds
   * @returns true if lock acquired, false if already locked
   */
  async acquireLock(jobName: string, ttl: number): Promise<boolean> {
    try {
      const lockKey = this.getLockKey(jobName);
      const lockValue = this.createLockValue(jobName, ttl);

      // Use SET NX EX for atomic lock acquisition with TTL
      // Returns 'OK' if lock acquired, null if already exists
      const result = await this.redis.set(
        lockKey,
        JSON.stringify(lockValue),
        'EX',
        ttl,
        'NX'
      );

      const acquired = result === 'OK';

      if (acquired) {
        this.heldLocks.add(jobName);
        logger.debug({
          jobName,
          lockKey,
          ttl,
          processId: this.processId
        }, 'Lock acquired');
      } else {
        logger.warn({
          jobName,
          lockKey,
          processId: this.processId
        }, 'Lock acquisition failed - already held');
      }

      return acquired;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        jobName,
        processId: this.processId
      }, 'Failed to acquire lock');

      // On Redis failure, allow job to run (risky but acceptable)
      // Better to run job without lock than skip it entirely
      return true;
    }
  }

  /**
   * Release lock after job completion
   * @param jobName - Unique job identifier
   */
  async releaseLock(jobName: string): Promise<void> {
    try {
      const lockKey = this.getLockKey(jobName);

      // Delete lock key
      const deleted = await this.redis.del(lockKey);

      if (deleted > 0) {
        this.heldLocks.delete(jobName);
        logger.debug({
          jobName,
          lockKey,
          processId: this.processId
        }, 'Lock released');
      } else {
        logger.warn({
          jobName,
          lockKey,
          processId: this.processId
        }, 'Lock release - key not found (may have expired)');
      }
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        jobName,
        processId: this.processId
      }, 'Failed to release lock');

      // Log error but don't throw - Redis TTL will expire lock eventually
    }
  }

  /**
   * Check if job is currently locked
   * @param jobName - Unique job identifier
   * @returns true if locked, false otherwise
   */
  async isLocked(jobName: string): Promise<boolean> {
    try {
      const lockKey = this.getLockKey(jobName);
      const exists = await this.redis.exists(lockKey);
      return exists === 1;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        jobName
      }, 'Failed to check lock status');
      return false;
    }
  }

  /**
   * Get lock metadata (who holds lock, when acquired)
   * @param jobName - Unique job identifier
   * @returns Lock info or null if not locked
   */
  async getLockInfo(jobName: string): Promise<LockInfo | null> {
    try {
      const lockKey = this.getLockKey(jobName);
      const value = await this.redis.get(lockKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value) as LockInfo;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        jobName
      }, 'Failed to get lock info');
      return null;
    }
  }

  /**
   * Release all locks held by this process
   * Called during graceful shutdown
   */
  async releaseAllLocks(): Promise<void> {
    logger.info({
      lockCount: this.heldLocks.size,
      processId: this.processId
    }, 'Releasing all held locks');

    const releasePromises = Array.from(this.heldLocks).map(jobName =>
      this.releaseLock(jobName)
    );

    await Promise.allSettled(releasePromises);

    logger.info({
      processId: this.processId
    }, 'All locks released');
  }

  /**
   * Get Redis lock key for job
   * @param jobName - Unique job identifier
   * @returns Redis key for lock
   */
  private getLockKey(jobName: string): string {
    return `scheduler:lock:${jobName}`;
  }

  /**
   * Create lock value with metadata
   * @param jobName - Unique job identifier
   * @param ttl - Time to live in seconds
   * @returns Lock metadata object
   */
  private createLockValue(jobName: string, ttl: number): LockInfo {
    return {
      jobName,
      acquiredAt: new Date().toISOString(),
      processId: this.processId,
      ttl
    };
  }
}
