/**
 * Core proof for spec §9.2 item 6 (OD-104, OD-113, OD-114): a named admin logs in with email and
 * password, the server knows who they are on the next request, and a removed admin loses access at
 * once. Runs the REAL login route handler and the REAL withAdminAuth seam against ipodhan_test; only
 * the Redis-backed login rate limiter is stubbed (it fails open without Redis anyway).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

vi.mock('@/lib/middleware/rate-limiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, limit: 10, remaining: 9, reset: 0 })),
}));

process.env.ADMIN_PANEL_ENABLED = 'true';

import { db } from '@/lib/db/index';
import { adminUsers, adminSessions } from '@ipodhan/shared/db/schema';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-accounts/admin-session';
import { POST as login } from '@/app/api/admin/auth/login/route';
import { GET as me } from '@/app/api/admin/auth/me/route';

const suffix = randomBytes(4).toString('hex');
const email = `a3-proof-${suffix}@example.test`;
const password = `proof-${randomBytes(12).toString('hex')}`;
const name = `A3 Proof Admin ${suffix}`;
let accountId = '';

function loginRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify(body),
  });
}

function meRequest(token: string): NextRequest {
  return new NextRequest('http://localhost/api/admin/auth/me', {
    method: 'GET',
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
  });
}

describe('admin accounts: login -> attributed admin request -> removal (ipodhan_test)', () => {
  const repo = new AdminAccountRepository(db);

  beforeAll(async () => {
    const created = await repo.createAccount({ name, email: email.toUpperCase(), phone: '+919800000000', password });
    accountId = created.id;
  });

  afterAll(async () => {
    if (accountId) await db.delete(adminUsers).where(eq(adminUsers.id, accountId));
  });

  it('stores the email lowercased and never the plain password', async () => {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, accountId));
    expect(row.email).toBe(email);
    expect(row.passwordHash).not.toContain(password);
    expect(row.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('refuses a wrong password and an unknown email with the same generic 401', async () => {
    const wrong = await login(loginRequest({ email, password: `${password}x` }));
    const unknown = await login(loginRequest({ email: `nobody-${suffix}@example.test`, password }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('logs in, attributes the next admin request to the named admin, then loses access on removal', async () => {
    const res = await login(loginRequest({ email, password }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    const token = setCookie.split(';')[0].split('=')[1];
    expect(token.length).toBeGreaterThanOrEqual(40);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);

    // Only the token's hash is stored.
    const byRaw = await db.select().from(adminSessions).where(eq(adminSessions.id, token));
    expect(byRaw).toHaveLength(0);
    const hash = createHash('sha256').update(token).digest('hex');
    const byHash = await db.select().from(adminSessions).where(eq(adminSessions.id, hash));
    expect(byHash).toHaveLength(1);
    expect(byHash[0].adminUserId).toBe(accountId);

    const ok = await me(meRequest(token));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.data).toMatchObject({ adminId: accountId, adminName: name, isOwner: false });

    await repo.disableAccount(accountId);

    const after = await me(meRequest(token));
    expect(after.status).toBe(401);
  });
});
