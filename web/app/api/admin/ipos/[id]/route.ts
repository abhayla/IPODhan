/**
 * PATCH /api/admin/ipos/[id] API Route
 *
 * Update existing IPO (admin only)
 *
 * @route PATCH /api/admin/ipos/[id]
 * @requires Authorization: Bearer <ADMIN_API_TOKEN>
 * @param {string} id - IPO UUID
 * @body {IPOUpdateRequest} Partial IPO data
 * @returns {IPOUpdateResponse} Updated IPO
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { logger } from '@/lib/logger';

/**
 * IPO Update Request Schema (all fields optional)
 */
const IPOUpdateSchema = z.object({
  companyName: z.string().min(1).max(255).optional(),
  category: z.enum(['MAINBOARD', 'SME']).optional(),
  status: z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']).optional(),
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

type IPOUpdateRequest = z.infer<typeof IPOUpdateSchema>;

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
 * PATCH /api/admin/ipos/[id] - Update existing IPO
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    const { id } = await context.params;

    requestLogger.info({ ipoId: id }, 'Processing IPO update request');

    // Validate ID
    if (!id || typeof id !== 'string') {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing id parameter',
        requestId,
        400
      );
    }

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
    let validatedData: IPOUpdateRequest;
    try {
      validatedData = IPOUpdateSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues },
          'IPO update validation failed'
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

    // Check if there are any fields to update
    if (Object.keys(validatedData).length === 0) {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'No fields provided for update',
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

    // Check if IPO exists
    const existingIPO = await ipoRepository.findById(id);
    if (!existingIPO) {
      requestLogger.warn({ ipoId: id }, 'IPO not found');
      return createErrorResponse(
        'NOT_FOUND',
        `IPO with id '${id}' not found`,
        requestId,
        404
      );
    }

    // Convert date strings to Date objects
    const updateData: any = { ...validatedData };
    if (updateData.openDate) {
      updateData.openDate = new Date(updateData.openDate);
    }
    if (updateData.closeDate) {
      updateData.closeDate = new Date(updateData.closeDate);
    }
    if (updateData.listingDate) {
      updateData.listingDate = new Date(updateData.listingDate);
    }

    // Update IPO using repository
    const updatedIPO = await ipoRepository.update(id, updateData);

    // Invalidate cache
    await redis.del(`ipo:slug:${existingIPO.slug}`);
    await redis.del(`ipo:id:${id}`);
    await redis.del(`ipo:detail:${existingIPO.slug}`);
    await redis.del('ipo:list:*');

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        ipoId: id,
        slug: existingIPO.slug,
        updatedFields: Object.keys(validatedData),
      },
      'IPO updated successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: updatedIPO,
        metadata: {
          updatedFields: Object.keys(validatedData),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        duration,
      },
      'Failed to update IPO'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to update IPO',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}
