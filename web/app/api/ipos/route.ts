/**
 * GET /api/ipos API Route
 *
 * Provides paginated, filterable, and sortable IPO listings with Redis caching.
 *
 * @route GET /api/ipos
 *
 * @queryparam {string} [status] - Filter by IPO status (UPCOMING, OPEN, CLOSED, LISTED) - supports multiple values
 * @queryparam {string} [category] - Filter by IPO category (MAINBOARD, SME, RIGHTS, NCD) - supports multiple values
 * @queryparam {string} [sector] - Filter by sector name (exact match)
 * @queryparam {number} [page=1] - Page number for pagination (min: 1)
 * @queryparam {number} [limit=20] - Results per page (min: 1, max: 100)
 * @queryparam {string} [sortBy=createdAt] - Field to sort by (openDate, closeDate, listingDate, issueSize, createdAt)
 * @queryparam {string} [sortOrder=desc] - Sort direction (asc, desc)
 *
 * @returns {IPOListResponse} JSON response with data array and pagination metadata
 *
 * @example
 * // Get all open IPOs
 * GET /api/ipos?status=OPEN
 *
 * @example
 * // Get mainboard IPOs, paginated
 * GET /api/ipos?category=MAINBOARD&page=2&limit=10
 *
 * @example
 * // Get multiple statuses
 * GET /api/ipos?status=OPEN&status=UPCOMING
 *
 * @example
 * // Search by sector with sorting
 * GET /api/ipos?sector=Technology&sortBy=issueSize&sortOrder=desc
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
 * IPO Status Enum Schema
 */
const IPOStatusSchema = z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']);

/**
 * IPO Category Enum Schema
 */
const IPOCategorySchema = z.enum(['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO']);

/**
 * Sort Field Schema
 */
const SortFieldSchema = z.enum([
  'openDate',
  'closeDate',
  'listingDate',
  'issueSize',
  'createdAt',
]);

/**
 * Sort Order Schema
 */
const SortOrderSchema = z.enum(['asc', 'desc']);

/**
 * Query Parameters Schema with validation
 */
const QueryParamsSchema = z.object({
  status: z
    .union([IPOStatusSchema, z.array(IPOStatusSchema)])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  category: z
    .union([IPOCategorySchema, z.array(IPOCategorySchema)])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      return Array.isArray(val) ? val : [val];
    }),
  sector: z.string().optional(),
  search: z.string().optional(),
  scoreRange: z.string().optional(), // Story 4.7: Filter by score range (e.g., "76-100", "all")
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: SortFieldSchema.default('createdAt'),
  sortOrder: SortOrderSchema.default('desc'),
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

  // Handle array parameters (status, category)
  const statusValues = searchParams.getAll('status');
  if (statusValues.length > 0) {
    params.status = statusValues.length === 1 ? statusValues[0] : statusValues;
  }

  const categoryValues = searchParams.getAll('category');
  if (categoryValues.length > 0) {
    params.category =
      categoryValues.length === 1 ? categoryValues[0] : categoryValues;
  }

  // Handle single-value parameters
  const sector = searchParams.get('sector');
  if (sector) params.sector = sector;

  const search = searchParams.get('search');
  if (search) params.search = search;

  const page = searchParams.get('page');
  if (page) params.page = page;

  const limit = searchParams.get('limit');
  if (limit) params.limit = limit;

  const sortBy = searchParams.get('sortBy');
  if (sortBy) params.sortBy = sortBy;

  const sortOrder = searchParams.get('sortOrder');
  if (sortOrder) params.sortOrder = sortOrder;

  const scoreRange = searchParams.get('scoreRange');
  if (scoreRange) params.scoreRange = scoreRange;

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
 * GET /api/ipos - Fetch paginated and filtered IPO listings
 *
 * Features:
 * - Filtering by status, category, sector
 * - Pagination with configurable page size
 * - Sorting by multiple fields
 * - Redis caching (managed by repository layer)
 * - Comprehensive error handling
 * - Request logging with request ID
 */
export async function GET(request: NextRequest) {
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
    // Parse URL search parameters
    const { searchParams } = new URL(request.url);
    const rawParams = parseQueryParams(searchParams);

    requestLogger.info({ params: rawParams }, 'Processing IPO list request');

    // Validate query parameters
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
    const filters: {
      status?: string[];
      category?: string[];
      sector?: string;
      search?: string;
      scoreRange?: string;
      page: number;
      limit: number;
      sortBy: 'openDate' | 'closeDate' | 'listingDate' | 'issueSize' | 'createdAt';
      sortOrder: 'asc' | 'desc';
    } = {
      status: validatedParams.status,
      category: validatedParams.category,
      sector: validatedParams.sector,
      search: validatedParams.search,
      scoreRange: validatedParams.scoreRange,
      page: validatedParams.page,
      limit: validatedParams.limit,
      sortBy: validatedParams.sortBy,
      sortOrder: validatedParams.sortOrder,
    };

    // Fetch data from repository (includes caching)
    const result = await ipoRepository.findAll(filters);

    // Transform repository response to API response format
    // Repository returns { data, meta } but API expects { data, pagination }
    const response = {
      data: result.data,
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
      'IPO list fetched successfully'
    );

    // Return response with stale-while-revalidate cache headers
    // Story 8.3: Performance Optimization - AC#2
    // s-maxage=300 (5min cache), stale-while-revalidate=600 (serve stale for 10min)
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
      'Failed to fetch IPO list'
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
              route: '/api/ipos',
              method: 'GET',
              duration,
            },
          },
        });
      }

      return createErrorResponse(
        'DATABASE_ERROR',
        'Failed to fetch IPO listings',
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
            route: '/api/ipos',
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
