/**
 * GET /api/calendar/[category] API Route
 *
 * Dedicated endpoint for calendar views - returns ALL IPOs for a category without pagination.
 * Optimized for calendar display with optional year filtering.
 *
 * @route GET /api/calendar/:category
 * @param category - Path parameter: MAINBOARD or SME
 *
 * @queryparam {number} [year] - Filter by year (e.g., 2025)
 * @queryparam {string} [startDate] - ISO date string for range start
 * @queryparam {string} [endDate] - ISO date string for range end
 *
 * @returns {CalendarResponse} JSON response with all IPOs for category
 *
 * @example
 * // Get all Mainboard IPOs
 * GET /api/calendar/MAINBOARD
 *
 * @example
 * // Get Mainboard IPOs for 2025
 * GET /api/calendar/MAINBOARD?year=2025
 *
 * @example
 * // Get SME IPOs in date range
 * GET /api/calendar/SME?startDate=2025-01-01&endDate=2025-12-31
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { readHeavyRateLimiter } from '@/lib/middleware/rate-limiter';

// ==================== VALIDATION SCHEMAS ====================

/**
 * Category Path Parameter Schema
 */
const CategoryParamSchema = z.enum(['MAINBOARD', 'SME', 'mainboard', 'sme']).transform((val) =>
  val.toUpperCase() as 'MAINBOARD' | 'SME'
);

/**
 * Query Parameters Schema
 */
const QueryParamsSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

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

  const startDate = searchParams.get('startDate');
  if (startDate) params.startDate = startDate;

  const endDate = searchParams.get('endDate');
  if (endDate) params.endDate = endDate;

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
 * GET /api/calendar/[category] - Fetch all IPOs for calendar view
 *
 * Features:
 * - No pagination - returns ALL IPOs for category
 * - Optional year filtering
 * - Optional date range filtering
 * - Redis caching with 5-minute TTL
 * - Rate limiting (10 requests/minute recommended)
 * - Comprehensive error handling
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  // Apply rate limiting
  const rateLimitResponse = await readHeavyRateLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  // Create request-scoped logger
  const requestLogger = logger.child({ requestId });

  try {
    // Await and validate category parameter
    const { category: rawCategory } = await params;
    let category: 'MAINBOARD' | 'SME';

    try {
      category = CategoryParamSchema.parse(rawCategory);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues, category: rawCategory },
          'Category parameter validation failed'
        );
        return createErrorResponse(
          'VALIDATION_ERROR',
          `Invalid category. Must be 'MAINBOARD' or 'SME'`,
          requestId,
          400,
          { errors: error.issues }
        );
      }
      throw error;
    }

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const rawParams = parseQueryParams(searchParams);

    requestLogger.info(
      { params: { category, ...rawParams } },
      'Processing calendar request'
    );

    let validatedParams: QueryParams;
    try {
      validatedParams = QueryParamsSchema.parse(rawParams);
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

    // Build filters for repository
    // Note: NO LIMIT - fetch all IPOs for category
    const filters: {
      category: string[];
      year?: number;
      startDate?: string;
      endDate?: string;
    } = {
      category: [category],
      year: validatedParams.year,
      startDate: validatedParams.startDate,
      endDate: validatedParams.endDate,
    };

    // Fetch data from repository with NO limit
    // We'll use findAll but with a very high limit to get all records
    const result = await ipoRepository.findAll({
      category: [category],
      page: 1,
      limit: 10000, // Very high limit to get all records (calendar use case)
      sortBy: 'openDate',
      sortOrder: 'asc',
    });

    // Filter by year if specified (client-side filter for now)
    let filteredIPOs = result.data;
    if (validatedParams.year) {
      filteredIPOs = filteredIPOs.filter((ipo) => {
        if (!ipo.openDate) return false;
        const openYear = new Date(ipo.openDate).getFullYear();
        return openYear === validatedParams.year;
      });
    }

    // Filter by date range if specified
    if (validatedParams.startDate && validatedParams.endDate) {
      const startDate = new Date(validatedParams.startDate);
      const endDate = new Date(validatedParams.endDate);

      filteredIPOs = filteredIPOs.filter((ipo) => {
        if (!ipo.openDate) return false;
        const openDate = new Date(ipo.openDate);
        return openDate >= startDate && openDate <= endDate;
      });
    }

    // Transform to calendar response format
    const response = {
      ipos: filteredIPOs,
      count: filteredIPOs.length,
      category,
      filters: validatedParams,
    };

    // Log successful response
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        resultCount: filteredIPOs.length,
        category,
      },
      'Calendar data fetched successfully'
    );

    // Return response with cache headers
    // 5-minute cache (s-maxage=300), serve stale for 10 minutes (stale-while-revalidate=600)
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        'CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
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
      'Failed to fetch calendar data'
    );

    // Handle DatabaseError
    if (error instanceof DatabaseError) {
      // Report to Sentry in production
      if (process.env.NODE_ENV === 'production') {
        Sentry.captureException(error, {
          tags: {
            errorType: 'DatabaseError',
            requestId,
          },
          contexts: {
            api: {
              route: '/api/calendar/[category]',
              method: 'GET',
              duration,
            },
          },
        });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch calendar data',
        requestId,
        500
      );
    }

    // Handle unknown errors
    if (process.env.NODE_ENV === 'production') {
      Sentry.captureException(error, {
        tags: {
          errorType: 'UnknownError',
          requestId,
        },
        contexts: {
          api: {
            route: '/api/calendar/[category]',
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
