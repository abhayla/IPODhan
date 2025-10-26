/**
 * Admin Authentication Middleware
 * Protects admin-only routes from unauthorized access
 *
 * Phase 1: Simple token-based authentication
 * Phase 2: Can be upgraded to NextAuth.js or similar
 */

import { NextRequest, NextResponse } from 'next/server';

// Environment configuration
const ADMIN_TOKEN = process.env.ADMIN_AUTH_TOKEN || '';
const ADMIN_ENABLED = process.env.ADMIN_PANEL_ENABLED === 'true';

export interface AdminAuthContext {
  adminId: string;
  adminName: string;
  isAuthenticated: boolean;
}

/**
 * Verify admin authentication from request headers
 */
export function verifyAdminAuth(request: NextRequest): AdminAuthContext | null {
  // Check if admin panel is enabled
  if (!ADMIN_ENABLED) {
    return null;
  }

  // Get token from Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Verify token
  if (token !== ADMIN_TOKEN || !ADMIN_TOKEN) {
    return null;
  }

  // Return admin context
  return {
    adminId: 'admin-1', // Phase 1: Single admin
    adminName: 'Admin',
    isAuthenticated: true,
  };
}

/**
 * Middleware wrapper for API routes requiring admin auth
 */
export function withAdminAuth(
  handler: (
    request: NextRequest,
    adminContext: AdminAuthContext,
    ...args: any[]
  ) => Promise<NextResponse<any>>
) {
  return async (request: NextRequest, ...args: any[]): Promise<NextResponse<any>> => {
    // Verify authentication
    const adminContext = verifyAdminAuth(request);

    if (!adminContext) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Admin authentication required',
        },
        { status: 401 }
      );
    }

    // Call the handler with admin context
    return handler(request, adminContext, ...args);
  };
}

/**
 * Get admin identity from request (for logging/audit trail)
 */
export function getAdminIdentity(request: NextRequest): string {
  const adminContext = verifyAdminAuth(request);
  return adminContext?.adminName || 'Anonymous';
}

/**
 * Middleware for checking if admin panel is enabled
 */
export function checkAdminPanelEnabled(): boolean {
  return ADMIN_ENABLED;
}

/**
 * Generate admin auth token (for development/setup)
 * Run this script to generate a secure token
 */
export function generateAdminToken(): string {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}
