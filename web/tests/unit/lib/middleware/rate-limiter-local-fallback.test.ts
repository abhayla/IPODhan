/**
 * Tier A review M2: the admin sign-in limiter must not fail open when Redis is down. With
 * onStoreError: 'local' the same limit is enforced by an in-process counter; the default stays open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: () => ({
    zremrangebyscore: async () => {
      throw new Error('redis down');
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

import { checkRateLimit, resetLocalRateLimitCounters } from '@/lib/middleware/rate-limiter';

const LIMIT = { maxRequests: 3, windowSeconds: 900 };

describe('rate limiter when Redis is unreachable', () => {
  beforeEach(() => resetLocalRateLimitCounters());

  it("enforces the limit locally with onStoreError: 'local'", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push((await checkRateLimit('any-ip', 'admin-login-email:a@b.co', { ...LIMIT, onStoreError: 'local' })).allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
    // A different key has its own count.
    expect((await checkRateLimit('any-ip', 'admin-login-email:c@d.co', { ...LIMIT, onStoreError: 'local' })).allowed).toBe(true);
  });

  it('still fails open by default (public endpoints unchanged)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('1.2.3.4', '/api/ipos', LIMIT)).allowed).toBe(true);
    }
  });
});
