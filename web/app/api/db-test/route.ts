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
import { Pool } from 'pg';
import { requireAdminAuth } from '@/lib/auth/admin-auth';

export async function GET() {
  // Require admin authentication
  const authError = await requireAdminAuth();
  if (authError) return authError;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    const version = result.rows[0].version;
    client.release();
    await pool.end();

    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      version,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        message: 'Database connection failed',
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
