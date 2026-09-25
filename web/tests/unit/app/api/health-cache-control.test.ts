/**
 * Unit test for #138: /api/health (and /api/health-detailed) sent no
 * Cache-Control at all, so Cloudflare applied its own default caching and
 * served hours-old cached 200s through a real DB outage. Every response
 * path — both probes, and both the healthy and unhealthy outcome — MUST
 * carry a no-store Cache-Control header. Mocks the DB/Redis dependencies so
 * this runs without a live database (the integration test covers the real
 * dependency path separately).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}));
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(),
}));

import { query } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

function makeRequest(url = 'http://localhost:3000/api/health'): Request {
  return new Request(url);
}

const NO_STORE = 'no-store, no-cache, must-revalidate';

describe('GET /api/health — Cache-Control (#138)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('carries no-store Cache-Control on the healthy (200) response', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ health_check: 1 }] } as never);
    vi.mocked(getRedisClient).mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') } as never);

    const { GET } = await import('@/app/api/health/route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE);
    expect(res.headers.get('Pragma')).toBe('no-cache');
  });

  it('carries no-store Cache-Control on the unhealthy (503) response', async () => {
    vi.mocked(query).mockRejectedValue(new Error('Database timed out after 2000ms'));
    vi.mocked(getRedisClient).mockReturnValue({ ping: vi.fn().mockResolvedValue('PONG') } as never);

    const { GET } = await import('@/app/api/health/route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE);
    expect(res.headers.get('Pragma')).toBe('no-cache');
  });

  it('carries no-store Cache-Control on the ?probe=live response', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(makeRequest('http://localhost:3000/api/health?probe=live'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE);
  });
});

describe('GET /api/health-detailed — Cache-Control (#138)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('carries no-store Cache-Control regardless of dependency outcome', async () => {
    vi.doMock('@/lib/db', () => ({
      db: { execute: vi.fn().mockRejectedValue(new Error('down')) },
    }));
    vi.doMock('@/lib/cache/redis-client', () => ({
      testRedisConnection: vi.fn().mockRejectedValue(new Error('down')),
    }));
    vi.doMock('@/lib/logging/logger', () => ({
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    }));

    const { GET } = await import('@/app/api/health-detailed/route');
    const res = await GET();

    expect([200, 503]).toContain(res.status);
    expect(res.headers.get('Cache-Control')).toBe(NO_STORE);
    expect(res.headers.get('Pragma')).toBe('no-cache');
  });
});
