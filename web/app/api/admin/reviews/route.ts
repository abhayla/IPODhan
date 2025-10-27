/**
 * GET /api/admin/reviews API Route
 *
 * List all pending reviews (admin only)
 *
 * @route GET /api/admin/reviews
 * @requires Authorization: Bearer <ADMIN_API_TOKEN>
 * @returns {PendingReviewsResponse} List of pending reviews
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ReviewRepository } from '@/lib/repositories/review-repository';
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
  status: number,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
        timestamp: new Date().toISOString(),
        requestId,
      },
    },
    { status }
  );
}

/**
 * GET /api/admin/reviews - List all pending reviews
 */
export async function GET(request: NextRequest) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing admin pending reviews request');

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

    const db = await getDb();
    const reviewRepository = new ReviewRepository(db, redis);

    // Fetch pending reviews (isApproved = false)
    const pendingReviews = await reviewRepository.getPendingReviews();

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        count: pendingReviews.length,
      },
      'Pending reviews fetched successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: pendingReviews,
        meta: {
          count: pendingReviews.length,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to fetch pending reviews'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch pending reviews',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
