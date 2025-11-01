/**
 * GET /api/ipos/[slug]/subscriptions/latest API Route
 *
 * Returns the latest subscription data for a specific IPO
 *
 * @route GET /api/ipos/[slug]/subscriptions/latest
 * @param {string} slug - IPO URL slug
 * @returns {SubscriptionResponse} Latest subscription data with timestamp
 */

import { NextRequest, NextResponse } from 'next/server';
// TEMPORARILY DISABLED: Sentry causing module loading errors
// import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';
import { EntityNotFoundError, DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';

// ==================== TYPES ====================

interface SubscriptionResponse {
  ipoId: string;
  ipoSlug: string;
  companyName: string;
  status: string;
  latestSubscription: {
    timestamp: string;
    // High-level categories
    qib: string | null;
    nii: string | null;
    retail: string | null;
    total: string | null;
    employee: string | null;
    others: string | null;
    // Granular breakdown (Story 5.6)
    anchorInvestor: string | null;
    retailHNI: string | null;
    retailOthers: string | null;
    bNII: string | null;
    sNII: string | null;
    // Additional metrics
    totalApplications: number | null;
    totalSharesBid: number | null;
    sharesOffered: number | null;
  } | null;
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
 * GET /api/ipos/[slug]/subscriptions/latest - Fetch latest subscription data
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

    requestLogger.info({ slug }, 'Processing subscription data request');

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
    const subscriptionRepository = new SubscriptionRepository(db, redis);

    // Check Redis cache first (5 minute TTL)
    const cacheKey = `subscription:latest:${slug}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      requestLogger.info({ slug, cached: true }, 'Returning cached subscription data');
      return NextResponse.json(JSON.parse(cachedData as string), {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'X-Cache': 'HIT',
        },
      });
    }

    // Fetch IPO by slug
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

    // Fetch latest subscription data
    const latestSubscription = await subscriptionRepository.findLatest(ipo.id);

    // Prepare response (Story 5.6: Include all 7 granular fields)
    const response: SubscriptionResponse = {
      ipoId: ipo.id,
      ipoSlug: ipo.slug,
      companyName: ipo.companyName,
      status: ipo.status,
      latestSubscription: latestSubscription
        ? {
            timestamp: latestSubscription.timestamp.toISOString(),
            // High-level categories
            qib: latestSubscription.qibSubscription,
            nii: latestSubscription.niiSubscription,
            retail: latestSubscription.retailSubscription,
            total: latestSubscription.totalSubscription,
            employee: latestSubscription.employeeSubscription,
            others: latestSubscription.othersSubscription,
            // Granular breakdown (Story 5.6)
            anchorInvestor: latestSubscription.anchorInvestorSubscription,
            retailHNI: latestSubscription.retailHNISubscription,
            retailOthers: latestSubscription.retailOthersSubscription,
            bNII: latestSubscription.bNIISubscription,
            sNII: latestSubscription.sNIISubscription,
            // Additional metrics
            totalApplications: latestSubscription.totalApplications,
            totalSharesBid: latestSubscription.totalSharesBid,
            sharesOffered: latestSubscription.sharesOffered,
          }
        : null,
      message: latestSubscription
        ? undefined
        : ipo.status === 'UPCOMING'
        ? 'Subscription data will be available after IPO opens'
        : 'No subscription data available',
    };

    // Cache the response (5 minutes)
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 300);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        hasData: !!latestSubscription,
      },
      'Subscription data fetched successfully'
    );

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
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
      'Failed to fetch subscription data'
    );

    if (error instanceof EntityNotFoundError) {
      return createErrorResponse(
        'NOT_FOUND',
        error.message,
        requestId,
        404
      );
    }

    if (error instanceof DatabaseError) {
      if (process.env.NODE_ENV === 'production') {
        // TEMPORARILY DISABLED: Sentry causing module loading errors
        // Sentry.captureException(error, {
        //   tags: {
        //     errorType: 'DatabaseError',
        //     requestId,
        //   },
        //   contexts: {
        //     api: {
        //       route: '/api/ipos/[slug]/subscriptions/latest',
        //       method: 'GET',
        //       duration,
        //     },
        //   },
        // });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch subscription data',
        requestId,
        500
      );
    }

    if (process.env.NODE_ENV === 'production') {
      // TEMPORARILY DISABLED: Sentry causing module loading errors
      // Sentry.captureException(error, {
      //   tags: {
      //     errorType: 'UnknownError',
      //     requestId,
      //   },
      //   contexts: {
      //     api: {
      //       route: '/api/ipos/[slug]/subscriptions/latest',
      //       method: 'GET',
      //       duration,
      //     },
      //   },
      // });
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
