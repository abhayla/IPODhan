import { NextResponse } from 'next/server';
import { db } from '@/lib/db/index';
import { ipos } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * GET /api/sectors
 *
 * Returns a list of distinct sectors from the IPO database.
 * Sectors are cached for 1 hour to reduce database load.
 *
 * Response format:
 * {
 *   sectors: string[]
 * }
 */
export async function GET() {
  const cacheKey = 'sectors';
  const cacheTTL = 3600; // 1 hour in seconds

  try {
    // Try to check Redis cache first (with timeout protection)
    let cached: string | null = null;
    try {
      const redis = getRedisClient();
      // Set a timeout for Redis operations to prevent hanging
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Redis timeout')), 2000)
      );
      cached = await Promise.race([
        redis.get(cacheKey),
        timeoutPromise,
      ]);
    } catch (redisError) {
      console.warn('[API] Redis unavailable, proceeding without cache:', redisError);
      // Continue without cache
    }

    if (cached) {
      return NextResponse.json({
        sectors: JSON.parse(cached),
      });
    }

    // Query database for distinct sectors
    const result = await db
      .selectDistinct({ sector: ipos.sector })
      .from(ipos)
      .where(sql`${ipos.sector} IS NOT NULL AND ${ipos.sector} != ''`)
      .orderBy(ipos.sector);

    // Extract sector strings from result
    const sectors = result
      .map((row) => row.sector)
      .filter((sector): sector is string => sector !== null && sector !== '');

    // Try to cache the result (with timeout protection)
    try {
      const redis = getRedisClient();
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Redis timeout')), 2000)
      );
      await Promise.race([
        redis.setex(cacheKey, cacheTTL, JSON.stringify(sectors)),
        timeoutPromise,
      ]);
    } catch (redisError) {
      console.warn('[API] Redis unavailable, skipping cache write:', redisError);
      // Continue without caching
    }

    return NextResponse.json({
      sectors,
    });
  } catch (error) {
    console.error('Failed to fetch sectors:', error);

    // Return error response
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch sectors',
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
