/**
 * GET /api/calendar/materialized/[category] API Route
 *
 * OPTIMIZED calendar endpoint using materialized view for 10x performance improvement.
 * This endpoint uses the calendar_view materialized view instead of complex JOINs.
 *
 * Performance Target: p95 < 400ms (down from 4300ms)
 *
 * @route GET /api/calendar/materialized/:category
 * @param category - Path parameter: MAINBOARD or SME
 *
 * @queryparam {number} [year] - Filter by year (e.g., 2025)
 *
 * @returns {CalendarResponse} JSON response with all IPOs for category
 *
 * @example
 * // Get all Mainboard IPOs
 * GET /api/calendar/materialized/MAINBOARD
 *
 * @example
 * // Get Mainboard IPOs for 2025
 * GET /api/calendar/materialized/MAINBOARD?year=2025
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { withCache } from '@/lib/cache/api-cache';
import { getCalendarKey, CacheTTL } from '@/lib/cache/cache-keys';
import { DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import { readHeavyRateLimiter } from '@/lib/middleware/rate-limiter';
import { sql } from 'drizzle-orm';

// ==================== VALIDATION SCHEMAS ====================

/**
 * Category Path Parameter Schema
 */
const CategoryParamSchema = z
  .enum(['MAINBOARD', 'SME', 'mainboard', 'sme'])
  .transform((val) => val.toUpperCase() as 'MAINBOARD' | 'SME');

/**
 * Query Parameters Schema
 */
const QueryParamsSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2030).optional(),
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
 * GET /api/calendar/materialized/[category] - Fetch calendar data from materialized view
 *
 * Features:
 * - Uses pre-computed materialized view (10x faster than JOINs)
 * - 24-hour Redis caching
 * - Rate limiting
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

    requestLogger.info({ params: { category, ...rawParams } }, 'Processing calendar request');

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

    // Use caching wrapper
    const cacheKey = getCalendarKey(`${category}${validatedParams.year ? `:${validatedParams.year}` : ''}`);

    return withCache(cacheKey, CacheTTL.CALENDAR, async () => {
      // Query materialized view (MUCH faster than JOINs)
      let query = sql`
        SELECT * FROM calendar_view
        WHERE segment = ${category}
      `;

      // Add year filter if specified
      if (validatedParams.year) {
        query = sql`
          SELECT * FROM calendar_view
          WHERE segment = ${category}
          AND (
            EXTRACT(YEAR FROM open_date) = ${validatedParams.year}
            OR EXTRACT(YEAR FROM close_date) = ${validatedParams.year}
            OR EXTRACT(YEAR FROM listing_date) = ${validatedParams.year}
          )
        `;
      }

      // Add ordering
      query = sql`
        ${query}
        ORDER BY
          CASE
            WHEN open_date IS NOT NULL AND open_date >= CURRENT_DATE THEN 1
            WHEN close_date IS NOT NULL AND close_date >= CURRENT_DATE THEN 2
            WHEN listing_date IS NOT NULL THEN 3
            ELSE 4
          END,
          COALESCE(open_date, close_date, listing_date) ASC
      `;

      const result = await db.execute(query);

      // Log performance
      const duration = Date.now() - startTime;
      requestLogger.info(
        {
          duration,
          resultCount: result.rows.length,
          category,
          year: validatedParams.year,
        },
        'Calendar data fetched from materialized view'
      );

      return {
        ipos: result.rows,
        count: result.rows.length,
        category,
        filters: validatedParams,
        source: 'materialized_view',
      };
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
              route: '/api/calendar/materialized/[category]',
              method: 'GET',
              duration,
            },
          },
        });
      }

      return createErrorResponse('DATABASE_ERROR', 'Failed to fetch calendar data', requestId, 500);
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
            route: '/api/calendar/materialized/[category]',
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
