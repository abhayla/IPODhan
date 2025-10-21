/**
 * Metrics API Endpoint
 *
 * Exposes business and system metrics in JSON format
 * for monitoring dashboards and alerting systems.
 */

import { NextResponse } from 'next/server';
import { collectBusinessMetrics, getDataQualityMetrics } from '@/lib/services/metrics-service';
import { monitorRedisHealth } from '@/scripts/monitor-redis';
import { checkDatabaseHealth } from '@/scripts/db-health-check';
import { logger } from '@/lib/logging/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs'; // Required for logger (uses Node.js APIs)

/**
 * GET /api/metrics
 * Returns comprehensive metrics for monitoring
 *
 * Query parameters:
 * - detailed=true: Include database and Redis health metrics (slower)
 */
export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get('detailed') === 'true';

    // Collect business metrics (always included)
    const businessMetrics = await collectBusinessMetrics();

    // Build response
    const response: any = {
      timestamp: new Date().toISOString(),
      business: businessMetrics,
    };

    // Add data quality metrics
    try {
      const dataQuality = await getDataQualityMetrics();
      response.dataQuality = dataQuality;
    } catch (error) {
      logger.warn('Failed to collect data quality metrics', { error });
    }

    // Add detailed metrics if requested
    if (detailed) {
      // Redis health metrics
      try {
        const redisMetrics = await monitorRedisHealth();
        response.redis = redisMetrics;
      } catch (error) {
        logger.warn('Failed to collect Redis metrics', { error });
        response.redis = { error: 'Failed to collect metrics' };
      }

      // Database health metrics
      try {
        const dbMetrics = await checkDatabaseHealth();
        response.database = dbMetrics;
      } catch (error) {
        logger.warn('Failed to collect database metrics', { error });
        response.database = { error: 'Failed to collect metrics' };
      }
    }

    // Add response metadata
    response.meta = {
      responseTime: Date.now() - startTime,
      detailed,
    };

    logger.info('Metrics endpoint called', {
      detailed,
      responseTime: response.meta.responseTime,
    });

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Metrics endpoint failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to collect metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
