/**
 * OD-113: only the owner manages admin accounts. Drives every account route handler through the
 * REAL withAdminAuth seam as an authenticated NON-owner (the machine token, which is never an owner)
 * and asserts 403 with no database access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Each test dynamically imports a route module (its whole graph); on a loaded machine that alone
// can pass 5 s, so this file gets a longer per-test limit.
vi.setConfig({ testTimeout: 30_000 });
import { NextRequest } from 'next/server';

const dbCalls = vi.fn();
const dbProxy: object = new Proxy(() => dbProxy, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined;
    dbCalls(prop);
    return dbProxy;
  },
  apply: () => dbProxy,
});
vi.mock('@/lib/db/index', () => ({ db: dbProxy, getDb: () => dbProxy }));

function asNonOwner(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { authorization: 'Bearer machine-secret-value', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const id = '11111111-2222-4333-8444-555555555555';
const params = { params: Promise.resolve({ id }) };

describe('admin account routes are owner-only', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    vi.stubEnv('ADMIN_AUTH_TOKEN', 'machine-secret-value');
    dbCalls.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('GET /api/admin/accounts -> 403', async () => {
    const { GET } = await import('@/app/api/admin/accounts/route');
    expect((await GET(asNonOwner('GET', '/api/admin/accounts'))).status).toBe(403);
    expect(dbCalls).not.toHaveBeenCalled();
  });

  it('POST /api/admin/accounts -> 403', async () => {
    const { POST } = await import('@/app/api/admin/accounts/route');
    const res = await POST(
      asNonOwner('POST', '/api/admin/accounts', { name: 'X', email: 'x@y.co', phone: '9876543210', password: 'long-enough-pass' }) // secret-scan:allow (dummy)
    );
    expect(res.status).toBe(403);
    expect(dbCalls).not.toHaveBeenCalled();
  });

  it('DELETE /api/admin/accounts/[id] -> 403', async () => {
    const { DELETE } = await import('@/app/api/admin/accounts/[id]/route');
    expect((await DELETE(asNonOwner('DELETE', `/api/admin/accounts/${id}`), params)).status).toBe(403);
    expect(dbCalls).not.toHaveBeenCalled();
  });

  it('POST /api/admin/accounts/[id]/password -> 403', async () => {
    const { POST } = await import('@/app/api/admin/accounts/[id]/password/route');
    const res = await POST(asNonOwner('POST', `/api/admin/accounts/${id}/password`, { password: 'long-enough-pass' }), params); // secret-scan:allow (dummy)
    expect(res.status).toBe(403);
    expect(dbCalls).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401 before the owner check', async () => {
    const { GET } = await import('@/app/api/admin/accounts/route');
    const res = await GET(new NextRequest('http://localhost/api/admin/accounts'));
    expect(res.status).toBe(401);
  });
});
