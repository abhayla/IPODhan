/**
 * Admin API: Scraper Logs Endpoint
 *
 * GET /api/admin/scraper/logs?source=NSE&status=FAILURE&page=1&limit=50
 * Returns paginated scraper execution logs with filters
 * Story 7.5: Error Handling & Monitoring
 *
 * SECURITY: Requires admin authentication
 * Include header: Authorization: Bearer <ADMIN_API_TOKEN>
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';
import { requireAdminAuth } from '@/lib/auth/admin-auth';
import type { ScraperSource } from '@/lib/db/types';
import { apiErrorResponse } from '@/lib/errors/api-error-response';

export async function GET(request: NextRequest) {
  // Require admin authentication
  const authError = await requireAdminAuth();
  if (authError) return authError;
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse query parameters
    const source = searchParams.get('source') as ScraperSource | null;
    const status = searchParams.get('status') as 'SUCCESS' | 'FAILURE' | 'PARTIAL' | null;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100); // Max 100 per page

    // Validate source if provided
    if (source && !['NSE', 'BSE', 'API_FALLBACK'].includes(source)) {
      return NextResponse.json(
        { error: 'Invalid source parameter. Must be NSE, BSE, or API_FALLBACK' },
        { status: 400 }
      );
    }

    // Validate status if provided
    if (status && !['SUCCESS', 'FAILURE', 'PARTIAL'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status parameter. Must be SUCCESS, FAILURE, or PARTIAL' },
        { status: 400 }
      );
    }

    // Validate pagination
    if (page < 1) {
      return NextResponse.json(
        { error: 'Page must be >= 1' },
        { status: 400 }
      );
    }

    // Query scraper logs
    const redis = getRedisClient();
    const scraperLogRepository = new ScraperLogRepository(db, redis);

    const result = await scraperLogRepository.findAll(
      {
        source: source || undefined,
        status: status || undefined,
      },
      {
        page,
        limit,
      }
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return apiErrorResponse(error, '/api/admin/scraper/logs');
  }
}
