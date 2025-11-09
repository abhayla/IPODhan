/**
 * Database Statistics API Endpoint
 *
 * Provides real-time database connection pool and retry statistics for monitoring.
 *
 * Endpoints:
 * - GET /api/db-stats - Get current pool stats and retry statistics
 *
 * Usage:
 * ```bash
 * curl http://localhost:3000/api/db-stats
 * ```
 *
 * Response:
 * ```json
 * {
 *   "timestamp": "2025-11-09T10:00:00.000Z",
 *   "pool": {
 *     "total": 12,
 *     "idle": 8,
 *     "waiting": 0,
 *     "max": 50,
 *     "utilization": "24%",
 *     "status": "healthy"
 *   },
 *   "retry": {
 *     "totalRetries": 45,
 *     "retryReasons": {
 *       "53300": 12,
 *       "ETIMEDOUT": 8
 *     },
 *     "avgRetryDelay": 234,
 *     "maxRetryAttempts": 2
 *   },
 *   "health": {
 *     "database": "healthy",
 *     "latency": 12
 *   }
 * }
 * ```
 *
 * @module app/api/db-stats
 */

import { NextResponse } from 'next/server';
import { getPoolStats } from '@/lib/db';
import { getRetryStats } from '@/lib/db/connection-retry';

/**
 * GET /api/db-stats
 *
 * Returns database connection pool statistics and retry metrics
 */
export async function GET() {
  try {
    // Get connection pool stats
    const poolStats = getPoolStats();

    // Get retry statistics
    const retryStats = getRetryStats();

    // Calculate pool utilization percentage
    const utilization = poolStats.max > 0
      ? Math.round((poolStats.total / poolStats.max) * 100)
      : 0;

    // Determine pool health status
    let poolStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (poolStats.waiting > 10) {
      poolStatus = 'critical'; // High contention
    } else if (poolStats.waiting > 5 || utilization > 80) {
      poolStatus = 'warning'; // Approaching saturation
    }

    // Build response
    const response = {
      timestamp: new Date().toISOString(),
      pool: {
        total: poolStats.total,
        idle: poolStats.idle,
        waiting: poolStats.waiting,
        max: poolStats.max,
        utilization: `${utilization}%`,
        status: poolStatus,
        alerts: getPoolAlerts(poolStats, utilization),
      },
      retry: {
        totalRetries: retryStats.totalRetries,
        retryReasons: retryStats.retryReasons,
        avgRetryDelay: Math.round(retryStats.avgRetryDelay),
        maxRetryAttempts: retryStats.maxRetryAttempts,
        alerts: getRetryAlerts(retryStats),
      },
      recommendations: getRecommendations(poolStats, utilization, retryStats),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[API] /db-stats error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve database statistics',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * Generate alerts based on pool statistics
 */
function getPoolAlerts(
  poolStats: ReturnType<typeof getPoolStats>,
  utilization: number
): string[] {
  const alerts: string[] = [];

  if (poolStats.waiting > 10) {
    alerts.push(
      `CRITICAL: ${poolStats.waiting} queries waiting for connection (high contention)`
    );
  } else if (poolStats.waiting > 5) {
    alerts.push(
      `WARNING: ${poolStats.waiting} queries waiting for connection`
    );
  }

  if (utilization > 90) {
    alerts.push(
      `CRITICAL: Pool utilization at ${utilization}% (approaching limit)`
    );
  } else if (utilization > 80) {
    alerts.push(`WARNING: Pool utilization at ${utilization}%`);
  }

  if (poolStats.idle === 0 && poolStats.total > 0) {
    alerts.push('WARNING: No idle connections available (all in use)');
  }

  return alerts;
}

/**
 * Generate alerts based on retry statistics
 */
function getRetryAlerts(retryStats: ReturnType<typeof getRetryStats>): string[] {
  const alerts: string[] = [];

  if (retryStats.totalRetries > 100) {
    alerts.push(
      `WARNING: High retry count (${retryStats.totalRetries} total retries)`
    );
  }

  if (retryStats.maxRetryAttempts >= 3) {
    alerts.push(
      `WARNING: Some queries required maximum retries (${retryStats.maxRetryAttempts})`
    );
  }

  // Check for specific error patterns
  const poolExhaustionRetries =
    retryStats.retryReasons['53300'] || 0; // too_many_connections
  if (poolExhaustionRetries > 10) {
    alerts.push(
      `WARNING: Frequent pool exhaustion errors (${poolExhaustionRetries} retries)`
    );
  }

  const timeoutRetries =
    (retryStats.retryReasons['ETIMEDOUT'] || 0) +
    (retryStats.retryReasons['57014'] || 0);
  if (timeoutRetries > 10) {
    alerts.push(
      `WARNING: Frequent timeout errors (${timeoutRetries} retries)`
    );
  }

  return alerts;
}

/**
 * Generate recommendations based on current metrics
 */
function getRecommendations(
  poolStats: ReturnType<typeof getPoolStats>,
  utilization: number,
  retryStats: ReturnType<typeof getRetryStats>
): string[] {
  const recommendations: string[] = [];

  // Pool size recommendations
  if (utilization > 80 || poolStats.waiting > 5) {
    recommendations.push(
      'Consider increasing database connection pool size (current max: 50)'
    );
  }

  // Retry pattern recommendations
  if (retryStats.totalRetries > 50) {
    if (retryStats.retryReasons['53300'] > 10) {
      recommendations.push(
        'High pool exhaustion rate detected - increase pool size or optimize query performance'
      );
    }

    if (
      retryStats.retryReasons['ETIMEDOUT'] > 10 ||
      retryStats.retryReasons['57014'] > 10
    ) {
      recommendations.push(
        'High timeout rate detected - check database performance and network latency'
      );
    }

    if (retryStats.retryReasons['40001'] > 5) {
      recommendations.push(
        'Serialization failures detected - review transaction isolation levels'
      );
    }
  }

  // Connection efficiency recommendations
  if (poolStats.idle / poolStats.total > 0.8 && poolStats.total > 10) {
    recommendations.push(
      'Many idle connections - consider reducing minimum pool size to save resources'
    );
  }

  if (recommendations.length === 0) {
    recommendations.push('Database connection health is optimal');
  }

  return recommendations;
}
