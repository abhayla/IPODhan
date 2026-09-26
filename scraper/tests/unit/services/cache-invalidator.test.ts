import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  invalidateIPOCaches,
  invalidateSubscriptionCache,
  invalidateHistoryCache,
} from '../../../src/services/cache-invalidator';
import { getIPOBySlugKey, getIPOByIdKey } from '@ipodhan/shared/cache/cache-keys';

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
    it('should delete specific IPO cache keys, including ipo:id:<id> — #551 round 2', async () => {
      // Mock SCAN to return empty result (no pattern matches)
      mockRedis.scan.mockResolvedValueOnce(['0', []]);

      await invalidateIPOCaches(mockRedis as any, 'ipo-1', 'test-company-slug');

      // #551 round 2: this used to take only a slug and never cleared
      // ipo:id:<id> at all — the key IPORepository.findById() actually caches
      // under. Detection: derived from the SAME shared key generators the
      // reader uses, not hand-typed strings, so drift fails this directly.
      expect(mockRedis.del).toHaveBeenCalledWith(
        getIPOByIdKey('ipo-1'),
        getIPOBySlugKey('test-company-slug'),
        'ipo:detail:test-company-slug'
      );
    });

    it('should delete pattern-based cache keys, incl. the ipos:history:* pattern getIPOInvalidationKeys does not cover', async () => {
      // Mock SCAN results for pattern matching
      mockRedis.scan
        .mockResolvedValueOnce(['0', ['ipo:list:hash1', 'ipo:list:hash2']]) // First pattern
        .mockResolvedValueOnce(['0', ['ipo:search:hash3']]) // Second pattern
        .mockResolvedValueOnce(['0', []]); // Third pattern (ipos:history:*, empty)

      await invalidateIPOCaches(mockRedis as any, 'ipo-1', 'test-company-slug');

      // Should delete pattern-matched keys
      expect(mockRedis.del).toHaveBeenCalledWith('ipo:list:hash1', 'ipo:list:hash2');
      expect(mockRedis.del).toHaveBeenCalledWith('ipo:search:hash3');
      expect(mockRedis.scan).toHaveBeenCalledWith('0', 'MATCH', 'ipos:history:*', 'COUNT', 100);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));

      // Should not throw error
      await expect(invalidateIPOCaches(mockRedis as any, 'ipo-1', 'test-slug')).resolves.toBeUndefined();
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
