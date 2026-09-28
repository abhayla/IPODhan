/**
 * POST /api/admin/auth/login -- a named admin signs in with email + password (spec §9.2 item 6,
 * OD-104, OD-114). PUBLIC by necessity (it is how a session is obtained); listed as the one public
 * admin route in tests/unit/api/admin/admin-routes-static-guard.test.ts.
 *
 * - Every refusal (unknown email, wrong password, removed admin, malformed input) returns the same
 *   generic 401 so the response never reveals which emails are admin accounts.
 * - Rate-limited twice (Tier A review M2): per client IP (stops one caller spraying many emails), and
 *   per email ALONE (rotating the IP, or forging a header, cannot buy more guesses at one account). The IP is CF-Connecting-IP or
 *   nginx's X-Real-IP, never the caller-written first X-Forwarded-For entry. When Redis is down both
 *   limits fall back to an in-process counter with the same limit instead of failing open.
 * - Sets an httpOnly, SameSite=Lax (Secure in production) cookie holding a random token; only its
 *   SHA-256 is stored.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/middleware/rate-limiter';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';
import { adminPanelEnabled } from '@/lib/admin-accounts/admin-session';
import { trustedClientIp } from '@/lib/admin-accounts/request-origin';
import { dummyPasswordHash, verifyPassword } from '@/lib/admin-accounts/password-hash';
import { normalizeEmail, PASSWORD_MAX } from '@/lib/admin-accounts/admin-account-validation';
import {
  ADMIN_SESSION_COOKIE,
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from '@/lib/admin-accounts/session-token';

// One caller, any accounts: 30 attempts per 15 minutes.
const LOGIN_IP_LIMIT = { maxRequests: 30, windowSeconds: 15 * 60, onStoreError: 'local' as const };
// One account, from anywhere: 10 guesses per 15 minutes in total.
const LOGIN_EMAIL_LIMIT = { maxRequests: 10, windowSeconds: 15 * 60, onStoreError: 'local' as const };

function genericRefusal(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized', message: 'Invalid email or password' },
    { status: 401 }
  );
}

export async function POST(request: NextRequest) {
  if (!adminPanelEnabled()) return genericRefusal();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericRefusal();
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    email.length === 0 ||
    email.length > 254 ||
    password.length === 0 ||
    password.length > PASSWORD_MAX
  ) {
    return genericRefusal();
  }
  const normalized = normalizeEmail(email);

  const limit = await checkRateLimit(trustedClientIp(request.headers), 'admin-login-ip', {
    ...LOGIN_IP_LIMIT,
    message: 'Too many sign-in attempts',
  });
  const emailLimit = await checkRateLimit('any-ip', `admin-login-email:${normalized}`, {
    ...LOGIN_EMAIL_LIMIT,
    message: 'Too many sign-in attempts',
  });
  if (!limit.allowed || !emailLimit.allowed) {
    return NextResponse.json(
      { error: 'Too Many Requests', message: 'Too many sign-in attempts. Try again later.' },
      { status: 429 }
    );
  }

  try {
    const repo = new AdminAccountRepository(db);
    const account = await repo.findForLogin(normalized);
    // Spend the same scrypt time whether or not the account exists.
    const passwordOk = await verifyPassword(password, account?.passwordHash ?? (await dummyPasswordHash()));
    if (!account || account.disabledAt !== null || !passwordOk) {
      logger.warn({ outcome: 'refused' }, 'Admin sign-in refused');
      return genericRefusal();
    }

    const token = generateSessionToken();
    await repo.createSession(hashSessionToken(token), account.id);
    logger.info({ adminId: account.id }, 'Admin signed in');

    const response = NextResponse.json({
      success: true,
      data: { adminId: account.id, adminName: account.name, isOwner: account.isOwner },
    });
    response.cookies.set(ADMIN_SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : 'unknown' }, 'Admin sign-in failed');
    return NextResponse.json(
      { error: 'Internal Server Error', message: 'Sign-in failed' },
      { status: 500 }
    );
  }
}
