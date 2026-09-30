/**
 * POST /api/admin/ipos API Route
 *
 * GET lists IPOs; POST creates one by hand (spec §9.2 item 15, OD-111). Admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { createIpoByAdmin, type AdminIpoCreateInput } from '@ipodhan/shared/services/admin-ipo-create';
import { logger } from '@/lib/logger';

/** §9.2 item 15 (OD-111): what the create form sends. Values are checked again by the shared service. */
const AdminIpoCreateSchema = z.object({
  companyName: z.string().min(1).max(255),
  offeringType: z.string().min(1).max(20),
  segment: z.enum(['MAINBOARD', 'SME']).nullable().optional(),
  identifiers: z.array(z.object({ kind: z.string().min(1).max(20), value: z.string().max(200) })).max(10),
  sourceNote: z.string().max(500).nullable().optional(),
});

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
 * GET /api/admin/ipos - List all IPOs (admin view)
 */
export async function GET(request: NextRequest) {
  // MUST check admin auth first
  const authError = await requireAdminAuth();
  if (authError) return authError;

  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    requestLogger.info('Processing admin IPO list request');

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const segment = searchParams.get('segment') || '';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

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

    // Build query filters (convert offset to page for repository)
    const page = Math.floor(offset / limit) + 1;
    // §9.2 item 23: the admin list shows hidden rows too (data stays for admins).
    const filters: any = { page, limit, includeHidden: true };
    if (status) filters.status = status;
    if (segment) filters.segment = segment;
    if (search) filters.search = search;

    // Get IPOs with pagination using findAll (returns PaginatedResponse)
    const response = await ipoRepository.findAll(filters);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        resultCount: response.data.length,
        total: response.meta.total,
        filters,
      },
      'Admin IPO list fetched successfully'
    );

    return NextResponse.json(
      {
        success: true,
        data: response.data,
        meta: {
          total: response.meta.total,
          limit,
          offset,
          hasMore: offset + response.data.length < response.meta.total,
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
      'Failed to fetch admin IPO list'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch IPO list',
      requestId,
      500,
      process.env.NODE_ENV === 'development'
        ? { error: error instanceof Error ? error.message : String(error) }
        : undefined
    );
  }
}

/**
 * POST /api/admin/ipos - an admin creates an IPO row by hand (spec §9.2 item 15, OD-111).
 *
 * Needs the company name, the offering type and at least one identifier binding uses (OD-89: CIN,
 * an exchange or aggregator record number per OD-85, or the NSE or BSE symbol). The shared service
 * runs the real identity resolver first: an identifier that already binds a row is refused with that
 * row named (409), so the admin edits it instead of creating a duplicate. Admin session + same-origin
 * check (CSRF) via withAdminAuth.
 */
export const POST = withAdminAuth(async (request: NextRequest, adminContext: AdminAuthContext) => {
  const requestId = generateRequestId();
  const requestLogger = logger.child({ requestId });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return createErrorResponse('VALIDATION_ERROR', 'Invalid JSON in request body', requestId, 400);
  }
  const parsed = AdminIpoCreateSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse('VALIDATION_ERROR', 'Invalid IPO data', requestId, 400, { errors: parsed.error.issues });
  }

  let redis;
  try {
    redis = getRedisClient();
  } catch {
    redis = null;
  }

  try {
    const result = await createIpoByAdmin(db as never, {
      companyName: parsed.data.companyName,
      offeringType: parsed.data.offeringType,
      segment: parsed.data.segment ?? null,
      // An unknown kind is refused by the service with its own reason (and a SEBI number with OD-89's).
      identifiers: parsed.data.identifiers as AdminIpoCreateInput['identifiers'],
      sourceNote: parsed.data.sourceNote ?? null,
      actor: { name: adminContext.adminName, adminId: adminContext.adminId },
      ipAddress: request.headers.get('x-forwarded-for'),
      userAgent: request.headers.get('user-agent'),
    });

    switch (result.kind) {
      case 'CREATED':
        if (redis) await invalidateIPOCaches(redis, result.ipoId, result.slug);
        requestLogger.info({ ipoId: result.ipoId, slug: result.slug, by: adminContext.adminName }, 'IPO created by admin (OD-111)');
        return NextResponse.json({ success: true, data: result }, { status: 201 });
      case 'INVALID':
        return createErrorResponse('VALIDATION_ERROR', result.reason, requestId, 400);
      case 'EXISTS':
      case 'SLUG_TAKEN':
        return createErrorResponse('CONFLICT', result.reason, requestId, 409, { existingId: result.ipoId, existingSlug: result.slug });
      case 'HELD':
        return createErrorResponse('IDENTITY_HELD', result.reason, requestId, 409, { candidates: result.candidates });
    }
  } catch (error) {
    requestLogger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to create IPO');
    return createErrorResponse('INTERNAL_ERROR', 'Failed to create IPO', requestId, 500);
  }
});
