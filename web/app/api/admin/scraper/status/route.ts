/**
 * Admin API: Scraper Status Endpoint
 *
 * GET /api/admin/scraper/status
 * Returns current status and health of all scrapers
 * Story 7.5: Error Handling & Monitoring
 *
 * SECURITY: Requires admin authentication
 * Include header: Authorization: Bearer <ADMIN_API_TOKEN>
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import type { ScraperSource } from '@/lib/db/types';
import { adminRateLimiter } from '@/lib/middleware/rate-limiter';

/**
 * Health status calculation
 */
type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

function calculateHealthStatus(
  successRates: number[],
  lastRuns: (Date | null)[]
): HealthStatus {
  // CRITICAL: Any scraper < 70% success rate OR ran-before-but-now-stale (>2h).
  // A null lastRun means "never ran", NOT "stale" — API_FALLBACK only runs on
  // demand and is legitimately null, so treating null as stale produced a
  // permanent false CRITICAL even while NSE/BSE were ~100% (GitHub #3).
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const hasLowSuccessRate = successRates.some(rate => rate < 70);
  const hasStaleData = lastRuns.some(date => date != null && date < twoHoursAgo);

  if (hasLowSuccessRate || hasStaleData) {
    return 'CRITICAL';
  }

  // DEGRADED: Any scraper 70-90% success rate
  if (successRates.some(rate => rate >= 70 && rate < 90)) {
    return 'DEGRADED';
  }

  // HEALTHY: All scrapers > 90% success rate
  return 'HEALTHY';
}

/**
 * Get metrics from Redis for a source
 */
async function getMetricsFromRedis(
  redis: ReturnType<typeof getRedisClient>,
  source: ScraperSource
): Promise<{ success: number; failure: number; rate: number }> {
  try {
    const [successStr, failureStr] = await Promise.all([
      redis.get(`scraper:${source}:success_count`),
      redis.get(`scraper:${source}:failure_count`),
    ]);

    const success = parseInt(successStr || '0', 10);
    const failure = parseInt(failureStr || '0', 10);
    const total = success + failure;
    const rate = total > 0 ? (success / total) * 100 : 100;

    return { success, failure, rate };
  } catch (error) {
    console.error(`Failed to get metrics for ${source}:`, error);
    return { success: 0, failure: 0, rate: 100 };
  }
}

/**
 * Get consecutive failures from Redis
 */
async function getConsecutiveFailures(
  redis: ReturnType<typeof getRedisClient>,
  source: ScraperSource
): Promise<number> {
  try {
    const value = await redis.get(`scraper:${source}:consecutive_failures`);
    return parseInt(value || '0', 10);
  } catch (error) {
    console.error(`Failed to get consecutive failures for ${source}:`, error);
    return 0;
  }
}

/**
 * Get records processed in last 24 hours
 */
async function getRecordsProcessed24h(
  repository: ScraperLogRepository,
  source: ScraperSource
): Promise<number> {
  try {
    const endDate = new Date();
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const metrics = await repository.getMetrics(source, startDate, endDate);
    return metrics.totalRecords;
  } catch (error) {
    console.error(`Failed to get records processed for ${source}:`, error);
    return 0;
  }
}

export async function GET(request: NextRequest) {
  // Require admin authentication
  const authError = await requireAdminAuth();
  if (authError) return authError;

  // Apply admin rate limiting
  const rateLimitResponse = await adminRateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const redis = getRedisClient();
    const scraperLogRepository = new ScraperLogRepository(db, redis);

    const sources: ScraperSource[] = ['NSE', 'BSE', 'API_FALLBACK'];

    // Fetch data for all sources in parallel
    const statusData = await Promise.all(
      sources.map(async (source) => {
        const [lastRun, lastSuccess, lastFailure, metrics, consecutiveFailures, recordsProcessed24h] = await Promise.all([
          scraperLogRepository.getLastRun(source),
          scraperLogRepository.getLastSuccess(source),
          scraperLogRepository.getLastFailure(source),
          getMetricsFromRedis(redis, source),
          getConsecutiveFailures(redis, source),
          getRecordsProcessed24h(scraperLogRepository, source),
        ]);

        return {
          source,
          lastRun: lastRun?.createdAt || null,
          lastSuccess: lastSuccess?.createdAt || null,
          lastFailure: lastFailure?.createdAt || null,
          successRate24h: metrics.rate,
          consecutiveFailures,
          recordsProcessed24h,
        };
      })
    );

    // Calculate overall health status
    const successRates = statusData.map(s => s.successRate24h);
    const lastRuns = statusData.map(s => s.lastRun);
    const health = calculateHealthStatus(successRates, lastRuns);

    // Build response
    const response = {
      nse: statusData.find(s => s.source === 'NSE'),
      bse: statusData.find(s => s.source === 'BSE'),
      apiFallback: statusData.find(s => s.source === 'API_FALLBACK'),
      health,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Failed to get scraper status:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve scraper status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
