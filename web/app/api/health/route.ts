import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * Health Check Endpoint
 *
 * Story: 8.4a - Production Deployment - Dev Machine Preparation
 * Purpose: Monitor application health for production deployment
 * Checks: Database connectivity, Redis connectivity
 *
 * Returns 200 if all services healthy, 503 if any service down
 */
export async function GET() {
  const timestamp = new Date().toISOString();
  let isHealthy = true;

  // Database health check
  let databaseStatus = 'unhealthy';
  let dbInfo: any = {};

  try {
    const result = await query('SELECT NOW() as current_time, version() as pg_version');
    dbInfo = result.rows[0];

    // Get table count
    const tableCount = await query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    databaseStatus = 'healthy';
    dbInfo.tables = parseInt(tableCount.rows[0].count);
  } catch (error) {
    console.error('[Health Check] Database check failed:', error);
    isHealthy = false;
    dbInfo.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Redis health check
  let redisStatus = 'unhealthy';
  let redisInfo: any = {};

  try {
    const redis = getRedisClient();
    const pingResult = await redis.ping();

    if (pingResult === 'PONG') {
      redisStatus = 'healthy';

      // Get Redis info
      const info = await redis.info('memory');
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      redisInfo.memoryUsed = memoryMatch ? memoryMatch[1] : 'unknown';
    }
  } catch (error) {
    console.error('[Health Check] Redis check failed:', error);
    isHealthy = false;
    redisInfo.error = error instanceof Error ? error.message : 'Unknown error';
  }

  const responseData = {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp,
    services: {
      database: databaseStatus,
      redis: redisStatus,
    },
    details: {
      database: {
        connected: databaseStatus === 'healthy',
        ...(dbInfo.current_time && { serverTime: dbInfo.current_time }),
        ...(dbInfo.pg_version && { version: dbInfo.pg_version }),
        ...(dbInfo.tables !== undefined && { tables: dbInfo.tables }),
        ...(dbInfo.error && { error: dbInfo.error }),
      },
      redis: {
        connected: redisStatus === 'healthy',
        ...(redisInfo.memoryUsed && { memoryUsed: redisInfo.memoryUsed }),
        ...(redisInfo.error && { error: redisInfo.error }),
      },
    },
    application: {
      name: process.env.NEXT_PUBLIC_APP_NAME || 'IPODhan',
      environment: process.env.NODE_ENV,
    },
  };

  // Return 503 if any service is unhealthy
  return NextResponse.json(responseData, {
    status: isHealthy ? 200 : 503,
  });
}
