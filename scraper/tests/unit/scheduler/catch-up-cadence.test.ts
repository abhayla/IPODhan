import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldRunOnCatchUpCadence } from '../../../src/scheduler/catch-up-cadence.js';

// T-311F: shouldRunOnCatchUpCadence now does its read-check-write via a
// single `redis.eval(...)` Lua call instead of separate get/set calls (the
// checker's HARD^Wmedium finding: the old GET-then-SET was not actually
// atomic despite its own comment claiming it was). These mocks model `eval`
// directly rather than `get`/`set`.

/** In-memory store + a real (interpreted) copy of the Lua script's logic, so
 * the mock's behavior is a faithful stand-in for what Redis actually does
 * when it runs CADENCE_LUA to completion before serving the next command. */
function fakeRedisWithStore(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const evalFn = vi.fn(async (_script: string, _numKeys: number, key: string, nowStr: string, intervalMsStr: string, ttlStr: string) => {
    const lastRun = Number(store.get(key) ?? '0');
    const now = Number(nowStr);
    const intervalMs = Number(intervalMsStr);
    if (lastRun > 0 && now - lastRun < intervalMs) {
      return 0;
    }
    store.set(key, nowStr);
    void ttlStr; // TTL bookkeeping is not modeled — irrelevant to these assertions
    return 1;
  });
  return { eval: evalFn, store } as any;
}

/** A store-backed mock whose `eval` serializes concurrent callers through a
 * shared queue with a small artificial delay, mirroring how a real Redis
 * server executes each Lua script to completion, one at a time, before
 * starting the next — so two calls issued in the same JS tick for the SAME
 * key still only ever see a fully-applied prior write, never a torn one. */
function fakeRedisSerialized() {
  const store = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();
  const evalFn = vi.fn((_script: string, _numKeys: number, key: string, nowStr: string, intervalMsStr: string, ttlStr: string) => {
    const run = () => {
      const lastRun = Number(store.get(key) ?? '0');
      const now = Number(nowStr);
      const intervalMs = Number(intervalMsStr);
      if (lastRun > 0 && now - lastRun < intervalMs) return 0;
      store.set(key, nowStr);
      void ttlStr;
      return 1;
    };
    const next = queue.then(() => new Promise((resolve) => setTimeout(() => resolve(run()), 5)));
    queue = next;
    return next;
  });
  return { eval: evalFn } as any;
}

describe('shouldRunOnCatchUpCadence', () => {
  const now = new Date('2026-08-24T10:00:00.000Z');

  beforeEach(() => vi.clearAllMocks());

  it('runs on the first-ever call (no prior last-run key)', async () => {
    const redis = fakeRedisWithStore();

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('GET'"),
      1,
      'scheduler:last-run:job-a',
      String(now.getTime()),
      String(60 * 60_000),
      String(60 * 60 * 4)
    );
  });

  it('skips when the interval has not elapsed since the last run', async () => {
    const lastRun = now.getTime() - 30 * 60_000; // 30 min ago
    const redis = fakeRedisWithStore({ 'scheduler:last-run:job-a': String(lastRun) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(false);
    // The key must be UNCHANGED by a rejected call (the Lua script only SETs on the true branch).
    expect(redis.store.get('scheduler:last-run:job-a')).toBe(String(lastRun));
  });

  it('catches up as soon as the interval elapses, even off the original wall-clock window', async () => {
    // A missed cycle: last run was 61 minutes ago at an arbitrary, non-aligned minute.
    const lastRun = now.getTime() - 61 * 60_000;
    const redis = fakeRedisWithStore({ 'scheduler:last-run:job-a': String(lastRun) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('fails open (returns true) when Redis eval throws', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as any;

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
  });

  it('uses a distinct key per job name so jobs do not share cadence state', async () => {
    const redis = fakeRedisWithStore();

    await shouldRunOnCatchUpCadence(redis, 'duplicate-sweep', 1440, now);
    await shouldRunOnCatchUpCadence(redis, 'stage-reconciler', 180, now);

    expect(redis.eval).toHaveBeenNthCalledWith(1, expect.any(String), 1, 'scheduler:last-run:duplicate-sweep', expect.any(String), expect.any(String), expect.any(String));
    expect(redis.eval).toHaveBeenNthCalledWith(2, expect.any(String), 1, 'scheduler:last-run:stage-reconciler', expect.any(String), expect.any(String), expect.any(String));
  });

  // T-311F HARD/MEDIUM finding: the old GET-then-SET implementation's own
  // comment claimed it "atomically reserve[s] the slot" while actually
  // issuing two separate round trips — two overlapping callers for the same
  // job could both read the pre-write value and both claim the slot. This
  // case proves the NEW single-eval implementation is genuinely exclusive:
  // two concurrent calls for the SAME job/key, at the SAME `now`, only ever
  // let exactly one through, because the mock serializes `eval` calls the
  // way a real Redis server serializes Lua script execution.
  it('double-caller: two concurrent invocations for the same job at the same instant — exactly one reserves the slot', async () => {
    const redis = fakeRedisSerialized();

    const [a, b] = await Promise.all([
      shouldRunOnCatchUpCadence(redis, 'job-a', 60, now),
      shouldRunOnCatchUpCadence(redis, 'job-a', 60, now),
    ]);

    const trueCount = [a, b].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('double-caller: two concurrent invocations for DIFFERENT jobs at the same instant both reserve their own slot', async () => {
    const redis = fakeRedisSerialized();

    const [a, b] = await Promise.all([
      shouldRunOnCatchUpCadence(redis, 'job-a', 60, now),
      shouldRunOnCatchUpCadence(redis, 'job-b', 60, now),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
  });
});
