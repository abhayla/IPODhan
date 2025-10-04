import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // Test database connection
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    const dbInfo = result.rows[0];

    // Get table count
    const tableCount = await query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        serverTime: dbInfo.current_time,
        version: dbInfo.pg_version,
        tables: parseInt(tableCount.rows[0].count),
      },
      service: {
        name: process.env.NEXT_PUBLIC_APP_NAME || 'IPODhan',
        environment: process.env.NODE_ENV,
      },
    });
  } catch (error) {
    console.error('Health check failed:', error);

    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        database: {
          connected: false,
        },
      },
      { status: 500 }
    );
  }
}
