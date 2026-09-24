/**
 * Admin API routes answer an unauthenticated request with 401 and never reach
 * their data layer.
 *
 * RCA: some handlers under app/api/admin/ called no admin-auth helper, and
 * middleware.ts does not guard /api/admin, so those handlers served anonymous
 * requests. This drives each such handler through its REAL auth helper (no
 * auth mock) with no Authorization header and asserts 401 plus zero calls into
 * the service/db it would otherwise use. The class-level guard over every
 * route file is admin-routes-static-guard.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const serviceCalls = vi.fn();
vi.mock('@/lib/services/conflict-resolution', () => ({
  ConflictResolutionService: vi.fn(() =>
    new Proxy({}, { get: () => (...args: unknown[]) => { serviceCalls(...args); return Promise.resolve({}); } }),
  ),
}));

const dbCalls = vi.fn();
const dbProxy: object = new Proxy(() => dbProxy, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined;
    dbCalls(prop);
    return dbProxy;
  },
  apply: () => dbProxy,
});
vi.mock('@/lib/db', () => ({ db: dbProxy, getDb: () => dbProxy, extractionLogs: {} }));

const redisCalls = vi.fn();
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => {
    redisCalls();
    return { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') };
  }),
}));

vi.mock('@ipodhan/shared/repositories/data-conflicts-repository', () => ({
  DataConflictsRepository: vi.fn(() => ({ getConflictStats: vi.fn().mockResolvedValue({ unresolved: 0 }) })),
}));

// requireAdminAuth reads the request headers through next/headers, which only
// works inside a Next request scope; feed it the test request's headers.
let currentHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => currentHeaders }));

function anonymous(method: string, path: string): NextRequest {
  currentHeaders = new Headers({ 'content-type': 'application/json' });
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: currentHeaders,
    body: method === 'GET' ? undefined : JSON.stringify({
      conflictId: 'c1',
      conflictIds: ['c1'],
      resolvedSource: 'ADMIN',
      resolutionReason: 'x',
      resolvedBy: 'someone',
    }),
  });
}

const cases: Array<{ name: string; method: string; path: string; load: () => Promise<Record<string, unknown>> }> = [
  { name: 'conflicts/auto-resolve POST', method: 'POST', path: '/api/admin/conflicts/auto-resolve',
    load: () => import('@/app/api/admin/conflicts/auto-resolve/route') },
  { name: 'conflicts/bulk-resolve POST', method: 'POST', path: '/api/admin/conflicts/bulk-resolve',
    load: () => import('@/app/api/admin/conflicts/bulk-resolve/route') },
  { name: 'conflicts GET', method: 'GET', path: '/api/admin/conflicts',
    load: () => import('@/app/api/admin/conflicts/route') },
  { name: 'conflicts POST', method: 'POST', path: '/api/admin/conflicts',
    load: () => import('@/app/api/admin/conflicts/route') },
  { name: 'conflicts/stats GET', method: 'GET', path: '/api/admin/conflicts/stats',
    load: () => import('@/app/api/admin/conflicts/stats/route') },
  { name: 'drhp/ipo/[ipoId] GET', method: 'GET', path: '/api/admin/drhp/ipo/ipo-1',
    load: () => import('@/app/api/admin/drhp/ipo/[ipoId]/route') },
  { name: 'metrics/data-pipeline GET', method: 'GET', path: '/api/admin/metrics/data-pipeline',
    load: () => import('@/app/api/admin/metrics/data-pipeline/route') },
];

describe('admin API routes reject unauthenticated requests', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    // Configure BOTH helpers as a real deployment would, so a 401 comes from a
    // missing credential, not from an unconfigured server.
    process.env.ADMIN_PANEL_ENABLED = 'true';
    process.env.ADMIN_AUTH_TOKEN = 'a'.repeat(64);
    process.env.ADMIN_API_TOKEN = 'b'.repeat(64);
    serviceCalls.mockClear();
    dbCalls.mockClear();
    redisCalls.mockClear();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  for (const c of cases) {
    it(`${c.name} returns 401 and touches no data`, async () => {
      vi.resetModules();
      const mod = await c.load();
      const handler = mod[c.method] as (req: NextRequest, ctx: unknown) => Promise<Response>;
      expect(typeof handler).toBe('function');
      const res = await handler(anonymous(c.method, c.path), { params: Promise.resolve({ ipoId: 'ipo-1' }) });
      expect(res.status).toBe(401);
      expect(serviceCalls).not.toHaveBeenCalled();
      expect(dbCalls).not.toHaveBeenCalled();
      expect(redisCalls).not.toHaveBeenCalled();
    });
  }
});
