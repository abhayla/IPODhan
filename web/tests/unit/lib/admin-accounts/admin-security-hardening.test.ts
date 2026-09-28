/**
 * Tier A review fixes on the admin-accounts branch (spec §9.2 item 6; OD-104, OD-113, OD-114):
 * m4 Origin check on cookie mutations, M2 login limits + trusted client IP, m5 kill switch on the
 * ADMIN_API_TOKEN path, m3 absolute session cap, m1 single owner in the DB, m2 adminId on every
 * session context. Each case goes red when its guard line is removed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { getTableConfig } from 'drizzle-orm/pg-core';

const sessionIdentity = vi.fn();
vi.mock('@/lib/admin-accounts/admin-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-accounts/admin-session')>();
  return { ...actual, resolveAdminSessionToken: (...args: unknown[]) => sessionIdentity(...args) };
});

const requestHeaders = { current: new Headers() };
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));

const rateCalls: Array<{ ip: string; endpoint: string; config: { onStoreError?: string } }> = [];
vi.mock('@/lib/middleware/rate-limiter', () => ({
  checkRateLimit: vi.fn(async (ip: string, endpoint: string, config: { onStoreError?: string }) => {
    rateCalls.push({ ip, endpoint, config });
    return { allowed: !endpoint.startsWith('admin-login-email:'), limit: 10, remaining: 0, reset: 0 };
  }),
}));

vi.mock('@/lib/db/index', () => ({
  get db() {
    throw new Error('db must not be reached by these unit tests');
  },
}));

import { withAdminAuth, verifyAdminAuth } from '@/lib/middleware/admin-auth';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { cookieRequestOriginAllowed, trustedClientIp } from '@/lib/admin-accounts/request-origin';
import { evaluateSession } from '@/lib/admin-accounts/admin-session';
import {
  ADMIN_SESSION_COOKIE,
  SESSION_ABSOLUTE_MAX_MS,
  generateSessionToken,
  slidingSessionExpiry,
} from '@/lib/admin-accounts/session-token';
import type { AdminAccountRepository, SessionWithAccount } from '@/lib/admin-accounts/admin-account-repository';
import { adminUsers } from '@ipodhan/shared/db/schema';

const SITE = 'https://ipodhan.example';
const NOW = new Date('2026-09-28T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ADMIN = { adminId: 'u-7', adminName: 'Asha Admin', isOwner: false };

function cookieRequest(method: string, origin?: string): NextRequest {
  const headers: Record<string, string> = { cookie: `${ADMIN_SESSION_COOKIE}=${generateSessionToken()}` };
  if (origin) headers.origin = origin;
  return new NextRequest('http://localhost/api/admin/accounts', { method, headers });
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_BASE_URL', SITE);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('ADMIN_ALLOWED_ORIGINS', 'https://staging.ipodhan.example');
  vi.stubEnv('ADMIN_AUTH_TOKEN', 'machine-secret-value');
  sessionIdentity.mockReset();
  sessionIdentity.mockResolvedValue(ADMIN);
  requestHeaders.current = new Headers();
  rateCalls.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('m4: cookie-authenticated mutations must come from the site origin', () => {
  it('lets a same-origin POST through (configured site and ADMIN_ALLOWED_ORIGINS)', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    expect((await withAdminAuth(handler)(cookieRequest('POST', SITE))).status).toBe(200);
    expect((await withAdminAuth(handler)(cookieRequest('DELETE', 'https://staging.ipodhan.example'))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('answers a cross-origin cookie POST/PATCH with 403 and never runs the handler', async () => {
    const handler = vi.fn();
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect((await withAdminAuth(handler)(cookieRequest(method, 'https://evil.example'))).status).toBe(403);
    }
    expect((await withAdminAuth(handler)(cookieRequest('POST', 'null'))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers a cookie mutation with NO Origin header with 403', async () => {
    const handler = vi.fn();
    expect((await withAdminAuth(handler)(cookieRequest('POST'))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets a cookie GET without Origin through (reads never mutate)', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    expect((await withAdminAuth(handler)(cookieRequest('GET'))).status).toBe(200);
  });

  it('exempts the Bearer machine token (no cookie, no Origin)', async () => {
    sessionIdentity.mockResolvedValue(null);
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    const req = new NextRequest('http://localhost/api/admin/status/update', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret-value' },
    });
    expect((await withAdminAuth(handler)(req)).status).toBe(200);
  });

  it('fails closed for a mutation from an origin that is neither the request host nor configured', () => {
    const headers = new Headers({ origin: SITE, host: 'other.example' });
    expect(cookieRequestOriginAllowed(headers, 'POST', {} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('m4 by construction: same host passes with NO origin env (staging/prod set none)', () => {
  const NO_ENV = {} as NodeJS.ProcessEnv;
  function hostRequest(method: string, headers: Record<string, string>): NextRequest {
    return new NextRequest('http://127.0.0.1:3012/api/admin/update-field', {
      method,
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${generateSessionToken()}`, ...headers },
    });
  }
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    vi.stubEnv('ADMIN_ALLOWED_ORIGINS', '');
  });

  it('allows a cookie POST whose Origin host equals the Host header, with no env configured', async () => {
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    const req = hostRequest('POST', { host: 'staging.ipodhan.com', origin: 'https://staging.ipodhan.com' });
    expect((await withAdminAuth(handler)(req)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('allows the Origin host when it equals X-Forwarded-Host (nginx passes the public host on)', () => {
    const headers = new Headers({
      host: '127.0.0.1:3012',
      'x-forwarded-host': 'staging.ipodhan.com',
      origin: 'https://staging.ipodhan.com',
    });
    expect(cookieRequestOriginAllowed(headers, 'PATCH', NO_ENV)).toBe(true);
  });

  it('answers 403 when the Origin host differs from the request host', async () => {
    const handler = vi.fn();
    const req = hostRequest('POST', { host: 'staging.ipodhan.com', origin: 'https://evil.example' });
    expect((await withAdminAuth(handler)(req)).status).toBe(403);
    const sibling = hostRequest('DELETE', { host: 'ipodhan.com', origin: 'https://staging.ipodhan.com' });
    expect((await withAdminAuth(handler)(sibling)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('with no Origin: Sec-Fetch-Site same-origin is allowed, anything else or nothing is 403', async () => {
    const ok = vi.fn(async () => new Response(null, { status: 200 }));
    const same = hostRequest('POST', { host: 'staging.ipodhan.com', 'sec-fetch-site': 'same-origin' });
    expect((await withAdminAuth(ok)(same)).status).toBe(200);
    const denied = vi.fn();
    for (const site of ['cross-site', 'same-site', 'none']) {
      const req = hostRequest('POST', { host: 'staging.ipodhan.com', 'sec-fetch-site': site });
      expect((await withAdminAuth(denied)(req)).status).toBe(403);
    }
    expect((await withAdminAuth(denied)(hostRequest('POST', { host: 'staging.ipodhan.com' }))).status).toBe(403);
    expect(denied).not.toHaveBeenCalled();
  });

  it('still exempts the Bearer machine token from the origin check', async () => {
    sessionIdentity.mockResolvedValue(null);
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    const req = new NextRequest('http://127.0.0.1:3012/api/admin/status/update', {
      method: 'POST',
      headers: { authorization: 'Bearer machine-secret-value', host: 'x.example', origin: 'https://evil.example' },
    });
    expect((await withAdminAuth(handler)(req)).status).toBe(200);
  });

  it('ADMIN_ALLOWED_ORIGINS still adds an extra origin', () => {
    const headers = new Headers({ host: 'ipodhan.com', origin: 'https://admin.ipodhan.com' });
    expect(cookieRequestOriginAllowed(headers, 'POST', NO_ENV)).toBe(false);
    expect(
      cookieRequestOriginAllowed(headers, 'POST', { ADMIN_ALLOWED_ORIGINS: 'https://admin.ipodhan.com' } as NodeJS.ProcessEnv)
    ).toBe(true);
  });
});

describe('m4: requireAdminAuth callers', () => {
  it('requireAdminAuth (no request): cookie session needs a matching Origin or same-origin Sec-Fetch-Site', async () => {
    const cookie = `${ADMIN_SESSION_COOKIE}=${generateSessionToken()}`;
    requestHeaders.current = new Headers({ cookie, origin: 'https://evil.example' });
    expect((await requireAdminAuth())?.status).toBe(403);
    requestHeaders.current = new Headers({ cookie, 'sec-fetch-site': 'cross-site' });
    expect((await requireAdminAuth())?.status).toBe(403);
    requestHeaders.current = new Headers({ cookie });
    expect((await requireAdminAuth())?.status).toBe(403);
    requestHeaders.current = new Headers({ cookie, origin: SITE });
    expect(await requireAdminAuth()).toBeNull();
    requestHeaders.current = new Headers({ cookie, 'sec-fetch-site': 'same-origin' });
    expect(await requireAdminAuth()).toBeNull();
  });

  it('requireAdminAuth(request): uses the request method, so a no-Origin cookie POST is 403', async () => {
    const req = cookieRequest('POST');
    requestHeaders.current = new Headers(req.headers);
    expect((await requireAdminAuth(req))?.status).toBe(403);
    const get = cookieRequest('GET');
    requestHeaders.current = new Headers(get.headers);
    expect(await requireAdminAuth(get)).toBeNull();
  });
});

describe('m5: the ADMIN_API_TOKEN Bearer path obeys ADMIN_PANEL_ENABLED', () => {
  it('refuses a valid token when the panel is off, accepts it when on', async () => {
    const token = 'x'.repeat(40);
    vi.stubEnv('ADMIN_API_TOKEN', token);
    sessionIdentity.mockResolvedValue(null);
    requestHeaders.current = new Headers({ authorization: `Bearer ${token}` });
    expect(await requireAdminAuth()).toBeNull();
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'false');
    expect((await requireAdminAuth())?.status).toBe(401);
  });
});

describe('M2: login rate limits', () => {
  it('never takes the client IP from the first X-Forwarded-For entry', () => {
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('unknown');
    expect(
      trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4', 'cf-connecting-ip': '198.51.100.7', 'x-real-ip': '10.0.0.1' }))
    ).toBe('198.51.100.7');
    expect(trustedClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1');
  });

  it('limits by email ALONE (any IP) and by trusted IP, both falling back to a local counter', async () => {
    const { POST } = await import('@/app/api/admin/auth/login/route');
    const res = await POST(
      new NextRequest('http://localhost/api/admin/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify({ email: 'Owner@Example.com', password: 'whatever-password' }), // secret-scan:allow (dummy)
      })
    );
    expect(res.status).toBe(429);
    const emailCall = rateCalls.find((c) => c.endpoint === 'admin-login-email:owner@example.com');
    expect(emailCall).toBeDefined();
    expect(emailCall?.ip).not.toContain('6.6.6.6');
    const ipCall = rateCalls.find((c) => c.endpoint === 'admin-login-ip');
    expect(ipCall?.ip).toBe('198.51.100.7');
    expect(rateCalls.every((c) => c.config.onStoreError === 'local')).toBe(true);
  });
});

describe('m3: sessions end 30 days after sign-in however active', () => {
  function row(over: Partial<SessionWithAccount>): SessionWithAccount {
    return {
      sessionId: 'h',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + DAY),
      lastSeenAt: NOW,
      adminUserId: 'u-7',
      name: 'Asha Admin',
      isOwner: false,
      disabledAt: null,
      ...over,
    };
  }

  it('refuses a session created 30 days ago even with a future expiry', () => {
    expect(evaluateSession(row({ createdAt: new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_MS) }), NOW)).toBeNull();
    expect(evaluateSession(row({ createdAt: new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_MS + 60_000) }), NOW)).not.toBeNull();
  });

  it('never slides the expiry past createdAt + 30 days', async () => {
    const createdAt = new Date(NOW.getTime() - 25 * DAY);
    expect(slidingSessionExpiry(createdAt, NOW).getTime()).toBe(createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS);
    const touches: Date[] = [];
    const repo = {
      findSessionWithAccount: async () => row({ createdAt, lastSeenAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }),
      touchSession: async (_h: string, _now: Date, expiresAt: Date) => {
        touches.push(expiresAt);
      },
    } as unknown as AdminAccountRepository;
    const actual = await vi.importActual<typeof import('@/lib/admin-accounts/admin-session')>(
      '@/lib/admin-accounts/admin-session'
    );
    expect(await actual.resolveAdminSessionToken(generateSessionToken(), repo, NOW)).not.toBeNull();
    expect(touches).toHaveLength(1);
    expect(touches[0].getTime()).toBe(createdAt.getTime() + SESSION_ABSOLUTE_MAX_MS);
  });
});

describe('m1: at most one owner, enforced by the database', () => {
  it('declares a partial UNIQUE index on is_owner WHERE is_owner', () => {
    const idx = getTableConfig(adminUsers).indexes.find((i) => i.config.name === 'uq_admin_users_single_owner');
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.where).toBeDefined();
  });

  it('ships that index in the journaled admin_accounts migration', () => {
    const dir = path.resolve(__dirname, '../../../../drizzle/migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('_admin_accounts.sql'));
    expect(files).toHaveLength(1);
    const sqlText = readFileSync(path.join(dir, files[0]), 'utf8');
    expect(sqlText).toMatch(/CREATE UNIQUE INDEX "uq_admin_users_single_owner" ON "admin_users"[^;]*WHERE "admin_users"\."is_owner"/);
  });
});

describe('m2: every session context carries the admin id', () => {
  it('verifyAdminAuth returns the session admin id and marks the method', async () => {
    const ctx = await verifyAdminAuth(cookieRequest('GET'));
    expect(ctx).toEqual({ ...ADMIN, isAuthenticated: true, authMethod: 'session' });
    expect(ctx?.adminId).toBe('u-7');
  });
});
