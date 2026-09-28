/**
 * Admin session token: 32 random bytes in the cookie, only its SHA-256 hex stored in
 * admin_sessions.id. A copied table row cannot be replayed as a cookie.
 */
import { createHash, randomBytes } from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'ipodhan_admin_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// Sliding expiry: extend at most once an hour so a busy admin does not write on every request.
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A token we issued is 43 base64url chars; anything else is refused before touching the DB. */
export function isWellFormedSessionToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

export function sessionCookieOptions(env: NodeJS.ProcessEnv = process.env): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    // '/' so the public IPO page's server components can recognise a signed-in admin (OD-104).
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
