/**
 * Admin Authentication Middleware (spec §9.2 item 6; OD-104, OD-113, OD-114)
 *
 * Two ways in, both behind the ADMIN_PANEL_ENABLED kill switch:
 *  1. A personal admin session cookie (a named admin who logged in with email + password). This is
 *     the only way a HUMAN is identified; the context carries that admin's own id and name.
 *  2. The Bearer ADMIN_AUTH_TOKEN, kept ONLY for non-human callers (the scraper's
 *     /api/admin/status/update and /api/admin/revalidate calls, scripts/audit-prod.mjs). Its identity
 *     is the fixed machine name "system:token", never a person, and it is never an owner.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  adminPanelEnabled,
  readCookie,
  resolveAdminSessionToken,
} from '@/lib/admin-accounts/admin-session';

export const MACHINE_TOKEN_IDENTITY = 'system:token';

export interface AdminAuthContext {
  adminId: string;
  adminName: string;
  isOwner: boolean;
  isAuthenticated: boolean;
}

function machineTokenMatches(token: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionTokenFrom(request: NextRequest): string | null {
  const fromCookies = request.cookies?.get?.(ADMIN_SESSION_COOKIE)?.value;
  return fromCookies ?? readCookie(request.headers.get('cookie'));
}

/**
 * Verify admin authentication. A valid session cookie wins over any Authorization header, so an
 * admin page that still sends a stale header is identified by its session.
 */
export async function verifyAdminAuth(request: NextRequest): Promise<AdminAuthContext | null> {
  if (!adminPanelEnabled()) {
    return null;
  }

  const session = await resolveAdminSessionToken(sessionTokenFrom(request));
  if (session) {
    return { ...session, isAuthenticated: true };
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (machineTokenMatches(token, process.env.ADMIN_AUTH_TOKEN || '')) {
      return {
        adminId: MACHINE_TOKEN_IDENTITY,
        adminName: MACHINE_TOKEN_IDENTITY,
        isOwner: false,
        isAuthenticated: true,
      };
    }
  }

  return null;
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Unauthorized',
      message: 'Admin authentication required',
    },
    { status: 401 }
  );
}

/**
 * Middleware wrapper for API routes requiring admin auth
 *
 * Note: Uses permissive typing to support handlers with different return types
 * (e.g., NextResponse<Success> | NextResponse<Error>)
 */
export function withAdminAuth(
  handler: (request: NextRequest, adminContext: AdminAuthContext, ...args: any[]) => Promise<any>
): (request: NextRequest, ...args: any[]) => Promise<any> {
  return async (request: NextRequest, ...args: any[]): Promise<any> => {
    let adminContext: AdminAuthContext | null;
    try {
      adminContext = await verifyAdminAuth(request);
    } catch {
      // A database error while reading the session fails closed.
      adminContext = null;
    }

    if (!adminContext) {
      return unauthorizedResponse();
    }

    return handler(request, adminContext, ...args);
  };
}

/** Owner-only guard for account management (OD-113). Returns a 403 response, or null to proceed. */
export function requireOwner(adminContext: AdminAuthContext): NextResponse | null {
  if (adminContext.isOwner !== true) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only the owner can manage admin accounts' },
      { status: 403 }
    );
  }
  return null;
}

/**
 * Get admin identity from request (for logging/audit trail)
 */
export async function getAdminIdentity(request: NextRequest): Promise<string> {
  try {
    const adminContext = await verifyAdminAuth(request);
    return adminContext?.adminName || 'Anonymous';
  } catch {
    return 'Anonymous';
  }
}

/**
 * Middleware for checking if admin panel is enabled
 */
export function checkAdminPanelEnabled(): boolean {
  return adminPanelEnabled();
}

/**
 * Generate admin auth token (for development/setup)
 * Run this script to generate a secure token
 */
export function generateAdminToken(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}
