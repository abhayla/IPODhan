/**
 * Enhanced Detailed Health Check Endpoint
 *
 * Returns comprehensive system health status including database,
 * Redis, memory, and overall application health with detailed metrics.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { testRedisConnection } from '@/lib/cache/redis-client';
import { sql } from 'drizzle-orm';
import { logger } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';

interface DetailedHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: {
      status: 'healthy' | 'unhealthy';
      responseTime: number;
      connectionCount?: number;
      error?: string;
    };
    redis: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      responseTime: number;
      error?: string;
    };
    memory: {
      status: 'healthy' | 'warning' | 'critical';
      heapUsedMB: number;
      heapTotalMB: number;
      usagePercent: number;
      rss: number;
      external: number;
    };
  };
  version?: string;
}

/**
 * GET /api/health-detailed
 * Detailed health check endpoint with extended metrics
 */
export async function GET() {
  const startTime = Date.now();

  const healthStatus: DetailedHealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    checks: {
      database: { status: 'unhealthy', responseTime: 0 },
      redis: { status: 'unhealthy', responseTime: 0 },
      memory: {
        status: 'healthy',
        heapUsedMB: 0,
        heapTotalMB: 0,
        usagePercent: 0,
        rss: 0,
        external: 0,
      },
    },
  };

  // Check database with connection count
  try {
    const dbStart = Date.now();
    const [healthCheck, connCount] = await Promise.all([
      db.execute(sql`SELECT 1 as health_check`),
      db.execute(sql`
        SELECT numbackends as count
        FROM pg_stat_database
        WHERE datname = current_database()
      `),
    ]);
    const dbResponseTime = Date.now() - dbStart;

    healthStatus.checks.database = {
      status: dbResponseTime < 100 ? 'healthy' : 'unhealthy',
      responseTime: dbResponseTime,
      connectionCount: Number(connCount.rows[0]?.count || 0),
    };

    if (dbResponseTime >= 100) {
      healthStatus.status = 'degraded';
      logger.warn('Database health check slow', { responseTime: dbResponseTime });
    }
  } catch (error) {
    healthStatus.status = 'unhealthy';
    healthStatus.checks.database = {
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
    logger.error('Database health check failed', { error });
  }

  // Check Redis
  try {
    const redisStart = Date.now();
    const redisHealthy = await testRedisConnection();
    const redisResponseTime = Date.now() - redisStart;

    let redisStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!redisHealthy) {
      redisStatus = 'degraded';
      if (healthStatus.status === 'healthy') {
        healthStatus.status = 'degraded';
      }
    } else if (redisResponseTime > 100) {
      redisStatus = 'degraded';
      if (healthStatus.status === 'healthy') {
        healthStatus.status = 'degraded';
      }
    }

    healthStatus.checks.redis = {
      status: redisStatus,
      responseTime: redisResponseTime,
    };
  } catch (error) {
    healthStatus.checks.redis = {
      status: 'degraded',
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Redis connection failed',
    };
    if (healthStatus.status === 'healthy') {
      healthStatus.status = 'degraded';
    }
  }

  // Detailed memory usage
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const usagePercent = Math.round((heapUsedMB / heapTotalMB) * 100);

  let memoryStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (heapUsedMB > 800) {
    memoryStatus = 'critical';
    healthStatus.status = 'unhealthy';
  } else if (heapUsedMB > 500) {
    memoryStatus = 'warning';
    if (healthStatus.status === 'healthy') {
      healthStatus.status = 'degraded';
    }
  }

  healthStatus.checks.memory = {
    status: memoryStatus,
    heapUsedMB,
    heapTotalMB,
    usagePercent,
    rss: Math.round(memUsage.rss / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };

  if (process.env.APP_VERSION) {
    healthStatus.version = process.env.APP_VERSION;
  }

  const statusCode = healthStatus.status === 'unhealthy' ? 503 : 200;

  return NextResponse.json(healthStatus, { status: statusCode });
}
