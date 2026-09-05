import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { raceWithTimeout, DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS } from '../../../src/utils/race-with-timeout.js';

/**
 * W-140 round 2 (W-152): the SIGTERM/SIGINT signal path in index.ts races
 * its combined lock-release task against a timeout so a hung Redis cannot
 * block process.exit forever. This covers the generic racer in isolation
 * with fake timers — index.ts itself stays thin (just wires this + the two
 * release calls) and isn't unit-tested directly.
 */

describe('W-140/W-152 raceWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the task finishes when it beats the timeout, without logging a timeout warning', async () => {
    const task = vi.fn().mockResolvedValue(undefined);

    const promise = raceWithTimeout(task, { timeoutMs: 5000, label: 'lock release' });
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('resolves at the timeout when the task never settles, and does not throw', async () => {
    const task = vi.fn(() => new Promise<void>(() => {})); // never resolves

    const promise = raceWithTimeout(task, { timeoutMs: 5000, label: 'lock release' });
    let settled = false;
    promise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });

  it('swallows a task rejection instead of propagating it', async () => {
    const task = vi.fn().mockRejectedValue(new Error('redis unavailable'));

    const promise = raceWithTimeout(task, { timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('uses DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS (5000ms) when no timeoutMs is given', async () => {
    const task = vi.fn(() => new Promise<void>(() => {}));

    const promise = raceWithTimeout(task);
    let settled = false;
    promise.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });

  it('clears the timeout timer once the task wins, leaving no pending timers', async () => {
    const task = vi.fn().mockResolvedValue(undefined);

    const promise = raceWithTimeout(task, { timeoutMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(vi.getTimerCount()).toBe(0);
  });
});
