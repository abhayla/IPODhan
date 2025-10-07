import { NextRequest, NextResponse } from 'next/server';
import { MarketHolidayRepository } from '@/lib/repositories/market-holiday-repository';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { z } from 'zod';

/**
 * GET /api/market-holidays
 *
 * Returns a list of market holidays with optional filters.
 * Story 5.4: Market Holidays Calendar
 *
 * Query Parameters:
 * - year: Year to filter (2024-2026) (optional)
 * - exchange: Exchange filter - 'ALL', 'NSE', or 'BSE' (optional, default: 'ALL')
 * - upcoming: Boolean to show only upcoming holidays (optional, default: false)
 *
 * Response format:
 * {
 *   holidays: MarketHoliday[],
 *   fetchedAt: string (ISO timestamp)
 * }
 *
 * Cache-Control: public, max-age=2592000 (30 days)
 */

// Schema for query parameter validation
const querySchema = z.object({
  year: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const year = parseInt(val);
        return !isNaN(year) && year >= 2024 && year <= 2026;
      },
      { message: 'Year must be between 2024 and 2026' }
    ),
  exchange: z
    .enum(['ALL', 'NSE', 'BSE'])
    .optional()
    .default('ALL'),
  upcoming: z
    .string()
    .optional()
    .refine((val) => !val || val === 'true' || val === 'false', {
      message: 'Upcoming must be true or false',
    }),
});

export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;
    const queryParams = {
      year: searchParams.get('year') || undefined,
      exchange: (searchParams.get('exchange') as 'ALL' | 'NSE' | 'BSE') || 'ALL',
      upcoming: searchParams.get('upcoming') || undefined,
    };

    const validation = querySchema.safeParse(queryParams);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: validation.error.issues,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const { year, exchange, upcoming } = validation.data;

    // Build filters object
    const filters = {
      year: year ? parseInt(year) : undefined,
      exchange: exchange || 'ALL',
      upcoming: upcoming === 'true',
    };

    // Initialize repository and fetch holidays
    const redis = getRedisClient();
    const holidayRepo = new MarketHolidayRepository(db, redis);
    const holidays = await holidayRepo.findAll(filters);

    // Return response with cache headers and timestamp
    return NextResponse.json(
      {
        holidays,
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=2592000', // 30 days
        },
      }
    );
  } catch (error) {
    console.error('[API] Failed to fetch market holidays:', error);

    // Return error response
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch market holidays. Please try again later.',
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
