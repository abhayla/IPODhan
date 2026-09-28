/**
 * Unit guards for spec §9.2 item 6 (OD-104, OD-113, OD-114): password hashing, the session decision
 * (unknown / expired / disabled refused), the owner-only guard, cookie flags, the machine-token
 * identity, input validation and the owner bootstrap refusal. Each guard has a named test that goes
 * red when the guard line is removed (mutation list in the PR body).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db/index', () => {
  throw new Error('db must not be reached by these unit tests');
});

import { hashPassword, verifyPassword } from '@/lib/admin-accounts/password-hash';
import {
  evaluateSession,
  getAdminSessionFromCookies,
  readCookie,
  resolveAdminSessionToken,
} from '@/lib/admin-accounts/admin-session';
import {
  ADMIN_SESSION_COOKIE,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from '@/lib/admin-accounts/session-token';
import type { AdminAccountRepository, SessionWithAccount } from '@/lib/admin-accounts/admin-account-repository';
import { requireOwner, verifyAdminAuth, withAdminAuth, MACHINE_TOKEN_IDENTITY } from '@/lib/middleware/admin-auth';
import { validateAccountInput, validateEmail, validatePassword } from '@/lib/admin-accounts/admin-account-validation';
import { decideOwnerBootstrap } from '@/lib/admin-accounts/owner-bootstrap';

const NOW = new Date('2026-09-28T12:00:00.000Z');

function row(over: Partial<SessionWithAccount> = {}): SessionWithAccount {
  return {
    sessionId: 'h',
    expiresAt: new Date(NOW.getTime() + 60_000),
    lastSeenAt: NOW,
    adminUserId: 'u-1',
    name: 'Asha Admin',
    isOwner: false,
    disabledAt: null,
    ...over,
  };
}

function fakeRepo(found: SessionWithAccount | null) {
  const calls = { find: [] as string[], touch: [] as string[] };
  const repo = {
    findSessionWithAccount: vi.fn(async (h: string) => {
      calls.find.push(h);
      return found;
    }),
    touchSession: vi.fn(async (h: string) => {
      calls.touch.push(h);
    }),
  } as unknown as AdminAccountRepository;
  return { repo, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('password hashing (scrypt)', () => {
  it('never stores the password and verifies only the right one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toContain('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
  });

  it('salts every hash and refuses a malformed stored value without throwing', async () => {
    expect(await hashPassword('same-password-12')).not.toBe(await hashPassword('same-password-12'));
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$0$8$1$$')).toBe(false);
  });
});

describe('session decision', () => {
  it('refuses an unknown session', () => {
    expect(evaluateSession(null, NOW)).toBeNull();
  });
  it('refuses a disabled account (removal is immediate)', () => {
    expect(evaluateSession(row({ disabledAt: new Date(NOW.getTime() - 1) }), NOW)).toBeNull();
  });
  it('refuses an expired session', () => {
    expect(evaluateSession(row({ expiresAt: NOW }), NOW)).toBeNull();
    expect(evaluateSession(row({ expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBeNull();
  });
  it('accepts a live session and names its admin', () => {
    expect(evaluateSession(row({ isOwner: true }), NOW)).toEqual({ adminId: 'u-1', adminName: 'Asha Admin', isOwner: true });
  });
});

describe('resolveAdminSessionToken', () => {
  it('looks the session up by the token HASH, never the token', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    const token = generateSessionToken();
    const { repo, calls } = fakeRepo(row());
    expect(await resolveAdminSessionToken(token, repo, NOW)).toMatchObject({ adminName: 'Asha Admin' });
    expect(calls.find).toEqual([hashSessionToken(token)]);
    expect(calls.find[0]).not.toBe(token);
  });

  it('reads the database on every call, so a disabled account is refused at once', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    const token = generateSessionToken();
    const live = row();
    const { repo } = fakeRepo(live);
    expect(await resolveAdminSessionToken(token, repo, NOW)).not.toBeNull();
    live.disabledAt = NOW;
    expect(await resolveAdminSessionToken(token, repo, NOW)).toBeNull();
  });

  it('refuses without touching the database when the kill switch is off or the token is malformed', async () => {
    const { repo, calls } = fakeRepo(row());
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'false');
    expect(await resolveAdminSessionToken(generateSessionToken(), repo, NOW)).toBeNull();
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    expect(await resolveAdminSessionToken('short', repo, NOW)).toBeNull();
    expect(await resolveAdminSessionToken(null, repo, NOW)).toBeNull();
    expect(calls.find).toHaveLength(0);
  });

  it('slides the expiry only when the session was last seen over an hour ago', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    const fresh = fakeRepo(row({ lastSeenAt: new Date(NOW.getTime() - 60_000) }));
    await resolveAdminSessionToken(generateSessionToken(), fresh.repo, NOW);
    expect(fresh.calls.touch).toHaveLength(0);
    const stale = fakeRepo(row({ lastSeenAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }));
    await resolveAdminSessionToken(generateSessionToken(), stale.repo, NOW);
    expect(stale.calls.touch).toHaveLength(1);
  });
});

describe('getAdminSessionFromCookies (public page helper)', () => {
  it('returns null, never throws, for a reader whose cookie lookup fails', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ get: () => ({ value: generateSessionToken() }) }),
    }));
    // The db module throws on import (mocked above): the helper must swallow it.
    await expect(getAdminSessionFromCookies()).resolves.toBeNull();
    vi.doUnmock('next/headers');
  });

  it('returns null outside a request scope', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    vi.doMock('next/headers', () => ({
      cookies: async () => {
        throw new Error('outside request scope');
      },
    }));
    await expect(getAdminSessionFromCookies()).resolves.toBeNull();
    vi.doUnmock('next/headers');
  });
});

describe('session cookie', () => {
  it('is httpOnly, SameSite=Lax, site-wide, and Secure only in production', () => {
    const dev = sessionCookieOptions({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(dev).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    expect(sessionCookieOptions({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).secure).toBe(true);
  });
  it('is read back from a raw Cookie header', () => {
    expect(readCookie(`a=1; ${ADMIN_SESSION_COOKIE}=tok; b=2`)).toBe('tok');
    expect(readCookie('a=1')).toBeNull();
  });
});

describe('owner-only guard', () => {
  it('answers a non-owner admin with 403', async () => {
    const res = requireOwner({ adminId: 'u-2', adminName: 'B', isOwner: false, isAuthenticated: true });
    expect(res?.status).toBe(403);
  });
  it('lets the owner through', () => {
    expect(requireOwner({ adminId: 'u-1', adminName: 'O', isOwner: true, isAuthenticated: true })).toBeNull();
  });
});

describe('machine token path', () => {
  function bearer(token: string): NextRequest {
    return new NextRequest('http://localhost/api/admin/x', { headers: { authorization: `Bearer ${token}` } });
  }

  it('identifies the Bearer token as system:token, never a person, never an owner', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    vi.stubEnv('ADMIN_AUTH_TOKEN', 'machine-secret-value');
    expect(await verifyAdminAuth(bearer('machine-secret-value'))).toEqual({
      adminId: MACHINE_TOKEN_IDENTITY,
      adminName: MACHINE_TOKEN_IDENTITY,
      isOwner: false,
      isAuthenticated: true,
    });
    expect(await verifyAdminAuth(bearer('wrong'))).toBeNull();
  });

  it('refuses everything when the kill switch is off', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'false');
    vi.stubEnv('ADMIN_AUTH_TOKEN', 'machine-secret-value');
    expect(await verifyAdminAuth(bearer('machine-secret-value'))).toBeNull();
  });

  it('fails closed (401) when the session lookup errors', async () => {
    vi.stubEnv('ADMIN_PANEL_ENABLED', 'true');
    const handler = vi.fn();
    const req = new NextRequest('http://localhost/api/admin/x', {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${generateSessionToken()}` },
    });
    const res = await withAdminAuth(handler)(req);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('account input validation', () => {
  it('lowercases email and accepts the four OD-114 fields', () => {
    const r = validateAccountInput({ name: ' Ravi ', email: 'Ravi@Example.COM', phone: '+91 98765-43210', telegramId: '@ravi_k' });
    expect(r).toEqual({ ok: true, value: { name: 'Ravi', email: 'ravi@example.com', phone: '+919876543210', telegramId: '@ravi_k' } });
  });
  it('refuses a bad email, phone, telegram id or short password', () => {
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validateAccountInput({ name: 'A', email: 'a@b.co', phone: '12ab' }).ok).toBe(false);
    expect(validateAccountInput({ name: 'A', email: 'a@b.co', phone: '9876543210', telegramId: 'x y' }).ok).toBe(false);
    expect(validateAccountInput({ name: '', email: 'a@b.co', phone: '9876543210' }).ok).toBe(false);
    expect(validatePassword('short').ok).toBe(false);
  });
});

describe('owner bootstrap decision', () => {
  it('refuses a second owner, even on a dry run', () => {
    expect(decideOwnerBootstrap({ apply: false, dbName: 'ipodhan_test', allowProd: false, ownerExists: true }).action).toBe('refuse');
    expect(decideOwnerBootstrap({ apply: true, dbName: 'ipodhan_test', allowProd: true, ownerExists: true }).action).toBe('refuse');
  });
  it('refuses --apply on the production database without --allow-prod', () => {
    expect(decideOwnerBootstrap({ apply: true, dbName: 'ipodhan', allowProd: false, ownerExists: false }).action).toBe('refuse');
    expect(decideOwnerBootstrap({ apply: true, dbName: 'IPODHAN', allowProd: false, ownerExists: false }).action).toBe('refuse');
    expect(decideOwnerBootstrap({ apply: true, dbName: 'ipodhan', allowProd: true, ownerExists: false }).action).toBe('create');
  });
  it('dry-runs by default and creates on a non-prod --apply', () => {
    expect(decideOwnerBootstrap({ apply: false, dbName: 'ipodhan', allowProd: false, ownerExists: false }).action).toBe('dry-run');
    expect(decideOwnerBootstrap({ apply: true, dbName: 'ipodhan_staging', allowProd: false, ownerExists: false }).action).toBe('create');
  });
});
