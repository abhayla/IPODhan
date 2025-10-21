/**
 * GET /api/ipos/[slug]/listing-performance API Route
 *
 * Returns listing day performance metrics for an IPO
 *
 * @route GET /api/ipos/[slug]/listing-performance
 * @param {string} slug - IPO URL slug
 * @returns {ListingPerformanceResponse} Listing performance data
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
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
 * GET /api/ipos/[slug]/listing-performance - Fetch listing performance
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

    requestLogger.info({ slug }, 'Processing listing performance request');

    // Validate slug
    if (!slug || typeof slug !== 'string') {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing slug parameter',
        requestId,
        400
      );
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

    const ipoRepository = new IPORepository(db, redis);
    const listingPerformanceRepository = new ListingPerformanceRepository(db, redis);

    // First, find the IPO by slug to get the ID
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

    // Fetch listing performance
    const listingPerformance = await listingPerformanceRepository.findByIPO(ipo.id);

    if (!listingPerformance) {
      requestLogger.warn({ slug, ipoId: ipo.id }, 'Listing performance not found');
      return createErrorResponse(
        'NOT_FOUND',
        `Listing performance data not found for IPO '${slug}'`,
        requestId,
        404
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        ipoId: ipo.id,
        listingGain: listingPerformance.listingGainPercent,
        listingDate: listingPerformance.listingDate,
      },
      'Listing performance fetched successfully'
    );

    // Return response with cache headers (15 minutes - updates on listing day)
    return NextResponse.json(
      {
        success: true,
        data: listingPerformance,
        metadata: {
          ipoId: ipo.id,
          companyName: ipo.companyName,
          lastUpdated: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
          'CDN-Cache-Control': 'public, s-maxage=900',
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
      'Failed to fetch listing performance'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch listing performance',
      requestId,
      500
    );
  }
}
