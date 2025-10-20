/**
 * Mainboard IPO Performance API Route
 * Story 9.7a: Mainboard IPO Performance Tracker
 *
 * GET /api/performance/mainboard
 *
 * Query Parameters:
 * - year: Filter by listing year (optional, defaults to all years)
 * - page: Page number for pagination (optional, default: 1)
 * - limit: Items per page (optional, default: 50)
 *
 * Response:
 * {
 *   success: true,
 *   data: PerformanceData[],
 *   meta: PaginationMeta
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const yearParam = searchParams.get('year');
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');

    // Validate and parse year (optional)
    let year: number | undefined;
    if (yearParam && yearParam !== 'all') {
      const yearNum = parseInt(yearParam, 10);
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid year parameter. Must be a number between 2000 and 2100.',
          },
          { status: 400 }
        );
      }
      year = yearNum;
    }

    // Parse pagination parameters
    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    // Validate pagination
    if (isNaN(page) || page < 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid page parameter. Must be a positive integer.',
        },
        { status: 400 }
      );
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid limit parameter. Must be between 1 and 100.',
        },
        { status: 400 }
      );
    }

    // Get database and Redis clients
    const db = await getDb();
    const redis = getRedisClient();

    // Initialize repository
    const ipoRepository = new IPORepository(db, redis);

    // Fetch performance data
    const result = await ipoRepository.findMainboardPerformance({
      year,
      page,
      limit,
    });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        data: result.data,
        meta: result.meta,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[API /performance/mainboard] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch Mainboard IPO performance data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
