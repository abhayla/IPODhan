/**
 * Round-3 M2 (Tier-A review of round 1): `shouldRunOnCatchUpCadence` stamps the
 * cadence key at CHECK time, so a kill (PM2 restarts the scraper every 30 min)
 * or a throw between the stamp and the job finishing skipped that job for the
 * whole 24h interval. The due-step cycle now uses the read-only
 * `isCatchUpCadenceDue` before the work and `markCatchUpCadenceRan` only after
 * it succeeds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isCatchUpCadenceDue,
  markCatchUpCadenceRan,
  shouldRunOnCatchUpCadence,
} from '../../../src/scheduler/catch-up-cadence.js';

function makeRedis(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    get: vi.fn(async (key: string) => store[key] ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store[key] = value;
      return 'OK';
    }),
    eval: vi.fn(async () => 1),
  } as any;
}

const KEY = 'scheduler:last-run:due-step-aggregators';
const DAY_MINUTES = 24 * 60;

describe('round-3 M2: isDue is read-only; markRan is the explicit stamp', () => {
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    redis = makeRedis();
  });

  it('isCatchUpCadenceDue writes nothing — a throw right after it leaves the key unstamped', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');

    const due = await isCatchUpCadenceDue(redis, 'due-step-aggregators', DAY_MINUTES, now);
    expect(due).toBe(true);

    // The job throws before markCatchUpCadenceRan is ever reached.
    await expect(
      (async () => {
        throw new Error('Moneycontrol timed out');
      })()
    ).rejects.toThrow('Moneycontrol timed out');

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store[KEY]).toBeUndefined();
    // ...so the very next cycle still sees the job as due.
    expect(await isCatchUpCadenceDue(redis, 'due-step-aggregators', DAY_MINUTES, now)).toBe(true);
  });

  it('markCatchUpCadenceRan stamps the key, and the next check inside the interval is not due', async () => {
    const now = new Date('2026-09-03T10:00:00.000Z');
    await markCatchUpCadenceRan(redis, 'due-step-aggregators', DAY_MINUTES, now);

    expect(redis.store[KEY]).toBe(String(now.getTime()));
    expect(await isCatchUpCadenceDue(redis, 'due-step-aggregators', DAY_MINUTES, new Date(now.getTime() + 60_000))).toBe(false);
    // ...and due again once the interval has elapsed.
    expect(
      await isCatchUpCadenceDue(redis, 'due-step-aggregators', DAY_MINUTES, new Date(now.getTime() + DAY_MINUTES * 60_000))
    ).toBe(true);
  });

  it('the OLD combined call stamps at check time — the exact behaviour M2 replaces', async () => {
    const evalRedis = makeRedis();
    await shouldRunOnCatchUpCadence(evalRedis, 'due-step-aggregators', DAY_MINUTES, new Date());
    // One atomic Lua call that both reads AND writes: nothing the caller can do
    // after it can un-stamp the key if the work then dies.
    expect(evalRedis.eval).toHaveBeenCalledTimes(1);
  });

  it('both halves fail OPEN when Redis is down (due = true, mark is swallowed)', async () => {
    const brokenRedis = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as any;

    expect(await isCatchUpCadenceDue(brokenRedis, 'due-step-aggregators', DAY_MINUTES)).toBe(true);
    await expect(markCatchUpCadenceRan(brokenRedis, 'due-step-aggregators', DAY_MINUTES)).resolves.toBeUndefined();
  });
});
