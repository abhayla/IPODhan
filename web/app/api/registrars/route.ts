import { NextRequest, NextResponse } from 'next/server';
import { RegistrarRepository } from '@/lib/repositories/registrar-repository';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { z } from 'zod';

/**
 * GET /api/registrars
 *
 * Returns a list of registrars, optionally filtered by search query.
 * Results are cached for 7 days (Story 5.3: Registrar Directory)
 *
 * Query Parameters:
 * - search: Optional search query string to filter registrars by name
 *
 * Response format:
 * {
 *   registrars: Registrar[]
 * }
 *
 * Cache-Control: public, max-age=604800 (7 days)
 */

// Schema for query parameter validation
const querySchema = z.object({
  search: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;
    const queryParams = {
      search: searchParams.get('search') || undefined,
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

    const { search } = validation.data;

    // Initialize repository and fetch registrars
    const redis = getRedisClient();
    const registrarRepo = new RegistrarRepository(db, redis);
    const registrars = search
      ? await registrarRepo.search(search, true)
      : await registrarRepo.findAll();

    // Return response with cache headers
    return NextResponse.json(
      { registrars },
      {
        headers: {
          'Cache-Control': 'public, max-age=604800', // 7 days
        },
      }
    );
  } catch (error) {
    console.error('[API] Failed to fetch registrars:', error);

    // Return error response
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch registrars',
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
