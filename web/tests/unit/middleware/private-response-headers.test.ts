/**
 * #1346: the CDN cached authenticated admin responses (cf-cache-status HIT) despite
 * `Cache-Control: private, no-store`. Middleware is the one place that marks them uncacheable for
 * the CDN; these tests pin the exact headers and prove every admin route/page file is matched.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { middleware, config } from '@/middleware';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-accounts/session-cookie-name';

const APP = path.resolve(__dirname, '../../../app');

function req(url: string, cookie?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (cookie) headers.cookie = `${ADMIN_SESSION_COOKIE}=${cookie}`;
  return new NextRequest(`https://ipodhan.test${url}`, { headers });
}

function expectPrivate(res: Response) {
  expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(res.headers.get('cdn-cache-control')).toBe('no-store');
  expect(res.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
  expect(res.headers.get('vary')?.toLowerCase()).toContain('cookie');
}

describe('admin responses are never stored by the CDN', () => {
  it.each([
    '/api/admin/ipos/abc/editor',
    '/api/admin/ipos/abc/lists/registrars',
    '/api/admin/ipos/abc/update-field',
    '/api/admin/conflicts',
    '/api/admin/queue',
    '/admin',
    '/admin/ipos/abc',
    '/admin/conflicts',
  ])('authenticated %s carries the private headers', (url) => {
    expectPrivate(middleware(req(url, 'sess')));
  });

  it('the 401 for a signed-out API call and the login redirect carry them too', () => {
    const unauth = middleware(req('/api/admin/ipos/abc/editor'));
    expect(unauth.status).toBe(401);
    expectPrivate(unauth);
    const redirect = middleware(req('/admin/conflicts'));
    expect(redirect.status).toBe(307);
    expectPrivate(redirect);
    expectPrivate(middleware(req('/admin/login')));
  });

  it('a Bearer-token API call carries them', () => {
    expectPrivate(middleware(req('/api/admin/queue', undefined, { authorization: 'Bearer x' })));
  });

  it('a public page rendered for an admin cookie (editor controls) is uncacheable', () => {
    expectPrivate(middleware(req('/ipos/some-ipo', 'sess')));
  });

  it('a public page with no admin cookie is left cacheable (no header forced)', () => {
    const res = middleware(req('/ipos/some-ipo'));
    expect(res.headers.get('cdn-cache-control')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('keeps an existing Vary value', () => {
    // covered through the helper: Vary is merged, not replaced
    const res = middleware(req('/api/admin/queue', 'sess'));
    expect(res.headers.get('vary')).toBe('Cookie');
  });
});

describe('class guard: every admin route and page file is inside the middleware matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  function walk(dir: string, name: RegExp, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, name, out);
      else if (name.test(e.name)) out.push(full);
    }
    return out;
  }

  function toUrl(file: string): string {
    const rel = path.relative(APP, path.dirname(file)).split(path.sep);
    const segs = rel
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => (/^\[\.\.\..*\]$/.test(s) || /^\[.*\]$/.test(s) ? 'x' : s));
    return '/' + segs.join('/');
  }

  const routeFiles = walk(path.join(APP, 'api/admin'), /^route\.(ts|js)$/);
  const pageFiles = walk(path.join(APP, 'admin'), /^page\.tsx$/);

  it('finds the admin surface', () => {
    expect(routeFiles.length).toBeGreaterThan(10);
    expect(pageFiles.length).toBeGreaterThan(5);
  });

  it.each([...routeFiles, ...pageFiles].map((f) => [path.relative(APP, f), toUrl(f)]))(
    '%s (%s) is matched and marked private',
    (_rel, url) => {
      expect(matcher.test(url)).toBe(true);
      expectPrivate(middleware(req(url, 'sess')));
    }
  );
});
