/**
 * Database Connection Test Endpoint (Admin Only)
 *
 * GET /api/db-test
 * Tests database connectivity and returns PostgreSQL version
 *
 * SECURITY: Requires admin authentication
 * Include header: Authorization: Bearer <ADMIN_API_TOKEN>
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

export async function GET() {
  // Require admin authentication
  const authError = await requireAdminAuth();
  if (authError) return authError;
  // #1142: the app's own pool (web/lib/db), never a second ad-hoc pool, so
  // this endpoint tests the connection the site actually serves from.
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    const version = result.rows[0].version;
    client.release();

    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      version,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error, '/api/db-test');
  }
}
