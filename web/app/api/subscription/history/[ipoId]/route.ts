/**
 * GET /api/subscription/history/[ipoId] API Route
 *
 * Returns time-series subscription data for trend charts
 *
 * @route GET /api/subscription/history/[ipoId]
 * @param {string} ipoId - IPO UUID
 * @query {number} days - Optional: Number of days to fetch (default: all)
 * @returns {SubscriptionHistoryResponse} Array of subscription snapshots
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { logger } from '@/lib/logger';

/**
 * Generate unique request ID for tracing
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
        requestId,
      },
    },
    { status }
  );
}

/**
 * GET /api/subscription/history/[ipoId] - Fetch subscription history
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ipoId: string }> }
) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    const { ipoId } = await context.params;
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');

    requestLogger.info({ ipoId, days: daysParam }, 'Processing subscription history request');

    // Validate ipoId
    if (!ipoId || typeof ipoId !== 'string') {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing ipoId parameter',
        requestId,
        400
      );
    }

    // Parse days parameter
    let days: number | undefined;
    if (daysParam) {
      const parsedDays = parseInt(daysParam, 10);
      if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 365) {
        return createErrorResponse(
          'VALIDATION_ERROR',
          'days parameter must be between 1 and 365',
          requestId,
          400
        );
      }
      days = parsedDays;
    }

    // Initialize Redis client with fallback
    let redis;
    try {
      redis = getRedisClient();
    } catch {
      requestLogger.warn('Redis unavailable - continuing without cache');
      redis = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
        flushdb: async () => 'OK',
      } as any;
    }

    const subscriptionRepository = new SubscriptionRepository(db, redis);

    // Calculate date range if days specified
    let fromDate: Date | undefined;
    if (days) {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);
    }

    // Fetch subscription history
    const subscriptions = await subscriptionRepository.findByIPO({
      ipoId,
      fromDate,
      limit: 500, // Max 500 records for chart rendering
    });

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        ipoId,
        recordCount: subscriptions.length,
        days: days || 'all',
      },
      'Subscription history fetched successfully'
    );

    // Return response with cache headers (3 minutes - real-time during IPO)
    return NextResponse.json(
      {
        success: true,
        data: subscriptions,
        metadata: {
          ipoId,
          totalRecords: subscriptions.length,
          dateRange: days ? `${days} days` : 'all',
          lastUpdated: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=180, stale-while-revalidate=360',
          'CDN-Cache-Control': 'public, s-maxage=180',
        },
      }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to fetch subscription history'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch subscription history',
      requestId,
      500
    );
  }
}
