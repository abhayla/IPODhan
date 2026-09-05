import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * W-140: covers the held-lock registry that lets the SIGTERM/SIGINT signal
 * path in index.ts release document-cycle.ts's extraction lock —
 * `process.exit` in the signal handler skips this file's own `finally`
 * release, which used to leave `filing-auto-persist:cycle` held for its
 * full 45-minute TTL after a deploy signalled a running cycle.
 *
 * index.ts itself is not exercised here (it spins up the full CLI `main()`
 * with side effects — DB, Redis, per-source scrape orchestration — well
 * beyond what a unit test should touch); this file covers the registry
 * thoroughly instead, since the registry is the entire surface the signal
 * path depends on.
 */

const releaseMock = vi.fn();

vi.mock('../../../src/utils/distributed-lock.js', () => ({
  DistributedLock: vi.fn().mockImplementation(() => ({
    release: (...args: unknown[]) => releaseMock(...args),
  })),
}));

vi.mock('@ipodhan/shared', () => ({
  getRedisClient: vi.fn(() => ({})),
  db: {},
}));

import {
  registerHeldLock,
  unregisterHeldLock,
  releaseHeldLocks,
} from '../../../src/services/document-cycle.js';

describe('W-140 held-lock registry', () => {
  beforeEach(() => {
    releaseMock.mockReset();
    releaseMock.mockResolvedValue(true);
    // Drain any locks a previous test left registered — registerHeldLock
    // has no "clear" API by design (production code never needs one), so
    // tests clean up via releaseHeldLocks itself.
    return releaseHeldLocks();
  });

  it('releases every registered lock, token-checked, and empties the registry', async () => {
    registerHeldLock('lock:a', 'token-a');
    registerHeldLock('lock:b', 'token-b');

    await releaseHeldLocks();

    expect(releaseMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledWith('lock:a', 'token-a');
    expect(releaseMock).toHaveBeenCalledWith('lock:b', 'token-b');

    // Idempotent: a second call with nothing registered does not re-release.
    releaseMock.mockClear();
    await releaseHeldLocks();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('unregisterHeldLock removes a lock so releaseHeldLocks skips it (the normal-path release already handled it)', async () => {
    registerHeldLock('lock:c', 'token-c');
    unregisterHeldLock('lock:c', 'token-c');

    await releaseHeldLocks();

    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('unregisterHeldLock only removes the matching key+token pair, not other entries', async () => {
    registerHeldLock('lock:d', 'token-1');
    registerHeldLock('lock:d', 'token-2');
    unregisterHeldLock('lock:d', 'token-1');

    await releaseHeldLocks();

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith('lock:d', 'token-2');
  });

  it('unregisterHeldLock on an unknown key+token pair is a no-op (does not throw, does not remove anything else)', async () => {
    registerHeldLock('lock:e', 'token-e');
    expect(() => unregisterHeldLock('lock:missing', 'token-missing')).not.toThrow();

    await releaseHeldLocks();

    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith('lock:e', 'token-e');
  });

  it('swallows a release error for one lock and still releases the rest', async () => {
    registerHeldLock('lock:fails', 'token-fails');
    registerHeldLock('lock:ok', 'token-ok');
    releaseMock.mockImplementation((key: string) => {
      if (key === 'lock:fails') {
        return Promise.reject(new Error('redis unavailable'));
      }
      return Promise.resolve(true);
    });

    await expect(releaseHeldLocks()).resolves.toBeUndefined();

    expect(releaseMock).toHaveBeenCalledTimes(2);
    expect(releaseMock).toHaveBeenCalledWith('lock:fails', 'token-fails');
    expect(releaseMock).toHaveBeenCalledWith('lock:ok', 'token-ok');
  });

  it('releaseHeldLocks on an empty registry never calls release', async () => {
    await releaseHeldLocks();
    expect(releaseMock).not.toHaveBeenCalled();
  });
});
