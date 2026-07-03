/**
 * GET /api/ipos/history API Route
 *
 * Provides historical IPO data with filtering, sorting, and pagination capabilities.
 * Includes computed fields for listing performance analysis.
 *
 * @route GET /api/ipos/history
 *
 * @queryparam {string} [year] - Filter by listing year (2020-2025, or "All")
 * @queryparam {string} [sector] - Filter by sector name
 * @queryparam {string} [performance] - Filter by listing performance (Positive, Negative, All)
 * @queryparam {string} [sort=listing_date] - Sort field (listing_date, listing_gain, subscription)
 * @queryparam {string} [sortOrder=desc] - Sort direction (asc, desc)
 * @queryparam {number} [page=1] - Page number for pagination (min: 1)
 * @queryparam {number} [limit=20] - Results per page (min: 1, max: 100)
 *
 * @returns {HistoricalIPOResponse} JSON response with data array and pagination metadata
 *
 * @example
 * // Get all historical IPOs from 2024
 * GET /api/ipos/history?year=2024
 *
 * @example
 * // Get positive performers sorted by listing gain
 * GET /api/ipos/history?performance=Positive&sort=listing_gain&sortOrder=desc
 *
 * @example
 * // Get technology sector IPOs with pagination
 * GET /api/ipos/history?sector=Technology&page=1&limit=10
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
// TEMPORARILY DISABLED: Sentry causing module loading errors
// import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
import { DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { historicalIPOQueryParamsSchema } from '@/lib/db/validations';

// ==================== ERROR RESPONSE TYPE ====================

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
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
 * Parse query parameters from URL
 */
function parseQueryParams(searchParams: URLSearchParams): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  const year = searchParams.get('year');
  if (year) params.year = year;

  const sector = searchParams.get('sector');
  if (sector) params.sector = sector;

  const performance = searchParams.get('performance');
  if (performance) params.performance = performance;

  const sort = searchParams.get('sort');
  if (sort) params.sort = sort;

  const sortOrder = searchParams.get('sortOrder');
  if (sortOrder) params.sortOrder = sortOrder;

  const page = searchParams.get('page');
  if (page) params.page = page;

  const limit = searchParams.get('limit');
  if (limit) params.limit = limit;

  return params;
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
): NextResponse<ErrorResponse> {
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
 * GET /api/ipos/history - Fetch historical IPO data with filtering and sorting
 *
 * Features:
 * - Filtering by year, sector, and performance
 * - Sorting by listing_date, listing_gain, or subscription
 * - Pagination with configurable page size
 * - Redis caching (24h TTL)
 * - Computed listingGainPercent field
 * - Comprehensive error handling
 * - Request logging with request ID
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Create request-scoped logger
  const requestLogger = logger.child({ requestId });

  try {
    // Parse URL search parameters
    const { searchParams } = new URL(request.url);
    const rawParams = parseQueryParams(searchParams);

    requestLogger.info(
      { params: rawParams },
      'Processing historical IPO list request'
    );

    // Validate query parameters
    let validatedParams: z.infer<typeof historicalIPOQueryParamsSchema>;
    try {
      validatedParams = historicalIPOQueryParamsSchema.parse(rawParams);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues },
          'Query parameter validation failed'
        );
        return createErrorResponse(
          'VALIDATION_ERROR',
          'Invalid query parameters',
          requestId,
          400,
          { errors: error.issues }
        );
      }
      throw error;
    }

    // Initialize repository
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch data from repository (includes caching)
    const result = await ipoRepository.findHistorical(validatedParams);

    // Enrich with REAL current price + current gain from listing_performance
    // (the ipos.current_* columns are empty in prod; listing_performance is the
    // canonical source). Best-effort: on failure rows keep null current-* values.
    const lpRepo = new ListingPerformanceRepository(db, redis);
    const lpRows = await lpRepo
      .findByIPOIds(result.data.map((ipo) => ipo.id))
      .catch(() => []);
    const toNum = (v: string | number | null | undefined): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return Number.isFinite(n) ? n : null;
    };
    const lpByIpo = new Map(
      lpRows.filter((r) => r.ipoId).map((r) => [r.ipoId as string, r])
    );
    const enrichedData = result.data.map((ipo) => {
      const lp = lpByIpo.get(ipo.id);
      return {
        ...ipo,
        currentPriceLive: toNum(lp?.currentPrice ?? null),
        currentGainLive: toNum(lp?.currentGainPercent ?? null),
      };
    });

    // Transform repository response to API response format
    const response = {
      data: enrichedData,
      pagination: {
        page: result.meta.page,
        limit: result.meta.limit,
        total: result.meta.total,
        hasMore: result.meta.hasNext,
      },
    };

    // Log successful response
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        resultCount: result.data.length,
        total: result.meta.total,
        page: result.meta.page,
      },
      'Historical IPO list fetched successfully'
    );

    // Return response with cache headers
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=86400', // 24 hours TTL
      },
    });
  } catch (error) {
    // Log error with context
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to fetch historical IPO list'
    );

    // Handle DatabaseError
    if (error instanceof DatabaseError) {
      // Report to Sentry in production
      if (process.env.NODE_ENV === 'production') {
        // TEMPORARILY DISABLED: Sentry causing module loading errors
        // Sentry.captureException(error, {
        //   tags: {
        //     errorType: 'DatabaseError',
        //     requestId,
        //   },
        //   contexts: {
        //     api: {
        //       route: '/api/ipos/history',
        //       method: 'GET',
        //       duration,
        //     },
        //   },
        // });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch historical IPO listings',
        requestId,
        500
      );
    }

    // Handle unknown errors
    if (process.env.NODE_ENV === 'production') {
      // TEMPORARILY DISABLED: Sentry causing module loading errors
      // Sentry.captureException(error, {
      //   tags: {
      //     errorType: 'UnknownError',
      //     requestId,
      //   },
      //   contexts: {
      //     api: {
      //       route: '/api/ipos/history',
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
