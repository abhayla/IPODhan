/**
 * PATCH /api/admin/reviews/[reviewId] API Route
 *
 * Approve or reject a review (admin only)
 *
 * @route PATCH /api/admin/reviews/[reviewId]
 * @requires Authorization: Bearer <ADMIN_API_TOKEN>
 * @body {action: 'approve' | 'reject'}
 * @returns {ReviewModerationResponse} Updated review
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ReviewRepository } from '@/lib/repositories/review-repository';
import { EntityNotFoundError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';

/**
 * Review Moderation Request Schema
 */
const ReviewModerationSchema = z.object({
  action: z.enum(['approve', 'reject'], {
    message: 'Action must be "approve" or "reject"',
  }),
});

type ReviewModerationRequest = z.infer<typeof ReviewModerationSchema>;

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
 * PATCH /api/admin/reviews/[reviewId] - Approve or reject a review
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    // Await params to get reviewId (Next.js 15 App Router requirement)
    const { reviewId } = await params;

    requestLogger.info({ reviewId }, 'Processing review moderation request');

    // Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid JSON in request body',
        requestId,
        400
      );
    }

    // Validate request body
    let validatedData: ReviewModerationRequest;
    try {
      validatedData = ReviewModerationSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues },
          'Review moderation validation failed'
        );
        return createErrorResponse(
          'VALIDATION_ERROR',
          error.issues[0]?.message || 'Invalid action parameter',
          requestId,
          400,
          { errors: error.issues }
        );
      }
      throw error;
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

    const db = await getDb();
    const reviewRepository = new ReviewRepository(db, redis);

    // Perform approve or reject operation
    const adminUser = 'admin@ipodhan.com'; // TODO: Get from auth context in future
    let updatedReview;

    try {
      if (validatedData.action === 'approve') {
        updatedReview = await reviewRepository.approveReview(reviewId, adminUser);
        requestLogger.info(
          { reviewId, ipoId: updatedReview.ipoId },
          'Review approved successfully'
        );
      } else {
        updatedReview = await reviewRepository.rejectReview(reviewId, adminUser);
        requestLogger.info(
          { reviewId, ipoId: updatedReview.ipoId },
          'Review rejected successfully'
        );
      }
    } catch (error) {
      if (error instanceof EntityNotFoundError) {
        requestLogger.warn({ reviewId }, 'Review not found');
        return createErrorResponse(
          'NOT_FOUND',
          'Review not found',
          requestId,
          404,
          { reviewId }
        );
      }
      throw error;
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        reviewId,
        action: validatedData.action,
        ipoId: updatedReview.ipoId,
      },
      'Review moderation completed successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: updatedReview,
        meta: {
          action: validatedData.action,
          moderatedBy: adminUser,
          moderatedAt: updatedReview.moderatedAt,
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
      'Failed to moderate review'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to moderate review',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
