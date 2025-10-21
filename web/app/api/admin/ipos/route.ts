/**
 * POST /api/admin/ipos API Route
 *
 * Create new IPO entry (admin only)
 *
 * @route POST /api/admin/ipos
 * @requires Authorization: Bearer <ADMIN_API_TOKEN>
 * @body {IPOCreateRequest} IPO data
 * @returns {IPOCreateResponse} Created IPO
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { logger } from '@/lib/logger';

/**
 * IPO Creation Request Schema
 */
const IPOCreateSchema = z.object({
  companyName: z.string().min(1).max(255),
  category: z.enum(['MAINBOARD', 'SME']),
  status: z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']),
  segment: z.enum(['MAINBOARD', 'SME']).nullable().optional(),
  offeringType: z.string().optional(),
  openDate: z.string().datetime().nullable().optional(),
  closeDate: z.string().datetime().nullable().optional(),
  listingDate: z.string().datetime().nullable().optional(),
  issuePrice: z.number().int().positive().nullable().optional(),
  minPrice: z.number().int().positive().nullable().optional(),
  maxPrice: z.number().int().positive().nullable().optional(),
  lotSize: z.number().int().positive().nullable().optional(),
  issueSize: z.number().positive().nullable().optional(),
  sector: z.string().nullable().optional(),
  registrarId: z.string().uuid().nullable().optional(),
});

type IPOCreateRequest = z.infer<typeof IPOCreateSchema>;

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
 * POST /api/admin/ipos - Create new IPO
 */
export async function POST(request: NextRequest) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing IPO creation request');

    // Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (error) {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid JSON in request body',
        requestId,
        400
      );
    }

    // Validate request body
    let validatedData: IPOCreateRequest;
    try {
      validatedData = IPOCreateSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues },
          'IPO creation validation failed'
        );
        return createErrorResponse(
          'VALIDATION_ERROR',
          'Invalid IPO data',
          requestId,
          400,
          { errors: error.issues }
        );
      }
      throw error;
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

    // Auto-generate slug using canonical utility
    const slug = generateIPOSlug(validatedData.companyName);

    // Check if slug already exists
    const existingIPO = await ipoRepository.findBySlug(slug);
    if (existingIPO) {
      requestLogger.warn(
        { slug, existingId: existingIPO.id },
        'IPO with generated slug already exists'
      );
      return createErrorResponse(
        'CONFLICT',
        `IPO with similar name already exists: ${existingIPO.companyName}`,
        requestId,
        409,
        { existingSlug: slug, existingId: existingIPO.id }
      );
    }

    // Convert date strings to Date objects
    const ipoData: any = {
      ...validatedData,
      slug,
      openDate: validatedData.openDate ? new Date(validatedData.openDate) : null,
      closeDate: validatedData.closeDate ? new Date(validatedData.closeDate) : null,
      listingDate: validatedData.listingDate ? new Date(validatedData.listingDate) : null,
    };

    // Create IPO using repository
    const createdIPO = await ipoRepository.create(ipoData);

    // Invalidate cache patterns
    await redis.del('ipo:list:*');

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        ipoId: createdIPO.id,
        slug,
        companyName: validatedData.companyName,
      },
      'IPO created successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: createdIPO,
        metadata: {
          generatedSlug: slug,
          createdAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to create IPO'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to create IPO',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
