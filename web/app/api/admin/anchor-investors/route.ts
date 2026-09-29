/**
 * Admin API Route for Anchor Investors Management (Story 11.10)
 *
 * @route POST /api/admin/anchor-investors
 * @route GET /api/admin/anchor-investors?ipoId={id}
 * @route DELETE /api/admin/anchor-investors?ipoId={id}
 * @requires Authorization: Bearer <ADMIN_API_TOKEN>
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { auditAdminWrite } from '@/lib/admin/admin-write-audit';
import { AuditActionTypes } from '@/lib/services/audit-log-service';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { AnchorInvestorRepository, AnchorListHeldError } from '@/lib/repositories/anchor-investor-repository';
import { logger } from '@/lib/logger';

// ==================== ZOD SCHEMAS ====================

/**
 * Individual Investor Schema
 */
const IndividualInvestorSchema = z.object({
  name: z.string().min(1, 'Investor name is required'),
  type: z.enum([
    'Mutual Fund',
    'FII',
    'Insurance',
    'Bank',
    'HNI',
    'Corporate',
    'Other',
  ]),
  shares: z.number().positive('Shares must be greater than 0'),
  amount: z.number().nonnegative('Amount cannot be negative'),
  percentOfIssue: z.number().nonnegative('Percentage cannot be negative'),
});

/**
 * Anchor Investor Creation/Update Schema
 */
const AnchorInvestorSchema = z.object({
  ipoId: z.string().uuid('Invalid IPO ID format'),
  bidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  totalSharesOffered: z.number().positive('Total shares must be greater than 0'),
  totalAmountRaised: z.string().refine(
    (val) => !isNaN(parseFloat(val)) && parseFloat(val) >= 0,
    'Total amount must be a valid positive number'
  ),
  anchorInvestorsCount: z
    .number()
    .int('Investor count must be an integer')
    .nonnegative('Investor count cannot be negative'),
  investorList: z.array(IndividualInvestorSchema).optional().nullable(),
});

type AnchorInvestorRequest = z.infer<typeof AnchorInvestorSchema>;

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

/**
 * Calculate lock-in dates from bid date
 */
function calculateLockInDates(bidDate: string): {
  lockIn50PercentDate: string;
  lockInRemainingDate: string;
} {
  const bid = new Date(bidDate);

  // 50% lock-in: 30 days from bid date
  const lockIn50 = new Date(bid);
  lockIn50.setDate(lockIn50.getDate() + 30);

  // Remaining 50% lock-in: 90 days from bid date
  const lockIn90 = new Date(bid);
  lockIn90.setDate(lockIn90.getDate() + 90);

  return {
    lockIn50PercentDate: lockIn50.toISOString().split('T')[0],
    lockInRemainingDate: lockIn90.toISOString().split('T')[0],
  };
}

// ==================== GET HANDLER ====================

/**
 * GET /api/admin/anchor-investors?ipoId={id}
 * Fetch anchor investor data by IPO ID
 */
export async function GET(request: NextRequest) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing admin anchor investor GET request');

    // Get query parameter
    const searchParams = request.nextUrl.searchParams;
    const ipoId = searchParams.get('ipoId');

    if (!ipoId) {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'ipoId query parameter is required',
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
      } as any;
    }

    const repository = new AnchorInvestorRepository(db, redis);

    // Fetch anchor data
    const anchorData = await repository.findByIPOId(ipoId);

    if (!anchorData) {
      return NextResponse.json(
        {
          success: true,
          data: null,
          message: 'No anchor investor data found for this IPO',
        },
        { status: 404 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      { duration, ipoId },
      'Anchor investor data fetched successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: anchorData,
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
      'Failed to fetch anchor investor data'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch anchor investor data',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}

// ==================== POST HANDLER ====================

/**
 * POST /api/admin/anchor-investors
 * Create or update anchor investor data
 */
// Writes take the admin from withAdminAuth's context and record it (OD-104, OD-113).
export const POST = withAdminAuth(async (request: NextRequest, adminContext: AdminAuthContext) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing admin anchor investor POST request');

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
    let validatedData: AnchorInvestorRequest;
    try {
      validatedData = AnchorInvestorSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        requestLogger.warn(
          { validationErrors: error.issues },
          'Anchor investor validation failed'
        );
        return createErrorResponse(
          'VALIDATION_ERROR',
          'Invalid anchor investor data',
          requestId,
          400,
          { errors: error.issues }
        );
      }
      throw error;
    }

    // §9.2 item 8 (OD-107): the investor LIST is edited row by row through the one list write
    // (writeAdminListChange, the IPO page's list editor), which makes it admin-owned. This route
    // saves the allocation's totals and bid date only; a list in the body is refused, never applied.
    if (validatedData.investorList != null) {
      return createErrorResponse('USE_LIST_EDITOR', new AnchorListHeldError(validatedData.ipoId).message, requestId, 400);
    }

    // Calculate lock-in dates
    const lockInDates = calculateLockInDates(validatedData.bidDate);

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
      } as any;
    }

    const repository = new AnchorInvestorRepository(db, redis);

    // Prepare data for database
    const anchorData = {
      ipoId: validatedData.ipoId,
      bidDate: validatedData.bidDate,
      totalSharesOffered: validatedData.totalSharesOffered,
      totalAmountRaised: validatedData.totalAmountRaised,
      anchorInvestorsCount: validatedData.anchorInvestorsCount,
      lockIn50PercentDate: lockInDates.lockIn50PercentDate,
      lockInRemainingDate: lockInDates.lockInRemainingDate,
    };

    // Upsert anchor data (create or update)
    const result = await repository.upsert(anchorData);

    await auditAdminWrite(adminContext, request, {
      actionType: AuditActionTypes.FIELD_UPDATED,
      action: 'ANCHOR_INVESTORS_SAVED',
      entryPoint: 'api/admin/anchor-investors POST',
      ipoId: validatedData.ipoId,
      tableName: 'anchor_investors',
      fieldName: '*',
      newValue: String(result.id),
    });

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        ipoId: validatedData.ipoId,
        anchorId: result.id,
      },
      'Anchor investor data saved successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Anchor investor data saved successfully',
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
      'Failed to save anchor investor data'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to save anchor investor data',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
});

// ==================== DELETE HANDLER ====================

/**
 * DELETE /api/admin/anchor-investors?ipoId={id}
 * Delete anchor investor data
 */
export const DELETE = withAdminAuth(async (request: NextRequest, adminContext: AdminAuthContext) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing admin anchor investor DELETE request');

    // Get query parameter
    const searchParams = request.nextUrl.searchParams;
    const ipoId = searchParams.get('ipoId');

    if (!ipoId) {
      return createErrorResponse(
        'VALIDATION_ERROR',
        'ipoId query parameter is required',
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
      } as any;
    }

    const repository = new AnchorInvestorRepository(db, redis);

    // Delete anchor data (refused while its investor list is non-empty or admin-owned, OD-107)
    try {
      await repository.delete(ipoId);
    } catch (error) {
      if (error instanceof AnchorListHeldError) return createErrorResponse('USE_LIST_EDITOR', error.message, requestId, 400);
      throw error;
    }

    await auditAdminWrite(adminContext, request, {
      actionType: AuditActionTypes.FIELD_UPDATED,
      action: 'ANCHOR_INVESTORS_DELETED',
      entryPoint: 'api/admin/anchor-investors DELETE',
      ipoId,
      tableName: 'anchor_investors',
      fieldName: '*',
    });

    const duration = Date.now() - startTime;
    requestLogger.info(
      { duration, ipoId },
      'Anchor investor data deleted successfully'
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Anchor investor data deleted successfully',
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
      'Failed to delete anchor investor data'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to delete anchor investor data',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
});
