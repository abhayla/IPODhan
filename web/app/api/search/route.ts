/**
 * GET /api/search API Route
 *
 * Global search across IPOs (company name, symbol) using fuzzy matching
 *
 * @route GET /api/search
 * @query {string} q - Search query (minimum 2 characters)
 * @query {number} limit - Optional: Maximum results to return (default: 10, max: 50)
 * @returns {SearchResponse} Array of matching IPOs with similarity scores
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Fuse from 'fuse.js';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { CacheTTL } from '@/lib/cache/cache-keys';
import { logger } from '@/lib/logger';
import { SEARCH_CONFIG } from '@/lib/config/search';

/**
 * Query Parameters Schema
 */
const QueryParamsSchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

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
 * Generate cache key for search
 */
function getSearchCacheKey(query: string, limit: number): string {
  return `search:${query.toLowerCase()}:${limit}`;
}

/**
 * GET /api/search - Global IPO search
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get('q') || '';
    const limitParam = searchParams.get('limit') || '10';

    requestLogger.info({ query: q, limit: limitParam }, 'Processing search request');

    // Validate query parameters
    let validatedParams: QueryParams;
    try {
      validatedParams = QueryParamsSchema.parse({
        q,
        limit: limitParam,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
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

    const { q: query, limit } = validatedParams;

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

    const cacheKey = getSearchCacheKey(query, limit);

    // Try to get from cache
    let cachedResults: any = null;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        cachedResults = JSON.parse(cached);
        requestLogger.info(
          { query, limit, cached: true },
          'Search results returned from cache'
        );

        return NextResponse.json(
          {
            success: true,
            data: cachedResults,
            metadata: {
              query,
              totalResults: cachedResults.length,
              limit,
              cached: true,
              lastUpdated: new Date().toISOString(),
            },
          },
          {
            status: 200,
            headers: {
              'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
              'CDN-Cache-Control': 'public, s-maxage=300',
            },
          }
        );
      }
    } catch (error) {
      requestLogger.warn('Failed to get from cache, continuing with DB query');
    }

    // Cache miss - fetch from database
    const ipoRepository = new IPORepository(db, redis);
    const allIPOs = await ipoRepository.findAll();

    // Configure Fuse.js for fuzzy matching
    const fuse = new Fuse(allIPOs.data, {
      keys: [
        { name: 'companyName', weight: 0.7 },
        { name: 'symbol', weight: 0.3 },
      ],
      threshold: SEARCH_CONFIG.fuzzyMatch.similarityThreshold,
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    });

    // Perform fuzzy search
    const fuseResults = fuse.search(query, { limit });

    // Transform results with similarity scores
    const results = fuseResults.map((result) => ({
      ...result.item,
      similarity: Math.round((1 - (result.score || 0)) * 100),
    }));

    // Cache the results (5 minutes TTL)
    try {
      await redis.setex(cacheKey, CacheTTL.IPO_LIST, JSON.stringify(results));
    } catch (error) {
      requestLogger.warn('Failed to cache search results');
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        query,
        resultCount: results.length,
        limit,
        cached: false,
      },
      'Search completed successfully'
    );

    // Return response with cache headers (5 minutes)
    return NextResponse.json(
      {
        success: true,
        data: results,
        metadata: {
          query,
          totalResults: results.length,
          limit,
          cached: false,
          processingTime: duration,
          lastUpdated: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'CDN-Cache-Control': 'public, s-maxage=300',
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
      'Failed to perform search'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to perform search',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
