// Fail-open contract tests for the Notifier client (owner-notify.ts):
// unset env = silent no-op; configured = correct wire payload; a dead
// Notifier never throws. Offline -- fetch is stubbed throughout. Mirrors the
// pattern used by RealFuelPrices' owner-notify.test.ts (same hub template).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notifyOwner,
  heartbeat,
  flushOwnerNotify,
} from '../../../src/services/owner-notify.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  delete process.env.NOTIFIER_URL;
  delete process.env.NOTIFIER_KEY;
  delete process.env.NOTIFIER_PROJECT;
});

afterEach(async () => {
  await flushOwnerNotify();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('owner-notify fail-open discipline', () => {
  it('notifyOwner is a silent no-op when NOTIFIER_URL/NOTIFIER_KEY are unset', async () => {
    notifyOwner('P1', 'scraper degraded');
    await flushOwnerNotify();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('heartbeat is a silent no-op when NOTIFIER_URL/NOTIFIER_KEY are unset', async () => {
    heartbeat('watchdog', 30);
    await flushOwnerNotify();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when only one of the two env vars is set', async () => {
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
    heartbeat('watchdog', 30);
    notifyOwner('P0', 'half-configured');
    await flushOwnerNotify();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the heartbeat wire payload with X-Api-Key when configured', async () => {
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300/'; // trailing slash stripped
    process.env.NOTIFIER_KEY = 'test-key';
    heartbeat('watchdog', 30);
    await flushOwnerNotify();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3300/heartbeat');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Api-Key']).toBe('test-key');
    expect(JSON.parse(init.body)).toEqual({
      project: 'ipodhan',
      name: 'watchdog',
      intervalMinutes: 30,
    });
  });

  it('POSTs the notify wire payload when configured', async () => {
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
    process.env.NOTIFIER_KEY = 'test-key';
    notifyOwner('P1', 'scraper NSE: 3 consecutive failures', {
      body: 'Success rate (24h): 40.0%',
      type: 'scraper-failure',
      dedupeKey: 'scraper-failure:NSE',
    });
    await flushOwnerNotify();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3300/notify');
    expect(JSON.parse(init.body)).toEqual({
      project: 'ipodhan',
      severity: 'P1',
      title: 'scraper NSE: 3 consecutive failures',
      body: 'Success rate (24h): 40.0%',
      type: 'scraper-failure',
      dedupeKey: 'scraper-failure:NSE',
    });
  });

  it('respects NOTIFIER_PROJECT override', async () => {
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
    process.env.NOTIFIER_KEY = 'test-key';
    process.env.NOTIFIER_PROJECT = 'ipodhan-staging';
    heartbeat('watchdog', 30);
    await flushOwnerNotify();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).project).toBe('ipodhan-staging');
  });

  it('never throws when Notifier is dead -- fetch rejection is swallowed', async () => {
    process.env.NOTIFIER_URL = 'http://127.0.0.1:3300';
    process.env.NOTIFIER_KEY = 'test-key';
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(() => heartbeat('watchdog', 30)).not.toThrow();
    expect(() => notifyOwner('P0', 'db down')).not.toThrow();
    await expect(flushOwnerNotify()).resolves.toBeUndefined();
  });
});
