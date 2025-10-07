/**
 * Affiliate Click Tracking API Endpoint
 *
 * POST /api/affiliate/track
 *
 * Tracks affiliate link clicks for analytics and commission tracking.
 * Stores click data in the database with session information.
 *
 * @route POST /api/affiliate/track
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/index';
import { affiliateClicks } from '@/lib/db/schema';
import { logger } from '@/lib/logger';

// Request validation schema
const trackClickSchema = z.object({
  broker: z.enum(['zerodha', 'angelone']),
  source: z.enum(['ipo_detail', 'homepage']),
  ipoId: z.string().uuid().nullable().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = trackClickSchema.parse(body);

    // Extract user session from headers/cookies
    // Using combination of IP and user agent as session identifier
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const userSession = `${ip.split(',')[0]}_${Buffer.from(userAgent).toString('base64').slice(0, 50)}`;

    // Insert click record
    await db.insert(affiliateClicks).values({
      broker: validatedData.broker,
      source: validatedData.source,
      ipoId: validatedData.ipoId || null,
      userSession,
    });

    logger.info({
      broker: validatedData.broker,
      source: validatedData.source,
      ipoId: validatedData.ipoId,
    }, 'Affiliate click tracked');

    return NextResponse.json(
      {
        success: true,
        message: 'Click tracked successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.error({ error: error.issues }, 'Invalid affiliate tracking request');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request data',
          details: error.issues,
        },
        { status: 400 }
      );
    }

    logger.error({ error }, 'Error tracking affiliate click');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to track click',
      },
      { status: 500 }
    );
  }
}

// OPTIONS handler for CORS preflight
export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    }
  );
}
