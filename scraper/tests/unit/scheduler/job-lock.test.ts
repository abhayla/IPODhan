import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobLockManager } from '../../../src/scheduler/job-lock.js';
import type Redis from 'ioredis';

describe('JobLockManager', () => {
  let mockRedis: Partial<Redis>;
  let lockManager: JobLockManager;

  beforeEach(() => {
    // Mock Redis client
    mockRedis = {
      set: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
      get: vi.fn()
    };

    lockManager = new JobLockManager(mockRedis as Redis, 'test-process');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('acquireLock', () => {
    it('should acquire lock when available', async () => {
      (mockRedis.set as any).mockResolvedValue('OK');

      const acquired = await lockManager.acquireLock('test-job', 300);

      expect(acquired).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'scheduler:lock:test-job',
        expect.any(String),
        'EX',
        300,
        'NX'
      );
    });

    it('should fail to acquire lock when already held', async () => {
      (mockRedis.set as any).mockResolvedValue(null);

      const acquired = await lockManager.acquireLock('test-job', 300);

      expect(acquired).toBe(false);
    });

    it('should handle Redis errors gracefully', async () => {
      (mockRedis.set as any).mockRejectedValue(new Error('Redis error'));

      const acquired = await lockManager.acquireLock('test-job', 300);

      // Should return true to allow job to run without lock (better than skipping)
      expect(acquired).toBe(true);
    });
  });

  describe('releaseLock', () => {
    it('should release lock successfully', async () => {
      (mockRedis.del as any).mockResolvedValue(1);

      await lockManager.releaseLock('test-job');

      expect(mockRedis.del).toHaveBeenCalledWith('scheduler:lock:test-job');
    });

    it('should handle lock release when key not found', async () => {
      (mockRedis.del as any).mockResolvedValue(0);

      await expect(lockManager.releaseLock('test-job')).resolves.not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('should return true when lock exists', async () => {
      (mockRedis.exists as any).mockResolvedValue(1);

      const locked = await lockManager.isLocked('test-job');

      expect(locked).toBe(true);
    });

    it('should return false when lock does not exist', async () => {
      (mockRedis.exists as any).mockResolvedValue(0);

      const locked = await lockManager.isLocked('test-job');

      expect(locked).toBe(false);
    });
  });

  describe('getLockInfo', () => {
    it('should return lock info when lock exists', async () => {
      const lockInfo = {
        jobName: 'test-job',
        acquiredAt: '2025-10-07T10:00:00.000Z',
        processId: 'test-process',
        ttl: 300
      };
      (mockRedis.get as any).mockResolvedValue(JSON.stringify(lockInfo));

      const info = await lockManager.getLockInfo('test-job');

      expect(info).toEqual(lockInfo);
    });

    it('should return null when lock does not exist', async () => {
      (mockRedis.get as any).mockResolvedValue(null);

      const info = await lockManager.getLockInfo('test-job');

      expect(info).toBe(null);
    });
  });

  describe('releaseAllLocks', () => {
    it('should release all held locks', async () => {
      (mockRedis.set as any).mockResolvedValue('OK');
      (mockRedis.del as any).mockResolvedValue(1);

      // Acquire two locks
      await lockManager.acquireLock('job1', 300);
      await lockManager.acquireLock('job2', 300);

      await lockManager.releaseAllLocks();

      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });
  });
});
