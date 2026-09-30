/**
 * The ONE server-side session check for every admin page: app/admin/(protected)/layout.tsx.
 *
 * Runs the REAL layout over the REAL getAdminSessionFromCookies -> resolveAdminSessionToken ->
 * evaluateSession chain; only the cookie store, the account repository and the client chrome are
 * faked. Each refused case asserts the redirect to /admin/login AND that the child page's render
 * function was never called. The login page is outside the (protected) group, so its root
 * layout must render without any session (no redirect loop).
 *
 * Scope of "the child is never rendered": it proves the LAYOUT does not render its child. It does
 * not prove the App Router skips the child page; it does not (measured on a production build,
 * see the layout's header), which is why every admin page keeps its own check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

const WELL_FORMED = 'A'.repeat(43);

const cookieStore = { value: null as string | null };
const findSessionWithAccount = vi.fn();
const touchSession = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ipodhan_admin_session' && cookieStore.value !== null ? { value: cookieStore.value } : undefined,
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/admin-accounts/admin-account-repository', () => ({
  AdminAccountRepository: vi.fn().mockImplementation(() => ({ findSessionWithAccount, touchSession })),
}));
vi.mock('@/components/admin/AdminShell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => <div data-testid="admin-shell">{children}</div>,
}));
vi.mock('@/lib/context/AdminAuthContext', () => ({
  AdminAuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function sessionRow(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    sessionId: 's1',
    createdAt: new Date(now - 60_000),
    expiresAt: new Date(now + 60 * 60_000),
    lastSeenAt: new Date(now - 1_000),
    adminUserId: 'a1',
    name: 'Admin One',
    isOwner: false,
    disabledAt: null,
    ...overrides,
  };
}

async function loadProtectedLayout() {
  return (await import('@/app/admin/(protected)/layout')).default;
}

describe('app/admin/(protected)/layout.tsx: one server-side session check before any child renders', () => {
  const Child = vi.fn(() => <p>ADMIN-CHILD-OUTPUT</p>);
  let prevFlag: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    prevFlag = process.env.ADMIN_PANEL_ENABLED;
    process.env.ADMIN_PANEL_ENABLED = 'true';
    cookieStore.value = null;
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.ADMIN_PANEL_ENABLED;
    else process.env.ADMIN_PANEL_ENABLED = prevFlag;
  });

  const refused: Array<[string, () => void]> = [
    ['no session cookie', () => {}],
    ['a malformed cookie', () => { cookieStore.value = 'not-a-token'; }],
    ['an unknown session', () => { cookieStore.value = WELL_FORMED; findSessionWithAccount.mockResolvedValue(null); }],
    ['an expired session', () => {
      cookieStore.value = WELL_FORMED;
      findSessionWithAccount.mockResolvedValue(sessionRow({ expiresAt: new Date(Date.now() - 1_000) }));
    }],
    ['a disabled account', () => {
      cookieStore.value = WELL_FORMED;
      findSessionWithAccount.mockResolvedValue(sessionRow({ disabledAt: new Date() }));
    }],
    ['a database error', () => { cookieStore.value = WELL_FORMED; findSessionWithAccount.mockRejectedValue(new Error('db down')); }],
    ['the admin panel switched off, even with a valid session', () => {
      process.env.ADMIN_PANEL_ENABLED = 'false';
      cookieStore.value = WELL_FORMED;
      findSessionWithAccount.mockResolvedValue(sessionRow());
    }],
  ];

  it.each(refused)('%s -> redirect to /admin/login and the child is never rendered', async (_label, arrange) => {
    arrange();
    const Layout = await loadProtectedLayout();

    await expect(Layout({ children: <Child /> })).rejects.toThrow('REDIRECT:/admin/login');

    expect(redirect).toHaveBeenCalledWith('/admin/login');
    expect(Child).not.toHaveBeenCalled();
  });

  it('a valid session -> the shell and the child render, no redirect', async () => {
    cookieStore.value = WELL_FORMED;
    findSessionWithAccount.mockResolvedValue(sessionRow());
    const Layout = await loadProtectedLayout();

    const element = await Layout({ children: <Child /> });
    const html = renderToStaticMarkup(element as React.ReactElement);

    expect(redirect).not.toHaveBeenCalled();
    expect(Child).toHaveBeenCalled();
    expect(html).toContain('data-testid="admin-shell"');
    expect(html).toContain('ADMIN-CHILD-OUTPUT');
  });
});

describe('/admin/login stays reachable without a session (no redirect loop)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('the root admin layout renders its child with no session and never redirects', async () => {
    const RootLayout = (await import('@/app/admin/layout')).default;
    const html = renderToStaticMarkup(<RootLayout><p>LOGIN-FORM</p></RootLayout>);

    expect(html).toContain('LOGIN-FORM');
    expect(redirect).not.toHaveBeenCalled();
  });

  const ADMIN_ROOT = path.resolve(__dirname, '../../../../app/admin');

  function pages(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return pages(full);
      return /^(page|route)\.(tsx|ts|js)$/.test(e.name) ? [path.relative(ADMIN_ROOT, full).split(path.sep).join('/')] : [];
    });
  }

  it('login is the ONLY admin page outside the (protected) group, so every other admin page is covered by construction', () => {
    const outside = pages(ADMIN_ROOT).filter((rel) => !rel.startsWith('(protected)/'));
    expect(outside).toEqual(['login/page.tsx']);
  });

  it('the login page is not under the (protected) group (a guard there would loop)', () => {
    expect(fs.existsSync(path.join(ADMIN_ROOT, '(protected)', 'login'))).toBe(false);
  });
});
