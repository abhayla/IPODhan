/**
 * P1-2 (T-300, round-5 review): 13/15 registrar allotment-check URLs went
 * dead with NOTHING validating the table since 2025-10 — this is the
 * standing daily guard against that recurring silently. Proves: a healthy
 * URL is left alone; a URL that fails its check is marked unhealthy AND
 * triggers exactly one owner alert (not a repeat alert on the next
 * already-dead cycle); the cycle never throws even if one fetch rejects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { REGISTRARS, updateSetMock, updateWhereMock, notifyOwnerMock, invalidateRegistrarsMock } = vi.hoisted(() => ({
  REGISTRARS: [
    { id: 'r-healthy', name: 'Healthy Registrar', allotmentCheckUrl: 'https://healthy.example.com', allotmentUrlHealthy: true },
    { id: 'r-newly-dead', name: 'Newly Dead Registrar', allotmentCheckUrl: 'https://dead.example.com', allotmentUrlHealthy: true },
    { id: 'r-still-dead', name: 'Still Dead Registrar', allotmentCheckUrl: 'https://stilldead.example.com', allotmentUrlHealthy: false },
  ],
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn().mockResolvedValue(undefined),
  notifyOwnerMock: vi.fn(),
  invalidateRegistrarsMock: vi.fn().mockResolvedValue(0),
}));

vi.mock('@ipodhan/shared', () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(REGISTRARS),
      }),
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSetMock(values);
        return { where: updateWhereMock };
      },
    })),
  },
  getRedisClient: () => ({}),
}));

vi.mock('../../../../src/services/owner-notify.js', () => ({
  notifyOwner: notifyOwnerMock,
}));

vi.mock('../../../../src/scheduler/cache-invalidator.js', () => ({
  CacheInvalidator: vi.fn().mockImplementation(() => ({
    invalidateRegistrars: invalidateRegistrarsMock,
  })),
}));

import { runRegistrarHealthCheck } from '../../../../src/scheduler/jobs/registrar-health-check-job';

describe('runRegistrarHealthCheck', () => {
  beforeEach(() => {
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
    notifyOwnerMock.mockClear();
    invalidateRegistrarsMock.mockClear();

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes('healthy.example.com')) return new Response(null, { status: 200 });
      if (u.includes('dead.example.com')) return new Response(null, { status: 404 });
      if (u.includes('stilldead.example.com')) return new Response(null, { status: 404 });
      throw new Error(`unexpected URL in test: ${u}`);
    }) as unknown as typeof fetch;
  });

  it('marks a healthy URL healthy, alerts once on a newly-dead URL, and does not re-alert an already-dead one', async () => {
    const result = await runRegistrarHealthCheck();

    expect(result.checked).toBe(3);
    expect(result.healthy).toBe(1);
    expect(result.newlyDead).toEqual(['Newly Dead Registrar']);
    expect(result.stillDead).toEqual(['Still Dead Registrar']);

    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    expect(notifyOwnerMock).toHaveBeenCalledWith(
      'P1',
      expect.stringContaining('Newly Dead Registrar'),
      expect.objectContaining({ dedupeKey: 'registrar-url-dead:Newly Dead Registrar' })
    );

    // healthy stays true, newly-dead flips to false, still-dead stays false
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ allotmentUrlHealthy: true }));
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({ allotmentUrlHealthy: false }));
    expect(updateWhereMock).toHaveBeenCalledTimes(3);

    // status changed (healthy -> dead for one registrar) -> cache invalidated
    expect(invalidateRegistrarsMock).toHaveBeenCalledTimes(1);
  });

  it('never throws even when a fetch rejects outright', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    await expect(runRegistrarHealthCheck()).resolves.toBeDefined();
  });

  it('T-300F (fixing F5): still marks a thin HTTP-200 response healthy, not unhealthy on size alone', async () => {
    // A client-rendered SPA can return 200 with a tiny shell for ANY path —
    // status-only health checks cannot distinguish this from a genuinely
    // live page. Flipping `healthy: false` purely on response size would be
    // a false positive (many legitimate confirmation pages are small too).
    global.fetch = vi.fn(async () =>
      new Response('<html>shell</html>', { status: 200, headers: { 'content-length': '19' } })
    ) as unknown as typeof fetch;

    const result = await runRegistrarHealthCheck();

    expect(result.checked).toBe(3);
    expect(result.healthy).toBe(3);
    expect(result.newlyDead).toEqual([]);
  });
});
