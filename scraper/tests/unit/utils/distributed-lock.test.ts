/**
 * Unit Tests: Distributed Lock
 * Tests Redis-based mutex pattern for race condition prevention
 *
 * Test Coverage:
 * 1. Lock Acquisition (5 tests)
 * 2. Lock Release (5 tests)
 * 3. Race Condition Prevention (5 tests)
 *
 * Total: 15 tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  DistributedLock,
  createDistributedLock,
  LOCK_DEFAULTS,
  type LockResult,
  type LockConfig,
} from '../../../src/utils/distributed-lock.js';

// ==================== TEST SUITE ====================

describe('DistributedLock - Unit Tests', () => {
  let mockRedis: any; // Use 'any' to allow mock methods
  let lock: DistributedLock;

  beforeEach(() => {
    // Create mock Redis instance with all necessary methods
    mockRedis = {
      set: vi.fn(),
      get: vi.fn(),
      del: vi.fn(),
      eval: vi.fn(),
      exists: vi.fn(),
      pttl: vi.fn(),
      pexpire: vi.fn(),
    };
    lock = new DistributedLock(mockRedis);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ==================== 1. LOCK ACQUISITION TESTS ====================

  describe('1. Lock Acquisition', () => {
    it('should successfully acquire lock and return token', async () => {
      // Arrange
      const resourceId = 'test-ipo-123';
      mockRedis.set.mockResolvedValue('OK' as any);

      // Act
      const result = await lock.acquire(resourceId);

      // Assert
      expect(result.acquired).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(result.expiresAt).toBeGreaterThan(Date.now());

      // Verify Redis SET call with correct parameters
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:resource:test-ipo-123',
        result.token,
        'PX',
        10000, // Default TTL
        'NX'
      );
    });

    it('should fail to acquire lock if already held (lock contention)', async () => {
      // Arrange
      const resourceId = 'test-ipo-456';
      mockRedis.set.mockResolvedValue(null as any); // Lock already held

      // Act
      const result = await lock.acquire(resourceId);

      // Assert
      expect(result.acquired).toBe(false);
      expect(result.token).toBeUndefined();
      expect(result.expiresAt).toBeUndefined();
    });

    it('should retry acquisition with configured retry attempts', async () => {
      // Arrange
      const resourceId = 'test-ipo-789';
      const config: LockConfig = {
        retryAttempts: 2,
        retryDelay: 50,
      };

      // First two attempts fail, third succeeds
      mockRedis.set
        .mockResolvedValueOnce(null as any) // Attempt 1: fail
        .mockResolvedValueOnce(null as any) // Attempt 2: fail
        .mockResolvedValueOnce('OK' as any); // Attempt 3: success

      // Act
      const result = await lock.acquire(resourceId, config);

      // Assert
      expect(result.acquired).toBe(true);
      expect(result.token).toBeDefined();
      expect(mockRedis.set).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should gracefully degrade if Redis is unavailable', async () => {
      // Arrange
      const lockWithoutRedis = new DistributedLock(null);
      const resourceId = 'test-ipo-no-redis';

      // Act
      const result = await lockWithoutRedis.acquire(resourceId);

      // Assert
      expect(result.acquired).toBe(true); // Allow operation
      expect(result.token).toBeDefined();
      expect(result.expiresAt).toBeUndefined();
    });

    it('should use custom TTL when provided', async () => {
      // Arrange
      const resourceId = 'test-ipo-custom-ttl';
      const customTtl = 30000; // 30 seconds
      const config: LockConfig = { ttl: customTtl };
      mockRedis.set.mockResolvedValue('OK' as any);

      // Act
      const result = await lock.acquire(resourceId, config);

      // Assert
      expect(result.acquired).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'lock:resource:test-ipo-custom-ttl',
        result.token,
        'PX',
        customTtl,
        'NX'
      );
    });
  });

  // ==================== 2. LOCK RELEASE TESTS ====================

  describe('2. Lock Release', () => {
    it('should successfully release lock with correct token', async () => {
      // Arrange
      const resourceId = 'test-ipo-release';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any); // Lua script returns 1 (success)

      // Acquire lock first
      const acquireResult = await lock.acquire(resourceId);
      expect(acquireResult.acquired).toBe(true);

      // Act
      const released = await lock.release(resourceId, acquireResult.token);

      // Assert
      expect(released).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("get", KEYS[1])'),
        1,
        'lock:resource:test-ipo-release',
        acquireResult.token
      );
    });

    it('should fail to release lock with wrong token', async () => {
      // Arrange
      const resourceId = 'test-ipo-wrong-token';
      mockRedis.eval.mockResolvedValue(0 as any); // Lua script returns 0 (failure)

      // Act
      const wrongToken = 'incorrect-token-uuid';
      const released = await lock.release(resourceId, wrongToken);

      // Assert
      expect(released).toBe(false);
    });

    it('should handle release of already released/expired lock', async () => {
      // Arrange
      const resourceId = 'test-ipo-expired';
      mockRedis.eval.mockResolvedValue(0 as any); // Lock doesn't exist

      // Act
      const released = await lock.release(resourceId, 'some-token');

      // Assert
      expect(released).toBe(false); // Cannot release expired lock
    });

    it('should release lock without explicit token (uses internal tracking)', async () => {
      // Arrange
      const resourceId = 'test-ipo-internal-token';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      // Acquire lock
      const acquireResult = await lock.acquire(resourceId);
      expect(acquireResult.acquired).toBe(true);

      // Act - Release without providing token
      const released = await lock.release(resourceId);

      // Assert
      expect(released).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'lock:resource:test-ipo-internal-token',
        acquireResult.token // Should use tracked token
      );
    });

    it('should gracefully handle Redis failure during release', async () => {
      // Arrange
      const resourceId = 'test-ipo-redis-error';
      mockRedis.eval.mockRejectedValue(new Error('Redis connection lost'));

      // Act
      const released = await lock.release(resourceId, 'some-token');

      // Assert
      expect(released).toBe(false); // Error results in failed release
    });
  });

  // ==================== 3. RACE CONDITION PREVENTION TESTS ====================

  describe('3. Race Condition Prevention', () => {
    it('should prevent concurrent lock acquisition (simulated race)', async () => {
      // Arrange
      const resourceId = 'test-ipo-race';
      let lockCount = 0;

      // Simulate two processes trying to acquire lock simultaneously
      mockRedis.set.mockImplementation(() => {
        lockCount++;
        if (lockCount === 1) {
          return Promise.resolve('OK' as any); // First process wins
        }
        return Promise.resolve(null as any); // Second process fails
      });

      // Act - Simulate concurrent calls
      const [result1, result2] = await Promise.all([
        lock.acquire(resourceId),
        lock.acquire(resourceId),
      ]);

      // Assert
      expect(result1.acquired).toBe(true); // First process acquires lock
      expect(result2.acquired).toBe(false); // Second process fails
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });

    it('should extend lock for long-running operations', async () => {
      // Arrange
      const resourceId = 'test-ipo-long-operation';
      const token = 'test-token-uuid';
      const additionalTtl = 5000; // 5 more seconds
      mockRedis.eval.mockResolvedValue(1 as any); // Lua script returns 1 (success)

      // Act
      const extended = await lock.extendLock(resourceId, token, additionalTtl);

      // Assert
      expect(extended).toBe(true);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('redis.call("pexpire", KEYS[1], ARGV[2])'),
        1,
        'lock:resource:test-ipo-long-operation',
        token,
        additionalTtl
      );
    });

    it('should automatically expire lock after TTL', async () => {
      // Arrange
      const resourceId = 'test-ipo-auto-expire';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.pttl
        .mockResolvedValueOnce(5000) // 5 seconds remaining
        .mockResolvedValueOnce(2000) // 2 seconds remaining
        .mockResolvedValueOnce(-2); // Expired (Redis returns -2 for expired keys)

      // Act
      await lock.acquire(resourceId, { ttl: 5000 });
      const ttl1 = await lock.getLockTTL(resourceId);
      const ttl2 = await lock.getLockTTL(resourceId);
      const ttl3 = await lock.getLockTTL(resourceId);

      // Assert
      expect(ttl1).toBe(5000);
      expect(ttl2).toBe(2000);
      expect(ttl3).toBe(-2); // Lock expired
    });

    it('should prevent accidental release with token validation', async () => {
      // Arrange
      const resourceId = 'test-ipo-token-validation';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval
        .mockResolvedValueOnce(0) // First attempt: wrong token
        .mockResolvedValueOnce(1); // Second attempt: correct token

      // Acquire lock
      const acquireResult = await lock.acquire(resourceId);
      const correctToken = acquireResult.token!;
      const wrongToken = 'wrong-token-uuid';

      // Act
      const releaseWrong = await lock.release(resourceId, wrongToken);
      const releaseCorrect = await lock.release(resourceId, correctToken);

      // Assert
      expect(releaseWrong).toBe(false); // Wrong token rejected
      expect(releaseCorrect).toBe(true); // Correct token accepted
    });

    it('should use withLock wrapper for automatic lock management', async () => {
      // Arrange
      const resourceId = 'test-ipo-with-lock';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      let operationExecuted = false;
      const operation = async () => {
        operationExecuted = true;
        return 'success';
      };

      // Act
      const result = await lock.withLock(resourceId, operation);

      // Assert
      expect(result).toBe('success');
      expect(operationExecuted).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledTimes(1); // Acquire
      expect(mockRedis.eval).toHaveBeenCalledTimes(1); // Release
    });
  });

  // ==================== ADDITIONAL UTILITY TESTS ====================

  describe('4. Additional Utilities', () => {
    it('should check if resource is locked', async () => {
      // Arrange
      const resourceId = 'test-ipo-is-locked';
      mockRedis.exists
        .mockResolvedValueOnce(1) // Lock exists
        .mockResolvedValueOnce(0); // Lock doesn't exist

      // Act
      const isLocked1 = await lock.isLocked(resourceId);
      const isLocked2 = await lock.isLocked(resourceId);

      // Assert
      expect(isLocked1).toBe(true);
      expect(isLocked2).toBe(false);
    });

    it('should force release lock (admin operation)', async () => {
      // Arrange
      const resourceId = 'test-ipo-force-release';
      mockRedis.del.mockResolvedValue(1 as any); // 1 key deleted

      // Act
      const released = await lock.forceRelease(resourceId);

      // Assert
      expect(released).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('lock:resource:test-ipo-force-release');
    });

    it('should release all locks on cleanup', async () => {
      // Arrange
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      // Acquire multiple locks
      await lock.acquire('ipo-1');
      await lock.acquire('ipo-2');
      await lock.acquire('ipo-3');

      // Act
      await lock.releaseAll();

      // Assert
      expect(mockRedis.eval).toHaveBeenCalledTimes(3); // 3 release calls
    });

    it('should handle withLock failure and still release lock', async () => {
      // Arrange
      const resourceId = 'test-ipo-with-lock-error';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      const failingOperation = async () => {
        throw new Error('Operation failed');
      };

      // Act & Assert
      await expect(lock.withLock(resourceId, failingOperation)).rejects.toThrow('Operation failed');

      // Verify lock was still released
      expect(mockRedis.eval).toHaveBeenCalledTimes(1); // Release called despite error
    });

    it('should return null from withLock if lock acquisition fails', async () => {
      // Arrange
      const resourceId = 'test-ipo-with-lock-no-acquire';
      mockRedis.set.mockResolvedValue(null as any); // Lock already held

      const operation = async () => 'should not execute';

      // Act
      const result = await lock.withLock(resourceId, operation);

      // Assert
      expect(result).toBeNull(); // Operation skipped
      expect(mockRedis.eval).not.toHaveBeenCalled(); // No release (lock not acquired)
    });
  });

  // ==================== PERFORMANCE BENCHMARKS ====================

  describe('5. Performance Benchmarks', () => {
    it('should acquire and release lock in <10ms (fast path)', async () => {
      // Arrange
      const resourceId = 'test-ipo-performance';
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      // Act
      const startTime = performance.now();
      const acquireResult = await lock.acquire(resourceId);
      await lock.release(resourceId, acquireResult.token);
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(10); // Should be very fast with mocks
    });

    it('should handle 100 concurrent lock operations', async () => {
      // Arrange
      mockRedis.set.mockResolvedValue('OK' as any);
      mockRedis.eval.mockResolvedValue(1 as any);

      // Act
      const startTime = performance.now();
      const operations = Array.from({ length: 100 }, (_, i) =>
        lock.withLock(`ipo-${i}`, async () => `result-${i}`)
      );
      const results = await Promise.all(operations);
      const duration = performance.now() - startTime;

      // Assert
      expect(results).toHaveLength(100);
      expect(results.every((r) => r !== null)).toBe(true);
      expect(duration).toBeLessThan(100); // Should complete in <100ms with mocks
    });
  });
});

// ==================== HELPER FUNCTION TESTS ====================

describe('createDistributedLock', () => {
  it('should create DistributedLock instance', () => {
    const mockRedis = new Redis();
    const lock = createDistributedLock(mockRedis);

    expect(lock).toBeInstanceOf(DistributedLock);
  });

  it('should create lock with null Redis (graceful degradation)', () => {
    const lock = createDistributedLock(null);

    expect(lock).toBeInstanceOf(DistributedLock);
  });
});

describe('LOCK_DEFAULTS', () => {
  it('should export default lock configurations', () => {
    expect(LOCK_DEFAULTS.IPO_UPDATE_TTL).toBe(5000);
    expect(LOCK_DEFAULTS.SCRAPER_RUN_TTL).toBe(30000);
    expect(LOCK_DEFAULTS.CONSOLIDATION_TTL).toBe(10000);
    expect(LOCK_DEFAULTS.RETRY_ATTEMPTS).toBe(3);
    expect(LOCK_DEFAULTS.RETRY_DELAY).toBe(200);
  });
});
