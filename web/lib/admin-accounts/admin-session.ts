/**
 * Resolves an admin session cookie to the admin it belongs to (spec §9.2 item 6).
 *
 * `evaluateSession` is the single decision every path goes through: an unknown, expired or disabled
 * session is refused. The database is read on every call (no cache), so a removed admin loses access
 * on the next request (OD-113).
 */
import {
  ADMIN_SESSION_COOKIE,
  SESSION_TOUCH_INTERVAL_MS,
  hashSessionToken,
  isWellFormedSessionToken,
} from './session-token';
import type { AdminAccountRepository, SessionWithAccount } from './admin-account-repository';

export { ADMIN_SESSION_COOKIE };

export interface AdminSessionIdentity {
  adminId: string;
  adminName: string;
  isOwner: boolean;
}

/** The ADMIN_PANEL_ENABLED kill switch, read per call so it cannot be frozen at import time. */
export function adminPanelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ADMIN_PANEL_ENABLED === 'true';
}

export function evaluateSession(row: SessionWithAccount | null, now: Date): AdminSessionIdentity | null {
  if (!row) return null;
  if (row.disabledAt !== null) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return { adminId: row.adminUserId, adminName: row.name, isOwner: row.isOwner };
}

export async function defaultAdminAccountRepository(): Promise<AdminAccountRepository> {
  const [{ db }, { AdminAccountRepository: Repo }] = await Promise.all([
    import('@/lib/db/index'),
    import('./admin-account-repository'),
  ]);
  return new Repo(db);
}

/**
 * Cookie token -> admin, or null. Throws only on a database error; a caller that must never throw
 * (a public page) uses getAdminSessionFromCookies.
 */
export async function resolveAdminSessionToken(
  token: string | null | undefined,
  repo?: AdminAccountRepository,
  now: Date = new Date()
): Promise<AdminSessionIdentity | null> {
  if (!adminPanelEnabled()) return null;
  if (!isWellFormedSessionToken(token)) return null;
  const r = repo ?? (await defaultAdminAccountRepository());
  const tokenHash = hashSessionToken(token);
  const row = await r.findSessionWithAccount(tokenHash);
  const identity = evaluateSession(row, now);
  if (!identity || !row) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > SESSION_TOUCH_INTERVAL_MS) {
    await r.touchSession(tokenHash, now);
  }
  return identity;
}

/** Reads one cookie out of a raw `Cookie:` header. */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string = ADMIN_SESSION_COOKIE
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eqAt = part.indexOf('=');
    if (eqAt === -1) continue;
    if (part.slice(0, eqAt).trim() === name) return part.slice(eqAt + 1).trim() || null;
  }
  return null;
}

/**
 * For server components: the public IPO page shows its Edit control from this (OD-102, OD-104).
 * Never throws: a reader with no cookie, a bad cookie, or a database error gets null.
 */
export async function getAdminSessionFromCookies(): Promise<AdminSessionIdentity | null> {
  try {
    if (!adminPanelEnabled()) return null;
    const { cookies } = await import('next/headers');
    const store = await cookies();
    return await resolveAdminSessionToken(store.get(ADMIN_SESSION_COOKIE)?.value ?? null);
  } catch {
    return null;
  }
}
