// @vitest-environment node
/**
 * The admin gate in web/middleware.ts: the first layer, before any admin page or API route runs.
 * Cookie PRESENCE only (Edge runtime, no database); validity stays with the layout, the pages
 * and withAdminAuth. Also asserts the exported matcher actually reaches admin paths, so dropping
 * or narrowing it fails here.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { middleware, config } from '@/middleware';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-accounts/session-token';

const BASE = 'http://localhost:3000';

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, BASE), { headers });
}
const withCookie = { cookie: `${ADMIN_SESSION_COOKIE}=${'A'.repeat(43)}` };

function isPassThrough(res: Response) {
  return res.headers.get('x-middleware-next') === '1';
}

describe('admin gate: anonymous requests stop before any admin page or API route runs', () => {
  it.each(['/admin', '/admin/', '/admin/pipeline', '/admin/conflicts', '/admin/dynamic/ipos/list'])(
    'no cookie on %s -> redirect to /admin/login',
    async (p) => {
      const res = await middleware(req(p));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/login');
      expect(new URL(res.headers.get('location')!).search).toBe('');
    }
  );

  it('an in-app navigation (RSC) request without a cookie is redirected too', async () => {
    const res = await middleware(req('/admin/pipeline', { RSC: '1' }));
    expect(res.status).toBe(307);
  });

  it('an Authorization header does NOT open an admin page', async () => {
    const res = await middleware(req('/admin/pipeline', { authorization: 'Bearer x' }));
    expect(res.status).toBe(307);
  });

  it.each(['/api/admin/x', '/api/admin/conflicts', '/api/admin/auth/me'])('no cookie on %s -> 401 JSON', async (p) => {
    const res = await middleware(req(p));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('an /api/admin request with an Authorization header passes through to the route guard (machine callers)', async () => {
    expect(isPassThrough(await middleware(req('/api/admin/status/update', { authorization: 'Bearer machine-token' })))).toBe(true);
  });

  it.each(['/admin/pipeline', '/admin', '/api/admin/conflicts'])('a session cookie on %s -> NextResponse.next()', async (p) => {
    const res = await middleware(req(p, withCookie));
    expect(isPassThrough(res)).toBe(true);
  });

  it.each(['/admin/login', '/admin/login/', '/api/admin/auth/login'])('%s passes through without a session', async (p) => {
    expect(isPassThrough(await middleware(req(p)))).toBe(true);
  });

  it.each(['/admin/login-x', '/admin/loginfoo'])('%s is NOT exempted (exact match only) -> redirect to /admin/login', async (p) => {
    const res = await middleware(req(p));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/login');
  });

  it.each(['/', '/ipo/some-ipo', '/api/ipos', '/administrator', '/api/administer'])('non-admin path %s is untouched', async (p) => {
    expect(isPassThrough(await middleware(req(p)))).toBe(true);
  });

  it('refused responses still carry the security headers', async () => {
    expect((await middleware(req('/admin/pipeline'))).headers.get('x-frame-options')).toBe('DENY');
    expect((await middleware(req('/api/admin/x'))).headers.get('x-frame-options')).toBe('DENY');
  });
});

describe('the middleware matcher reaches every admin path', () => {
  it.each(['/admin', '/admin/pipeline', '/admin/dynamic/ipos/list', '/api/admin/x', '/api/admin/auth/me'])(
    'matches %s',
    async (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    }
  );
});
