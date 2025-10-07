/**
 * GET /api/ipos/[slug] API Route
 *
 * Fetches complete IPO details by slug with all relations including:
 * - Financial data (3-year trends)
 * - Documents (DRHP, RHP, Prospectus)
 * - Latest subscription data
 * - 7-day GMP history
 * - Listing performance
 * - Peer companies data
 * - Sector peer comparison (live IPO data)
 *
 * @route GET /api/ipos/:slug
 * @param {string} slug - IPO slug (e.g., "swiggy-ipo")
 * @returns {IPODetailResponse} Complete IPO data with metadata
 *
 * @example
 * GET /api/ipos/swiggy-ipo
 *
 * @cache 15 minutes (900 seconds) with stale-while-revalidate
 * @performance Target: <500ms response time with caching
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { getIPODetailKey, CacheTTL } from '@/lib/cache/cache-keys';
import type { IPODetailResponse } from '@/lib/db/types';

// ==================== ERROR RESPONSE TYPE ====================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    slug?: string;
    timestamp: string;
    requestId: string;
  };
}

// ==================== HELPER FUNCTIONS ====================

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
  slug?: string
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        slug,
        timestamp: new Date().toISOString(),
        requestId,
      },
    },
    { status }
  );
}

// ==================== API ROUTE HANDLER ====================

/**
 * GET /api/ipos/[slug] - Fetch complete IPO details by slug
 *
 * Features:
 * - Complete IPO data with all relations
 * - Latest subscription snapshot
 * - 7-day GMP history
 * - Financial data (3-year trends)
 * - Documents (DRHP, RHP, Prospectus)
 * - Peer comparison data (live IPOs in same sector)
 * - Redis caching with 15-minute TTL
 * - Comprehensive error handling (404 for not found, 500 for errors)
 * - Request logging with request ID
 * - Cache headers for CDN/browser caching
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Create request-scoped logger
  const requestLogger = logger.child({ requestId });

  // Extract slug from params (Next.js 15+ async params)
  const { slug } = await params;

  try {
    requestLogger.info({ slug }, 'Processing IPO detail request');

    // Validate slug parameter
    if (!slug || typeof slug !== 'string' || slug.trim() === '') {
      requestLogger.warn({ slug }, 'Invalid or missing slug parameter');
      return createErrorResponse(
        'INVALID_SLUG',
        'Slug parameter is required',
        requestId,
        400,
        slug
      );
    }

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Check cache first (Cache-Aside pattern)
    const cacheKey = getIPODetailKey(slug);
    let cachedData: string | null = null;

    try {
      cachedData = await redis.get(cacheKey);
      if (cachedData) {
        requestLogger.info({ slug, source: 'cache' }, 'Cache hit for IPO detail');
        const parsedData: IPODetailResponse = JSON.parse(cachedData);

        const duration = Date.now() - startTime;
        requestLogger.info(
          { slug, duration, source: 'cache' },
          'IPO detail fetched from cache'
        );

        // Return cached response with cache headers
        return NextResponse.json(parsedData, {
          status: 200,
          headers: {
            'Cache-Control':
              'public, s-maxage=900, stale-while-revalidate=1800',
            'X-Cache': 'HIT',
            'X-Response-Time': `${duration}ms`,
          },
        });
      }
    } catch (cacheError) {
      // Log cache error but continue to database
      requestLogger.warn(
        {
          error:
            cacheError instanceof Error
              ? cacheError.message
              : 'Unknown cache error',
        },
        'Redis cache read failed, falling back to database'
      );
    }

    // Cache miss - fetch from database
    requestLogger.info({ slug, source: 'database' }, 'Cache miss, querying database');

    // Fetch IPO with all relations
    const ipoWithRelations = await ipoRepository.findBySlug(slug);

    if (!ipoWithRelations) {
      const duration = Date.now() - startTime;
      requestLogger.warn(
        { slug, duration },
        'IPO not found for slug'
      );

      return createErrorResponse(
        'IPO_NOT_FOUND',
        'IPO not found',
        requestId,
        404,
        slug
      );
    }

    // Fetch peer IPOs in the same sector
    const peers = await ipoRepository.findPeers(
      ipoWithRelations.id,
      ipoWithRelations.sector,
      8
    );

    // Filter subscriptions to last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentGmpRecords = (ipoWithRelations.gmpRecords || []).filter(
      (record) => new Date(record.timestamp) >= sevenDaysAgo
    );

    // Construct API response
    const response: IPODetailResponse = {
      ipo: ipoWithRelations,
      financialData: ipoWithRelations.financialData || null,
      documents: ipoWithRelations.documents || [],
      subscriptions: ipoWithRelations.subscriptions || [],
      gmpRecords: recentGmpRecords,
      listingPerformance: ipoWithRelations.listingPerformance || null,
      peerCompanies: ipoWithRelations.peerCompanies || [],
      peers: peers,
      metadata: {
        lastUpdated: new Date().toISOString(),
      },
    };

    // Store in cache
    try {
      await redis.setex(cacheKey, CacheTTL.IPO_DETAIL, JSON.stringify(response));
      requestLogger.info({ slug, cacheKey }, 'Stored IPO detail in cache');
    } catch (cacheError) {
      // Log but don't fail the request if cache write fails
      requestLogger.warn(
        {
          error:
            cacheError instanceof Error
              ? cacheError.message
              : 'Unknown cache error',
        },
        'Failed to store IPO detail in cache'
      );
    }

    // Log successful response
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        slug,
        duration,
        source: 'database',
        hasFinancials: !!response.financialData,
        documentCount: response.documents.length,
        subscriptionCount: response.subscriptions.length,
        gmpRecordCount: response.gmpRecords.length,
        peerCount: response.peers.length,
      },
      'IPO detail fetched successfully'
    );

    // Return response with cache headers
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
        'X-Cache': 'MISS',
        'X-Response-Time': `${duration}ms`,
      },
    });
  } catch (error) {
    // Log error with context
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        slug,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to fetch IPO detail'
    );

    // Handle DatabaseError
    if (error instanceof DatabaseError) {
      // Report to Sentry in production
      if (process.env.NODE_ENV === 'production') {
        Sentry.captureException(error, {
          tags: {
            errorType: 'DatabaseError',
            requestId,
            slug,
          },
          contexts: {
            api: {
              route: `/api/ipos/${slug}`,
              method: 'GET',
              duration,
            },
          },
        });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch IPO details',
        requestId,
        500,
        slug
      );
    }

    // Handle unknown errors
    if (process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, {
        tags: {
          errorType: 'UnknownError',
          requestId,
          slug,
        },
        contexts: {
          api: {
            route: `/api/ipos/${slug}`,
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
      slug
    );
  }
}
