/**
 * Tier A review M2: the admin sign-in limiter must not fail open when Redis is down. With
 * onStoreError: 'local' the same limit is enforced by an in-process counter; the default stays open.
 * Tier A round 2 M1: the Redis path is ONE atomic EVAL (no separate count-then-add calls), and its
 * error log never carries the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisMode = { current: 'down' as 'down' | 'fake' };
const calls: string[] = [];
// A fake Redis whose EVAL runs the script's contract as one uninterruptible step, the way Redis runs
// a Lua script. Any other command is recorded so the test can prove the limiter does not use it.
const zsets = new Map<string, Map<string, number>>();
function fakeEval(_script: string, _n: number, key: string, now: string, windowMs: string, limit: string, member: string) {
  const set = zsets.get(key) ?? new Map<string, number>();
  for (const [m, score] of set) if (score <= Number(now) - Number(windowMs)) set.delete(m);
  let count = set.size;
  let allowed = 0;
  if (count < Number(limit)) {
    set.set(member, Number(now));
    count += 1;
    allowed = 1;
  }
  zsets.set(key, set);
  return [allowed, count, Math.min(...set.values(), Number(now))];
}
const logged: unknown[] = [];
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: () =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => async (...args: unknown[]) => {
          calls.push(prop);
          if (redisMode.current === 'down') throw new Error('redis down');
          if (prop === 'eval') {
            await new Promise((r) => setTimeout(r, Math.random() * 3));
            return fakeEval(...(args as Parameters<typeof fakeEval>));
          }
          throw new Error(`limiter must not call ${prop}`);
        },
      }
    ),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn((...a: unknown[]) => logged.push(a)), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { checkRateLimit, resetLocalRateLimitCounters, SLIDING_WINDOW_SCRIPT } from '@/lib/middleware/rate-limiter';

const LIMIT = { maxRequests: 3, windowSeconds: 900 };

describe('rate limiter when Redis is unreachable', () => {
  beforeEach(() => {
    redisMode.current = 'down';
    resetLocalRateLimitCounters();
    logged.length = 0;
  });

  it("enforces the limit locally with onStoreError: 'local'", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push((await checkRateLimit('any-ip', 'admin-login-email:abc123', { ...LIMIT, onStoreError: 'local' })).allowed);
    }
    expect(results).toEqual([true, true, true, false, false]);
    // A different key has its own count.
    expect((await checkRateLimit('any-ip', 'admin-login-email:def456', { ...LIMIT, onStoreError: 'local' })).allowed).toBe(true);
  });

  it('still fails open by default (public endpoints unchanged)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit('1.2.3.4', '/api/ipos', LIMIT)).allowed).toBe(true);
    }
  });

  it('logs the failure without the Redis key or the caller ip', async () => {
    await checkRateLimit('198.51.100.7', 'admin-login-ip', { ...LIMIT, onStoreError: 'local' });
    expect(logged.length).toBeGreaterThan(0);
    const text = JSON.stringify(logged);
    expect(text).not.toContain('ratelimit:');
    expect(text).not.toContain('198.51.100.7');
  });
});

describe('rate limiter on Redis: one atomic step', () => {
  beforeEach(() => {
    redisMode.current = 'fake';
    calls.length = 0;
    zsets.clear();
  });

  it('50 concurrent attempts at one key allow exactly the limit (10)', async () => {
    const cfg = { maxRequests: 10, windowSeconds: 900, onStoreError: 'local' as const };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => checkRateLimit('any-ip', 'admin-login-email:concurrent', cfg))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(new Set(calls)).toEqual(new Set(['eval']));
  });

  it('the script prunes, counts, and adds inside the one call, adding only below the limit', () => {
    const order = ['ZREMRANGEBYSCORE', 'ZCARD', 'if count < limit', 'ZADD', 'PEXPIRE'].map((s) =>
      SLIDING_WINDOW_SCRIPT.indexOf(s)
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
