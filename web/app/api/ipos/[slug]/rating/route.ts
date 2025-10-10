/**
 * GET /api/ipos/[slug]/rating API Route
 *
 * Returns the calculated rating for a specific IPO based on available data
 *
 * @route GET /api/ipos/[slug]/rating
 * @param {string} slug - IPO URL slug
 * @returns {RatingResponse} Rating with breakdown and rationale
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { EntityNotFoundError, DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { calculateIPORating } from '@/lib/utils/rating-calculator';

// ==================== TYPES ====================

interface RatingResponse {
  ipoId: string;
  ipoSlug: string;
  companyName: string;
  rating: number | null; // 1-5 stars
  score: number; // 0-100 overall score
  rationale: string;
  confidence: number; // 0-100 based on data completeness
  breakdown: {
    financialScore: number;
    marketScore: number;
    subscriptionScore: number;
    gmpScore: number;
    fundamentalScore: number;
  };
  lastCalculated: string;
  message?: string;
}

// ==================== HELPER FUNCTIONS ====================

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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

// ==================== API ROUTE HANDLER ====================

/**
 * GET /api/ipos/[slug]/rating - Calculate and return IPO rating
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    const { slug } = await context.params;

    requestLogger.info({ slug }, 'Processing rating calculation request');

    // Validate slug
    if (!slug || typeof slug !== 'string') {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing slug parameter',
        requestId,
        400
      );
    }

    // Initialize Redis (with fallback)
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

    const ipoRepository = new IPORepository(db, redis);

    // Check Redis cache first (30 minute TTL for ratings)
    const cacheKey = `rating:${slug}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      requestLogger.info({ slug, cached: true }, 'Returning cached rating');
      return NextResponse.json(JSON.parse(cachedData as string), {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
          'X-Cache': 'HIT',
        },
      });
    }

    // Fetch IPO with all relationships needed for rating
    const ipo = await ipoRepository.findBySlug(slug);

    if (!ipo) {
      requestLogger.warn({ slug }, 'IPO not found');
      return createErrorResponse(
        'NOT_FOUND',
        `IPO with slug '${slug}' not found`,
        requestId,
        404
      );
    }

    // Calculate rating using all available data
    const ratingResult = calculateIPORating(
      ipo,
      ipo.financialData || null,
      ipo.subscriptions || null,
      ipo.gmpRecords || null
    );

    // Prepare response
    const response: RatingResponse = {
      ipoId: ipo.id,
      ipoSlug: ipo.slug,
      companyName: ipo.companyName,
      rating: ratingResult.rating,
      score: ratingResult.score,
      rationale: ratingResult.rationale,
      confidence: ratingResult.confidence,
      breakdown: ratingResult.factors,
      lastCalculated: new Date().toISOString(),
      message:
        ratingResult.confidence < 50
          ? 'Rating confidence is low due to limited data availability'
          : undefined,
    };

    // Cache the response (30 minutes)
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 1800);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        rating: ratingResult.rating,
        confidence: ratingResult.confidence,
      },
      'Rating calculated successfully'
    );

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to calculate rating'
    );

    if (error instanceof EntityNotFoundError) {
      return createErrorResponse('NOT_FOUND', error.message, requestId, 404);
    }

    if (error instanceof DatabaseError) {
      if (process.env.NODE_ENV === 'production') {
        Sentry.captureException(error, {
          tags: {
            errorType: 'DatabaseError',
            requestId,
          },
          contexts: {
            api: {
              route: '/api/ipos/[slug]/rating',
              method: 'GET',
              duration,
            },
          },
        });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to calculate rating',
        requestId,
        500
      );
    }

    if (process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, {
        tags: {
          errorType: 'UnknownError',
          requestId,
        },
        contexts: {
          api: {
            route: '/api/ipos/[slug]/rating',
            method: 'GET',
            duration,
          },
        },
      });
    }

    return createErrorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
