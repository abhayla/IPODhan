/**
 * GET /api/calendar API Route
 *
 * Returns IPO calendar events (open dates, close dates, listing dates)
 * Supports filtering by month and category
 *
 * @route GET /api/calendar
 * @query {string} month - Optional: Filter by month (YYYY-MM format, e.g., 2025-10)
 * @query {string} category - Optional: Filter by category (MAINBOARD | SME)
 * @returns {CalendarEventsResponse} Array of calendar events
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { logger } from '@/lib/logger';

/**
 * Query Parameters Schema
 */
const QueryParamsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM format
  category: z.enum(['MAINBOARD', 'SME']).optional(),
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
 * Parse date range from month parameter
 */
function getMonthRange(month: string): { startDate: Date; endDate: Date } {
  const [year, monthNum] = month.split('-').map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0, 23, 59, 59); // Last day of month
  return { startDate, endDate };
}

/**
 * Transform IPO data to calendar events
 */
function transformToCalendarEvents(ipos: any[]): any[] {
  const events: any[] = [];

  for (const ipo of ipos) {
    // Open date event
    if (ipo.openDate) {
      events.push({
        id: `${ipo.id}-open`,
        ipoId: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        category: ipo.category,
        eventType: 'OPEN',
        date: ipo.openDate,
        dateLabel: 'Open Date',
        status: ipo.status,
      });
    }

    // Close date event
    if (ipo.closeDate) {
      events.push({
        id: `${ipo.id}-close`,
        ipoId: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        category: ipo.category,
        eventType: 'CLOSE',
        date: ipo.closeDate,
        dateLabel: 'Close Date',
        status: ipo.status,
      });
    }

    // Listing date event
    if (ipo.listingDate) {
      events.push({
        id: `${ipo.id}-listing`,
        ipoId: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        category: ipo.category,
        eventType: 'LISTING',
        date: ipo.listingDate,
        dateLabel: 'Listing Date',
        status: ipo.status,
      });
    }
  }

  // Sort events by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return events;
}

/**
 * GET /api/calendar - Fetch IPO calendar events
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId();
  const startTime = Date.now();

  const requestLogger = logger.child({ requestId });

  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month') || undefined;
    const category = searchParams.get('category') || undefined;

    requestLogger.info({ month, category }, 'Processing calendar request');

    // Validate query parameters
    let validatedParams: QueryParams;
    try {
      validatedParams = QueryParamsSchema.parse({
        month,
        category,
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

    // Build filters
    const filters: any = {};

    if (validatedParams.category) {
      filters.category = [validatedParams.category];
    }

    // Fetch IPOs based on filters
    let ipos;
    if (validatedParams.month) {
      const { startDate, endDate } = getMonthRange(validatedParams.month);
      ipos = await ipoRepository.findAllWithDetails({
        ...filters,
        // Note: This is a simplified filter - in production, you'd filter by date range in repository
      });

      // Client-side filter by month (ideally should be done in repository)
      ipos = ipos.filter((ipo: any) => {
        const openDate = ipo.openDate ? new Date(ipo.openDate) : null;
        const closeDate = ipo.closeDate ? new Date(ipo.closeDate) : null;
        const listingDate = ipo.listingDate ? new Date(ipo.listingDate) : null;

        return (
          (openDate && openDate >= startDate && openDate <= endDate) ||
          (closeDate && closeDate >= startDate && closeDate <= endDate) ||
          (listingDate && listingDate >= startDate && listingDate <= endDate)
        );
      });
    } else {
      ipos = await ipoRepository.findAllWithDetails(filters);
    }

    // Transform to calendar events
    const events = transformToCalendarEvents(ipos);

    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        duration,
        eventCount: events.length,
        ipoCount: ipos.length,
        month: validatedParams.month,
        category: validatedParams.category,
      },
      'Calendar events fetched successfully'
    );

    // Return response with cache headers (5 minutes)
    return NextResponse.json(
      {
        success: true,
        data: events,
        metadata: {
          totalEvents: events.length,
          totalIPOs: ipos.length,
          filters: validatedParams,
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
      'Failed to fetch calendar events'
    );

    return createErrorResponse(
      'INTERNAL_ERROR',
      'Failed to fetch calendar events',
      requestId,
      500
    );
  }
}
