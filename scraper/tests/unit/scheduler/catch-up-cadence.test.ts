import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldRunOnCatchUpCadence } from '../../../src/scheduler/catch-up-cadence.js';

function fakeRedis(overrides: Partial<{ get: any; set: any }> = {}) {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ...overrides,
  } as any;
}

describe('shouldRunOnCatchUpCadence', () => {
  const now = new Date('2026-08-24T10:00:00.000Z');

  beforeEach(() => vi.clearAllMocks());

  it('runs on the first-ever call (no prior last-run key)', async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue(null) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('scheduler:last-run:job-a', String(now.getTime()), 'EX', 60 * 60 * 4);
  });

  it('skips when the interval has not elapsed since the last run', async () => {
    const lastRun = now.getTime() - 30 * 60_000; // 30 min ago
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue(String(lastRun)) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('catches up as soon as the interval elapses, even off the original wall-clock window', async () => {
    // A missed cycle: last run was 61 minutes ago at an arbitrary, non-aligned minute.
    const lastRun = now.getTime() - 61 * 60_000;
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue(String(lastRun)) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
    expect(redis.set).toHaveBeenCalledTimes(1);
  });

  it('fails open (returns true) when Redis read throws', async () => {
    const redis = fakeRedis({ get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    const result = await shouldRunOnCatchUpCadence(redis, 'job-a', 60, now);

    expect(result).toBe(true);
  });

  it('uses a distinct key per job name so jobs do not share cadence state', async () => {
    const redis = fakeRedis({ get: vi.fn().mockResolvedValue(null) });

    await shouldRunOnCatchUpCadence(redis, 'duplicate-sweep', 1440, now);
    await shouldRunOnCatchUpCadence(redis, 'stage-reconciler', 180, now);

    expect(redis.get).toHaveBeenNthCalledWith(1, 'scheduler:last-run:duplicate-sweep');
    expect(redis.get).toHaveBeenNthCalledWith(2, 'scheduler:last-run:stage-reconciler');
  });
});
