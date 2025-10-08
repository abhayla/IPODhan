/**
 * Admin API: Scraper Logs Endpoint
 *
 * GET /api/admin/scraper/logs?source=NSE&status=FAILURE&page=1&limit=50
 * Returns paginated scraper execution logs with filters
 * Story 7.5: Error Handling & Monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ScraperLogRepository } from '@/lib/repositories/scraper-log-repository';
import type { ScraperSource } from '@/lib/db/types';

export async function GET(request: NextRequest) {
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
    console.error('Failed to get scraper logs:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve scraper logs',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
