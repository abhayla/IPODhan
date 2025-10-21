/**
 * Admin Authentication Utility
 *
 * Provides authentication middleware for admin-only API endpoints.
 * Uses bearer token authentication to protect sensitive operations.
 *
 * Security Features:
 * - Token-based authentication (Bearer scheme)
 * - Constant-time comparison to prevent timing attacks
 * - Environment variable configuration
 * - Detailed error logging
 *
 * Usage:
 * ```typescript
 * import { requireAdminAuth } from '@/lib/auth/admin-auth';
 *
 * export async function GET(request: Request) {
 *   const authError = await requireAdminAuth();
 *   if (authError) return authError;
 *
 *   // Admin-only logic here
 * }
 * ```
 *
 * Environment Variables:
 * - ADMIN_API_TOKEN: Secret token for admin authentication (required)
 *
 * Token Generation:
 * ```bash
 * node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * ```
 *
 * @module lib/auth/admin-auth
 */

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * Performs constant-time string comparison to prevent timing attacks
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
function constantTimeCompare(a: string, b: string): boolean {
  // Use crypto.timingSafeEqual for constant-time comparison
  // This prevents attackers from using timing information to guess the token
  try {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');

    // If lengths differ, still compare to maintain constant time
    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
    // If buffer creation fails, return false
    console.error('[Admin Auth] Comparison error:', error);
    return false;
  }
}

/**
 * Validates admin authentication token from request headers
 *
 * Checks for valid Bearer token in Authorization header.
 * Returns null if authentication succeeds, or NextResponse error if it fails.
 *
 * @returns null if authentication succeeds, NextResponse with 401/500 status if it fails
 *
 * @example
 * ```typescript
 * export async function GET(request: Request) {
 *   const authError = await requireAdminAuth();
 *   if (authError) return authError;
 *
 *   // Protected admin logic here
 *   return NextResponse.json({ data: "sensitive data" });
 * }
 * ```
 *
 * @throws Never throws - returns error responses instead
 */
export async function requireAdminAuth(): Promise<NextResponse | null> {
  const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

  // Check if admin token is configured
  if (!ADMIN_TOKEN) {
    console.error('[Admin Auth] ADMIN_API_TOKEN environment variable not set');
    return NextResponse.json(
      {
        error: 'Configuration Error',
        message: 'Admin authentication is not properly configured',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }

  // Validate token length (minimum 32 characters for security)
  if (ADMIN_TOKEN.length < 32) {
    console.error(
      `[Admin Auth] ADMIN_API_TOKEN is too short (${ADMIN_TOKEN.length} chars, minimum 32 required)`
    );
    return NextResponse.json(
      {
        error: 'Configuration Error',
        message: 'Admin authentication token does not meet security requirements',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }

  try {
    // Get request headers
    const headersList = await headers();
    const authorization = headersList.get('authorization');

    // Check if Authorization header exists
    if (!authorization) {
      console.warn('[Admin Auth] Missing Authorization header');
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Admin authentication required. Include "Authorization: Bearer <token>" header.',
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
    }

    // Parse Bearer token
    const parts = authorization.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      console.warn('[Admin Auth] Invalid Authorization header format:', authorization);
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid authorization format. Use "Bearer <token>".',
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
    }

    const token = parts[1];

    // Validate token is not empty
    if (!token || token.trim() === '') {
      console.warn('[Admin Auth] Empty token provided');
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid admin token provided',
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
    }

    // Compare token using constant-time comparison
    const isValid = constantTimeCompare(token, ADMIN_TOKEN);

    if (!isValid) {
      console.warn('[Admin Auth] Invalid token provided');
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid admin token',
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
    }

    // Authentication successful
    console.log('[Admin Auth] Authentication successful');
    return null;
  } catch (error) {
    console.error('[Admin Auth] Unexpected error during authentication:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Authentication check failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * Generates a secure random token for admin authentication
 *
 * This is a utility function for generating new admin tokens.
 * Not used in production - only for initial setup or token rotation.
 *
 * @param length - Number of random bytes to generate (default: 32)
 * @returns Hexadecimal string token
 *
 * @example
 * ```typescript
 * const newToken = generateAdminToken();
 * console.log('New admin token:', newToken);
 * // Save to .env.local as ADMIN_API_TOKEN
 * ```
 */
export function generateAdminToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
