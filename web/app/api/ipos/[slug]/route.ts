/**
 * GET /api/ipos/[slug] API Route
 *
 * Returns detailed IPO information including all relationships
 *
 * @route GET /api/ipos/[slug]
 * @param {string} slug - IPO URL slug
 * @returns {IPODetailResponse} Comprehensive IPO data with relationships
 */

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { EntityNotFoundError, DatabaseError } from '@/lib/errors/repository-errors';
import { logger } from '@/lib/logger';
import type { IPODetailResponse } from '@/lib/db/types';

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
 * GET /api/ipos/[slug] - Fetch IPO details with all relationships
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  // Create request-scoped logger
  const requestLogger = logger.child({ requestId });

  try {
    const { slug } = await context.params;

    requestLogger.info({ slug }, 'Processing IPO detail request');

    // Validate slug
    if (!slug || typeof slug !== 'string') {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing slug parameter',
        requestId,
        400
      );
    }

    // Initialize repository with optional Redis
    let redis;
    try {
      redis = getRedisClient();
    } catch {
      requestLogger.warn('Redis unavailable - continuing without cache');
      // Create a mock Redis client for repositories
      redis = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
        flushdb: async () => 'OK',
      } as any;
    }

    const ipoRepository = new IPORepository(db, redis);

    // Fetch IPO with all relationships
    const ipoWithRelations = await ipoRepository.findBySlug(slug);

    if (!ipoWithRelations) {
      requestLogger.warn({ slug }, 'IPO not found');
      return createErrorResponse(
        'NOT_FOUND',
        `IPO with slug '${slug}' not found`,
        requestId,
        404
      );
    }

    // Transform to API response format
    const response: IPODetailResponse = {
      ipo: {
        id: ipoWithRelations.id,
        companyName: ipoWithRelations.companyName,
        slug: ipoWithRelations.slug,
        category: ipoWithRelations.category,
        sector: ipoWithRelations.sector,
        issueSize: ipoWithRelations.issueSize,
        priceRangeMin: ipoWithRelations.priceRangeMin,
        priceRangeMax: ipoWithRelations.priceRangeMax,
        lotSize: ipoWithRelations.lotSize,
        status: ipoWithRelations.status,
        openDate: ipoWithRelations.openDate,
        closeDate: ipoWithRelations.closeDate,
        allotmentDate: ipoWithRelations.allotmentDate,
        listingDate: ipoWithRelations.listingDate,
        companyDescription: ipoWithRelations.companyDescription,
        faceValue: ipoWithRelations.faceValue,
        listingExchanges: ipoWithRelations.listingExchanges,
        registrar: ipoWithRelations.registrar,
        registrarId: ipoWithRelations.registrarId,
        leadManagers: ipoWithRelations.leadManagers,
        rating: ipoWithRelations.rating,
        ratingRationale: ipoWithRelations.ratingRationale,
        ratingOverride: ipoWithRelations.ratingOverride,
        lastScrapedAt: ipoWithRelations.lastScrapedAt,
        createdAt: ipoWithRelations.createdAt,
        updatedAt: ipoWithRelations.updatedAt,
      },
      financialData: ipoWithRelations.financialData ?? null,
      documents: ipoWithRelations.documents || [],
      subscriptions: ipoWithRelations.subscriptions || [],
      gmpRecords: ipoWithRelations.gmpRecords || [],
      listingPerformance: ipoWithRelations.listingPerformance ?? null,
      peerCompanies: ipoWithRelations.peerCompanies || [],
      peers: [],
      metadata: {
        lastUpdated: new Date().toISOString(),
      },
    };

    // Log successful response
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        status: ipoWithRelations.status,
        hasFinancials: !!ipoWithRelations.financialData,
        subscriptionCount: ipoWithRelations.subscriptions?.length || 0,
        gmpCount: ipoWithRelations.gmpRecords?.length || 0,
      },
      'IPO details fetched successfully'
    );

    // Return response with cache headers
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
      'Failed to fetch IPO details'
    );

    // Handle specific errors
    if (error instanceof EntityNotFoundError) {
      return createErrorResponse(
        'NOT_FOUND',
        error.message,
        requestId,
        404
      );
    }

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
              route: '/api/ipos/[slug]',
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
            route: '/api/ipos/[slug]',
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