/**
 * GET /api/ipos/[slug]/documents API Route
 *
 * Returns downloadable documents for an IPO (DRHP, RHP, prospectus, etc.)
 *
 * @route GET /api/ipos/[slug]/documents
 * @param {string} slug - IPO URL slug
 * @returns {DocumentsResponse} Array of IPO documents
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { DocumentRepository } from '@/lib/repositories/document-repository';
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
 * GET /api/ipos/[slug]/documents - Fetch IPO documents
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

    requestLogger.info({ slug }, 'Processing IPO documents request');

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
    const documentRepository = new DocumentRepository(db, redis);

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

    // Fetch documents
    const documents = await documentRepository.findByIPO(ipo.id);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        slug,
        ipoId: ipo.id,
        documentCount: documents.length,
      },
      'Documents fetched successfully'
    );

    // Return response with cache headers (24 hours for static documents)
    return NextResponse.json(
      {
        success: true,
        data: documents,
        metadata: {
          ipoId: ipo.id,
          companyName: ipo.companyName,
          totalDocuments: documents.length,
          lastUpdated: new Date().toISOString(),
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800',
          'CDN-Cache-Control': 'public, s-maxage=86400',
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
      'Failed to fetch documents'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch documents',
      requestId,
      500
    );
  }
}
