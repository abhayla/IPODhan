/**
 * Tier A round 2 M1, proven on a REAL Redis: 50 concurrent sign-in attempts at one email key allow
 * exactly 10. The old count-then-add limiter let every concurrent caller read the same count before
 * any of them added, so all 50 passed. The stored set is read back through the app's own client (it
 * applies the slot's key prefix, which ioredis also applies to EVAL's KEYS).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { getRedisClient } from '@/lib/cache/redis-client';

const endpoint = `admin-login-email:itest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const key = `ratelimit:${endpoint}:any-ip`;
const cfg = { maxRequests: 10, windowSeconds: 900 };

describe('checkRateLimit on real Redis', () => {
  afterAll(async () => {
    await getRedisClient().del(key);
  });

  it('50 concurrent attempts allow exactly 10, and exactly 10 are stored', async () => {
    // Fail loudly (not open) if Redis is unreachable: default onStoreError is 'allow', which would
    // make all 50 pass and the assertion below fail, so an absent Redis cannot pass this test.
    const results = await Promise.all(Array.from({ length: 50 }, () => checkRateLimit('any-ip', endpoint, cfg)));
    // Exactly the 10 admitted attempts are stored; refused attempts add nothing.
    const stored = await getRedisClient().zcard(key);
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(stored).toBe(10);
    const ttl = await getRedisClient().pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900_000);
  });
});
