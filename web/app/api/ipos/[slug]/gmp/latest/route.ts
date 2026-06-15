/**
 * GET /api/ipos/[slug]/gmp/latest API Route
 *
 * Returns the latest Grey Market Premium data for a specific IPO
 *
 * @route GET /api/ipos/[slug]/gmp/latest
 * @param {string} slug - IPO URL slug
 * @returns {GMPResponse} Latest GMP data with timestamp and trend
 */

import { NextRequest, NextResponse } from 'next/server';
// TEMPORARILY DISABLED: Sentry causing module loading errors
// import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { EntityNotFoundError, DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { gmpRecords } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';

// ==================== TYPES ====================

interface GMPResponse {
  ipoId: string;
  ipoSlug: string;
  companyName: string;
  issuePrice: number | null;
  latestGMP: {
    timestamp: string;
    gmp: number;
    gmpPercentage: number;
    expectedListingPrice: number | null;
    source: string;
    trend: 'up' | 'down' | 'stable' | null;
  } | null;
  message?: string;
  disclaimer: string;
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
 * GET /api/ipos/[slug]/gmp/latest - Fetch latest GMP data
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

    requestLogger.info({ slug }, 'Processing GMP data request');

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

    // Check Redis cache first (15 minute TTL for GMP - updates less frequently)
    const cacheKey = `gmp:latest:${slug}`;
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      requestLogger.info({ slug, cached: true }, 'Returning cached GMP data');
      return NextResponse.json(JSON.parse(cachedData as string), {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
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

    // Fetch latest 2 GMP records to calculate trend
    const gmpData = await db
      .select()
      .from(gmpRecords)
      .where(eq(gmpRecords.ipoId, ipo.id))
      .orderBy(desc(gmpRecords.timestamp))
      .limit(2);

    const latestGMP = gmpData[0];
    const previousGMP = gmpData[1];

    // Calculate trend
    let trend: 'up' | 'down' | 'stable' | null = null;
    if (latestGMP && previousGMP) {
      const diff = latestGMP.gmp - previousGMP.gmp;
      if (diff > 5) trend = 'up';
      else if (diff < -5) trend = 'down';
      else trend = 'stable';
    }

    // Calculate GMP percentage — guard NaN/Infinity from a zero/absent price (C5/G19)
    const issuePrice = ipo.priceRangeMax || ipo.priceRangeMin;
    const rawGmpPct =
      latestGMP && issuePrice ? (latestGMP.gmp / Number(issuePrice)) * 100 : null;
    const gmpPercentage = rawGmpPct !== null && Number.isFinite(rawGmpPct) ? rawGmpPct : 0;

    // Prepare response
    const response: GMPResponse = {
      ipoId: ipo.id,
      ipoSlug: ipo.slug,
      companyName: ipo.companyName,
      issuePrice: issuePrice,
      latestGMP: latestGMP
        ? {
            timestamp: latestGMP.timestamp.toISOString(),
            gmp: latestGMP.gmp,
            gmpPercentage: parseFloat(gmpPercentage.toFixed(2)),
            expectedListingPrice: latestGMP.expectedListingPrice,
            source: latestGMP.source,
            trend,
          }
        : null,
      message: latestGMP ? undefined : 'GMP data not yet available',
      disclaimer:
        'Grey Market Premium (GMP) is unofficial and indicative. GMP can be volatile and should not be the sole basis for investment decisions.',
    };

    // Cache the response (15 minutes)
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 900);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        hasData: !!latestGMP,
        gmp: latestGMP?.gmp,
        trend,
      },
      'GMP data fetched successfully'
    );

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
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
      'Failed to fetch GMP data'
    );

    if (error instanceof EntityNotFoundError) {
      return createErrorResponse('NOT_FOUND', error.message, requestId, 404);
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
        //       route: '/api/ipos/[slug]/gmp/latest',
        //       method: 'GET',
        //       duration,
        //     },
        //   },
        // });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch GMP data',
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
      //       route: '/api/ipos/[slug]/gmp/latest',
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
