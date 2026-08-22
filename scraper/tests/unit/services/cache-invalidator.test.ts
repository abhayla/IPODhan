import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invalidateIPOCaches,
  invalidateSubscriptionCache,
  invalidateHistoryCache,
} from '../../../src/services/cache-invalidator';

// Mock Redis client
const mockRedis = {
  del: vi.fn().mockResolvedValue(1),
  scan: vi.fn()
};

describe('cache-invalidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('invalidateIPOCaches', () => {
    it('should delete specific IPO cache keys', async () => {
      // Mock SCAN to return empty result (no pattern matches)
      mockRedis.scan.mockResolvedValueOnce(['0', []]);

      await invalidateIPOCaches(mockRedis as any, 'test-company-slug');

      // Should delete specific keys
      expect(mockRedis.del).toHaveBeenCalledWith(
        'ipo:detail:test-company-slug',
        'ipo:slug:test-company-slug'
      );
    });

    it('should delete pattern-based cache keys', async () => {
      // Mock SCAN results for pattern matching
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['ipo:list:hash1', 'ipo:list:hash2']]) // First pattern
        .mockResolvedValueOnce(['0', ['ipo:search:hash3']]) // Second pattern
        .mockResolvedValueOnce(['0', []]); // Third pattern (empty)

      await invalidateIPOCaches(mockRedis as any, 'test-company-slug');

      // Should delete pattern-matched keys
      expect(mockRedis.del).toHaveBeenCalledWith('ipo:list:hash1', 'ipo:list:hash2');
      expect(mockRedis.del).toHaveBeenCalledWith('ipo:search:hash3');
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));

      // Should not throw error
      await expect(invalidateIPOCaches(mockRedis as any, 'test-slug')).resolves.toBeUndefined();
    });
  });

  describe('invalidateSubscriptionCache', () => {
    it('should delete subscription cache keys', async () => {
      // Mock SCAN to return subscription history keys
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        ['subscription:history:ipoId123:7', 'subscription:history:ipoId123:30']
      ]);

      await invalidateSubscriptionCache(mockRedis as any, 'ipoId123');

      // Should delete specific key
      expect(mockRedis.del).toHaveBeenCalledWith('subscription:latest:ipoId123');

      // Should delete history keys
      expect(mockRedis.del).toHaveBeenCalledWith(
        'subscription:history:ipoId123:7',
        'subscription:history:ipoId123:30'
      );
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.scan.mockRejectedValueOnce(new Error('Redis scan error'));

      // Should not throw error
      await expect(invalidateSubscriptionCache(mockRedis as any, 'ipoId')).resolves.toBeUndefined();
    });
  });

  describe('invalidateHistoryCache', () => {
    // F1 (T-264 P1-4): the job writing listing_performance never purged this
    // pattern, so /history could serve a stale (up to 24h) snapshot missing
    // the newest listings and their gain figures.
    it('should delete every ipos:history:* key via SCAN', async () => {
      mockRedis.scan.mockResolvedValueOnce([
        '0',
        ['ipos:history:All:All:All:listing_date:desc:1:20', 'ipos:history:All:All:All:listing_date:desc:1:40'],
      ]);

      await invalidateHistoryCache(mockRedis as any);

      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'ipos:history:*', 'COUNT', 100);
      expect(mockRedis.del).toHaveBeenCalledWith(
        'ipos:history:All:All:All:listing_date:desc:1:20',
        'ipos:history:All:All:All:listing_date:desc:1:40'
      );
    });

    it('should handle Redis errors gracefully (cache miss is acceptable)', async () => {
      mockRedis.scan.mockRejectedValueOnce(new Error('Redis scan error'));

      await expect(invalidateHistoryCache(mockRedis as any)).resolves.toBeUndefined();
    });
  });
});
