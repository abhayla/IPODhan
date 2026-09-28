/**
 * POST /api/admin/auth/logout -- ends the caller's own session: deletes its row and clears the cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { AdminAccountRepository } from '@/lib/admin-accounts/admin-account-repository';
import { readCookie } from '@/lib/admin-accounts/admin-session';
import {
  ADMIN_SESSION_COOKIE,
  hashSessionToken,
  isWellFormedSessionToken,
  sessionCookieOptions,
} from '@/lib/admin-accounts/session-token';

export const POST = withAdminAuth(async (request: NextRequest, _admin: AdminAuthContext) => {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? readCookie(request.headers.get('cookie'));
  if (isWellFormedSessionToken(token)) {
    await new AdminAccountRepository(db).deleteSession(hashSessionToken(token));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return response;
});
